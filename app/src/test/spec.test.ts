/**
 * The nine numbered validation tests from simulator.md ("Validation — write
 * these as automated tests before building UI").
 */
import { describe, expect, it } from "vitest";
import { SIGMA } from "../core/constants";
import { sizeDesign } from "../core/design";
import {
  betaStarDeg,
  eclipseFraction,
  orbitPeriodS,
} from "../core/environment";
import { arrhenius, runMission } from "../core/mission";
import { runMonteCarlo } from "../core/montecarlo";
import {
  emptyAudit,
  emptyTrace,
  initThermalState,
  radiatorNodeStep,
  simulateOrbit,
} from "../core/orbitloop";
import type { OrbitEnv } from "../core/orbitloop";
import { baselineDd } from "../core/params";
import {
  checkpointOverhead,
  checkpointOverheadAtTau,
} from "../core/radiation";
import { deriveSeed } from "../core/rng";
import { noFade } from "./helpers";

describe("simulator.md validation tests", () => {
  it("1. orbital period 5,739 +/- 1 s; eclipse fraction geometry", () => {
    expect(Math.abs(orbitPeriodS(550) - 5739)).toBeLessThanOrEqual(1);
    // fe(550 km, beta=0) ~ 0.376
    expect(Math.abs(eclipseFraction(550, 0) - 0.376)).toBeLessThanOrEqual(0.006);
    // -> 0 above beta* = acos(sqrt(2Rh+h^2)/(R+h))
    const bStar = betaStarDeg(550);
    expect(eclipseFraction(550, bStar + 0.01)).toBe(0);
    expect(eclipseFraction(550, bStar - 0.5)).toBeGreaterThan(0.001);
    // monotone decreasing in beta
    let prev = eclipseFraction(550, 0);
    for (let b = 5; b <= 90; b += 5) {
      const fe = eclipseFraction(550, b);
      expect(fe).toBeLessThanOrEqual(prev + 1e-12);
      prev = fe;
    }
  });

  it("2. isolated radiator node settles to the analytic T = (q/(eps*sigma*A))^0.25", () => {
    const eps = 0.86;
    const area = 75;
    const qIn = 40_000; // W constant
    const cRad = 2.16e5; // J/K
    const tAnalytic = (qIn / (eps * SIGMA * area)) ** 0.25;
    let t = 285;
    for (let i = 0; i < Math.ceil(50_000 / 30); i++) {
      t = radiatorNodeStep(t, 0, 0, qIn, eps, area, cRad, 30);
    }
    expect(Math.abs(t - tAnalytic)).toBeLessThan(0.1);
    // unconditional stability: a huge step must not blow up, and must still
    // converge (the linearized update is a damped Newton iteration)
    let tBig = 285;
    for (let i = 0; i < 200; i++) {
      tBig = radiatorNodeStep(tBig, 0, 0, qIn, eps, area, cRad, 1e6);
      expect(Number.isFinite(tBig)).toBe(true);
    }
    expect(Math.abs(tBig - tAnalytic)).toBeLessThan(0.1);
  });

  it("3. energy conservation over a steady-periodic orbit closes to <1%", () => {
    for (const make of [
      () => baselineDd(),
      () => {
        // deep-eclipse case exercises the battery hard
        const c = baselineDd();
        c.orbit.profile = "custom";
        c.orbit.beta_mean_deg = 20;
        c.orbit.beta_amp_deg = 0;
        return c;
      },
    ]) {
      const cfg = make();
      const dz = sizeDesign(cfg);
      const st = initThermalState(cfg, dz);
      const env: OrbitEnv = {
        fe: dz.worst_fe,
        p_arr_w: dz.arr_p_bol_w * cfg.eps.pmad_eff,
        alpha: cfg.thermal.rad_alpha_bol + 0.05,
        leak_mult: 1.05,
        n_alive: cfg.chip.n_gpu,
        tj_target_c: cfg.chip.tj_target_c,
      };
      const audit = emptyAudit();
      simulateOrbit(cfg, dz, env, st, 4.0, undefined, undefined, audit);
      const dSoc = audit.soc_end_wh - audit.soc_start_wh;
      const losses = audit.e_loss_chg_wh + audit.e_loss_dis_wh;
      // spec statement: integral(array_used - load - losses) = delta SoC
      const closure =
        audit.e_arr_used_wh - audit.e_load_served_wh - losses - dSoc;
      expect(Math.abs(closure)).toBeLessThan(0.01 * audit.e_load_served_wh);
      // and the audit identity is exact up to clamp bookkeeping
      expect(Math.abs(closure - audit.e_clamp_wh)).toBeLessThan(
        1e-6 * Math.max(audit.e_load_served_wh, 1),
      );
      // steady-periodic: battery returns to its starting state
      expect(Math.abs(dSoc)).toBeLessThan(0.01 * audit.e_load_served_wh);
      // dispatch never browned out the served load in these healthy designs
      expect(audit.e_unserved_wh).toBe(0);
    }
  });

  it("4. Daly overhead minimum sits at tau* = sqrt(2*delta*MTBF)", () => {
    const delta = 45;
    const restart = 300;
    const mtbf = 86_400;
    const tauStar = Math.sqrt(2 * delta * mtbf);
    let best = Infinity;
    let bestTau = 0;
    for (let i = 0; i <= 800; i++) {
      const tau = tauStar * 10 ** (-1 + (2 * i) / 800);
      const ov = checkpointOverheadAtTau(delta, restart, mtbf, tau);
      if (ov < best) {
        best = ov;
        bestTau = tau;
      }
    }
    expect(Math.abs(bestTau - tauStar) / tauStar).toBeLessThan(0.02);
    expect(checkpointOverhead(delta, restart, mtbf)).toBeLessThanOrEqual(
      best + 1e-9,
    );
  });

  it("5. DVFS controller: flux step -> Tj returns to setpoint, no limit cycle, f in bounds", () => {
    const cfg = baselineDd();
    cfg.thermal.rad_area_scale = 0.7; // undersized so the throttle binds
    const dz = sizeDesign(cfg);
    const st = initThermalState(cfg, dz);
    const base: OrbitEnv = {
      fe: 0, // pure thermal experiment: no eclipse
      p_arr_w: dz.load_design_w * 2, // ... and no power limiting
      alpha: 0.09,
      leak_mult: 1.0,
      n_alive: cfg.chip.n_gpu,
      tj_target_c: cfg.chip.tj_target_c,
    };
    simulateOrbit(cfg, dz, base, st, 4.0);
    // environment-flux step: coating suddenly darker + leakage up
    const stepped: OrbitEnv = { ...base, alpha: 0.35, leak_mult: 1.3 };
    const trace = emptyTrace();
    const m = simulateOrbit(cfg, dz, stepped, st, 4.0, undefined, trace);
    expect(Math.abs(m.tj_mean - cfg.chip.tj_target_c)).toBeLessThan(0.5);
    expect(m.tj_max).toBeLessThan(cfg.chip.tj_target_c + 2);
    for (let i = 0; i < trace.f.length; i++) {
      expect(trace.f[i]).toBeGreaterThanOrEqual(cfg.chip.f_min);
      expect(trace.f[i]).toBeLessThanOrEqual(1);
      if (i > 0) {
        // no slew-rail limit cycling once settled
        expect(Math.abs(trace.f[i] - trace.f[i - 1])).toBeLessThan(0.021);
      }
    }
  });

  it("6. Arrhenius factor at Ea=0.7 eV roughly doubles per 10 K near 80 C", () => {
    const rel = baselineDd().rel;
    expect(arrhenius(rel, 80)).toBeCloseTo(1, 12); // reference point
    const ratio = arrhenius(rel, 90) / arrhenius(rel, 80);
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.2);
    expect(arrhenius(rel, 95)).toBeGreaterThan(arrhenius(rel, 90));
  });

  it("7. attrition disabled + no eclipse -> delivered = nameplate exactly", () => {
    const cfg = baselineDd();
    cfg.orbit.profile = "custom";
    cfg.orbit.beta_mean_deg = 90; // permanently sunlit
    cfg.orbit.beta_amp_deg = 0;
    cfg.rel.afr_base_per_yr = 0;
    cfg.rel.sel_per_gpu_yr = 0;
    cfg.rel.mmod_per_gpu_yr = 0;
    cfg.rad.dose_scale = 0; // no TID -> no Weibull mortality, no leakage growth
    cfg.rel.ckpt_write_s = 0; // checkpointing off
    cfg.rel.restart_s = 0;
    cfg.eps.batt_fade_ref = 0;
    const res = runMission(cfg);
    const s = res.summary;
    expect(
      Math.abs(s.delivered_pflop_yr - s.nameplate_pflop_yr) /
        s.nameplate_pflop_yr,
    ).toBeLessThan(1e-9);
    expect(s.final_n_alive).toBe(cfg.chip.n_gpu);
    for (const r of res.hist) expect(r.f_mean).toBe(1);
    for (const v of Object.values(s.losses)) {
      expect(Math.abs(v)).toBeLessThan(1e-9);
    }
  });

  it("8. fixed-seed Monte Carlo is bit-reproducible; EV mode ~ MC mean", () => {
    const cfg = baselineDd();
    cfg.mission.years = 2;
    const a = runMonteCarlo(cfg, 12, 11);
    const b = runMonteCarlo(cfg, 12, 11);
    expect(a.delivered).toEqual(b.delivered); // bit-identical
    expect(a.X).toEqual(b.X);

    // expected-value propagation vs the mean of stochastic-event runs
    // (same config, no parameter sampling)
    const base = noFade(baselineDd());
    const ev = runMission(base).summary.delivered_pflop_yr;
    let acc = 0;
    const n = 24;
    for (let i = 0; i < n; i++) {
      acc += runMission(base, { stochastic: true, seed: deriveSeed(7, i) })
        .summary.delivered_pflop_yr;
    }
    const mean = acc / n;
    expect(Math.abs(mean - ev) / ev).toBeLessThan(0.02);
  });

  // 9. sdcsim baseline parity within 2% lives in missions.test.ts (it needs
  //    the generated fixtures); asserted there for every fixture mission.
});
