/**
 * Inner loop: coupled orbit-transient of the thermal <-> chip <-> power
 * system (port of sdcsim/orbitloop.py; step-for-step identical).
 *
 * Two thermal nodes (coolant loop, radiator) integrated with exponential
 * unconditionally-stable updates — the radiator node is stiff (eps*sigma*T^4)
 * so each step linearizes about the current temperature (a Newton step for
 * the equilibrium) and relaxes exponentially with the linearized time
 * constant; never naive explicit Euler. The junction is quasi-static on top
 * (fixed point in leakage), a proportional DVFS controller with slew limits
 * holds Tj at the throttle setpoint, and a supply-dispatch step bisects the
 * frequency down when array+battery power is insufficient. Everything slower
 * feeds in as boundary conditions via OrbitEnv.
 */
import {
  AUX_HEAT_FRAC,
  C_RAD_MIN_J_K,
  C_TO_K,
  DISPATCH_BISECT_ITERS,
  DVFS_KP_DT_REF_S,
  DVFS_KP_PER_30S,
  F_INIT,
  F_NEAR_ONE,
  F_SLEW_DOWN,
  F_SLEW_UP,
  IDLE_HEAT_FRAC,
  IDLE_P_GPU_TDP_FRAC,
  IDLE_P_IT_SCALE,
  P_GPU_INIT_TDP_FRAC,
  SIGMA,
  SOC_ACCESS_FRAC,
  THERMAL_LIMITED_ERR_K,
  TJ_FIXED_POINT_ITERS,
  TJ_HARD_LIMIT_F_STEP,
  TJ_INIT_OFFSET_K,
  T_COOL_INIT_K,
  T_RAD_INIT_K,
} from "./constants";
import { gpuPowerW, otherPowerW, qAbsWM2 } from "./design";
import type { Design } from "./design";
import type { ChipP, Config } from "./params";

/** Persistent fast-loop state, warm-started across epochs. */
export interface ThermalState {
  t_cool_k: number;
  t_rad_k: number;
  f: number;
  soc_wh: number;
  p_gpu_last: number;
}

export function initThermalState(cfg: Config, dz: Design): ThermalState {
  return {
    t_cool_k: T_COOL_INIT_K,
    t_rad_k: T_RAD_INIT_K,
    f: F_INIT,
    soc_wh: dz.batt_cap_wh,
    p_gpu_last: cfg.chip.tdp_w * P_GPU_INIT_TDP_FRAC,
  };
}

/** Slow boundary conditions handed to one orbit-transient run. */
export interface OrbitEnv {
  /** Eclipse fraction this epoch [-]. */
  fe: number;
  /** Array power delivered to the bus while illuminated [W]. */
  p_arr_w: number;
  /** Radiator coating absorptance [-]. */
  alpha: number;
  /** TID-driven leakage multiplier [-]. */
  leak_mult: number;
  /** Live GPU count (fractional in expected-value mode). */
  n_alive: number;
  /** DVFS throttle setpoint [degC]. */
  tj_target_c: number;
  /** Battery capacity fraction after cycle fade [-] (extension; default 1). */
  batt_cap_frac?: number;
}

/** Steady-periodic metrics over the final full orbit. */
export interface OrbitMetrics {
  f_mean: number;
  tj_mean: number;
  tj_max: number;
  /** Per-orbit junction temperature swing [K] — feeds Coffin-Manson. */
  dtj_cycle: number;
  t_rad_mean_c: number;
  /** Worst depth of discharge over the orbit [-]. */
  dod: number;
  frac_power_limited: number;
  frac_thermal_limited: number;
  frac_idle: number;
}

/** Per-step series over the final full orbit (UI + tests). */
export interface OrbitTrace {
  t_min: number[];
  tj: number[];
  t_rad_c: number[];
  t_cool_c: number[];
  f: number[];
  soc_frac: number[];
  illum: number[];
  /** Extensions beyond the reference trace: */
  p_arr_w: number[];
  p_load_w: number[];
}

export function emptyTrace(): OrbitTrace {
  return {
    t_min: [],
    tj: [],
    t_rad_c: [],
    t_cool_c: [],
    f: [],
    soc_frac: [],
    illum: [],
    p_arr_w: [],
    p_load_w: [],
  };
}

/**
 * Energy audit over the final full orbit [Wh]. By construction
 *   e_arr_used - e_load_served - e_loss_chg - e_loss_dis
 *     = (soc_end - soc_start) + e_clamp
 * which the energy-conservation validation test asserts (<1% closure).
 */
export interface EnergyAudit {
  e_arr_avail_wh: number;
  e_arr_used_wh: number;
  e_load_served_wh: number;
  e_unserved_wh: number;
  e_chg_cells_wh: number;
  e_dis_cells_wh: number;
  e_loss_chg_wh: number;
  e_loss_dis_wh: number;
  e_clamp_wh: number;
  soc_start_wh: number;
  soc_end_wh: number;
}

export function emptyAudit(): EnergyAudit {
  return {
    e_arr_avail_wh: 0,
    e_arr_used_wh: 0,
    e_load_served_wh: 0,
    e_unserved_wh: 0,
    e_chg_cells_wh: 0,
    e_dis_cells_wh: 0,
    e_loss_chg_wh: 0,
    e_loss_dis_wh: 0,
    e_clamp_wh: 0,
    soc_start_wh: 0,
    soc_end_wh: 0,
  };
}

/**
 * One unconditionally-stable radiator-node update over dt.
 *
 * The node is stiff: C dT/dt = UA(Tc - T) + q_abs - eps*sigma*T^4*A.
 * Each step linearizes the T^4 sink about the current temperature
 * (g = 4*eps*sigma*T^3*A, a Newton step for the equilibrium) and relaxes
 * exponentially with tau = C/(UA+g) — exact for the linearized system, so
 * arbitrarily large dt cannot blow up (validation test 2 exercises this on
 * an isolated node, UA = 0, against the analytic Stefan-Boltzmann
 * equilibrium T = (q/(eps*sigma*A))^(1/4)).
 */
export function radiatorNodeStep(
  tRadK: number,
  uaWK: number,
  tCoolK: number,
  qAbsW: number,
  radEps: number,
  aEffM2: number,
  cRadJK: number,
  dtS: number,
): number {
  const g = 4 * radEps * SIGMA * tRadK ** 3 * aEffM2;
  const num =
    uaWK * (tCoolK - tRadK) + qAbsW - radEps * SIGMA * tRadK ** 4 * aEffM2;
  const tEq = tRadK + num / (uaWK + g);
  const tau = cRadJK / (uaWK + g);
  return tEq + (tRadK - tEq) * Math.exp(-dtS / tau);
}

/**
 * Quasi-static junction temperature: leakage depends on Tj which depends on
 * power, so iterate the fixed point Tj = T_cool + Rth,jc * P_gpu(Tj).
 * Returns the consistent (tj, p_gpu) pair.
 */
export function tjFixedPointC(
  chip: ChipP,
  tCoolK: number,
  f: number,
  leakMult: number,
): { tj: number; pg: number } {
  let tj = tCoolK - C_TO_K + TJ_INIT_OFFSET_K;
  let pg = 0;
  for (let i = 0; i < TJ_FIXED_POINT_ITERS; i++) {
    pg = gpuPowerW(chip, f, tj, leakMult);
    tj = tCoolK - C_TO_K + chip.r_j_cw * pg;
  }
  return { tj, pg };
}

/**
 * Advance the thermal/power state through nOrbits; return metrics from the
 * final full orbit (steady-periodic approximation with warm start).
 */
export function simulateOrbit(
  cfg: Config,
  dz: Design,
  env: OrbitEnv,
  st: ThermalState,
  nOrbits = 1.5,
  dt?: number,
  trace?: OrbitTrace,
  audit?: EnergyAudit,
): OrbitMetrics {
  const ch = cfg.chip;
  const th = cfg.thermal;
  const ep = cfg.eps;
  const dtS = dt ?? cfg.mission.dt_orbit_s;
  const period = dz.period_s;
  const fe = env.fe;
  const eclA = 0.5 * (1 - fe) * period;
  const eclB = eclA + fe * period;
  const nSteps = Math.round((nOrbits * period) / dtS);
  const lastOrbitStart = (nOrbits - 1) * period;

  // Battery capacity after cycle fade (extension; frac=1 reproduces the
  // reference bit-for-bit). Carry-over SoC cannot exceed the faded capacity.
  const cap = dz.batt_cap_wh * (env.batt_cap_frac ?? 1);
  if (st.soc_wh > cap) st.soc_wh = cap;
  const disMaxC = ep.batt_c_dis * cap; // W at the discharge C-rate cap
  const chgMaxC = ep.batt_c_chg * cap;
  const tjTarget = env.tj_target_c;
  const nAlive = env.n_alive;
  const leakMult = env.leak_mult;
  const cRad = Math.max(th.rad_kg_m2 * dz.a_rad_phys * th.rad_cp_j_kgk, C_RAD_MIN_J_K);
  const aEff = dz.a_rad_eff;
  const kp = DVFS_KP_PER_30S * (dtS / DVFS_KP_DT_REF_S);

  // accumulators over the last full orbit
  let sF = 0;
  let sTj = 0;
  let sTrad = 0;
  let tjMax = -1e9;
  let tjMin = 1e9;
  let socMin = cap > 0 ? cap : 0;
  let nPowLim = 0;
  let nThLim = 0;
  let nIdle = 0;
  let nLast = 0;

  const aud = audit ?? emptyAudit();
  let audStarted = false;

  /** Bus load and IT power at frequency fq given the current coolant temp. */
  const loadAt = (fq: number): { pLoad: number; pIt: number } => {
    const { tj } = tjFixedPointC(ch, st.t_cool_k, fq, leakMult);
    const pIt = nAlive * (gpuPowerW(ch, fq, tj, leakMult) + otherPowerW(ch, fq));
    return { pLoad: pIt * (1 + th.pump_frac) + ep.aux_w, pIt };
  };

  for (let i = 0; i < nSteps; i++) {
    const t = i * dtS;
    const tau = t % period;
    const illum = !(eclA <= tau && tau < eclB);
    const pArr = illum ? env.p_arr_w : 0;
    const accounting = t >= lastOrbitStart;
    if (accounting && audit && !audStarted) {
      aud.soc_start_wh = st.soc_wh;
      audStarted = true;
    }

    // --- DVFS thermal controller (proportional, slew-limited)
    const est = tjFixedPointC(ch, st.t_cool_k, st.f, leakMult);
    const err = est.tj - tjTarget;
    let f = st.f - kp * err;
    f = Math.min(1, Math.max(ch.f_min, f));
    f = Math.min(st.f + F_SLEW_UP, Math.max(st.f - F_SLEW_DOWN, f));
    const thermalLimited = err > THERMAL_LIMITED_ERR_K && f < F_NEAR_ONE;

    // --- supply dispatch (power cap): can array + battery carry the load?
    const disEnergyW = cap > 0 ? ((st.soc_wh * 3600) / dtS) * SOC_ACCESS_FRAC : 0;
    const disAvail = Math.min(disMaxC, disEnergyW);
    const supply = pArr + disAvail;

    let { pLoad, pIt } = loadAt(f);
    let powerLimited = false;
    let idle = false;
    if (pLoad > supply) {
      const lo = loadAt(ch.f_min);
      if (lo.pLoad > supply) {
        // below f_min even: drop to idle/safe mode
        idle = true;
        f = ch.f_min; // controller restart point after eclipse
        pLoad = dz.idle_w;
        pIt = ((ch.idle_frac_of_design * nAlive) / ch.n_gpu) * dz.q_design_w * IDLE_P_IT_SCALE;
        pIt = Math.min(pIt, pLoad);
      } else {
        // bisect the DVFS frequency down to the supportable level
        powerLimited = true;
        let flo = ch.f_min;
        let fhi = f;
        for (let b = 0; b < DISPATCH_BISECT_ITERS; b++) {
          const mid = 0.5 * (flo + fhi);
          if (loadAt(mid).pLoad > supply) fhi = mid;
          else flo = mid;
        }
        f = flo;
        ({ pLoad, pIt } = loadAt(f));
      }
    }

    // --- battery energy balance (round-trip efficiencies, rate caps)
    if (cap > 0) {
      let chg = 0;
      let deficit = 0;
      if (pArr >= pLoad) {
        const roomW = ((cap - st.soc_wh) * 3600) / dtS;
        chg = Math.min(pArr - pLoad, chgMaxC, roomW);
        st.soc_wh += (chg * ep.batt_eta_chg * dtS) / 3600;
      } else {
        deficit = Math.min(pLoad - pArr, disAvail);
        st.soc_wh -= (deficit / ep.batt_eta_dis) * (dtS / 3600);
      }
      const socRaw = st.soc_wh;
      st.soc_wh = Math.min(Math.max(st.soc_wh, 0), cap);
      if (accounting && audit) {
        const h = dtS / 3600;
        aud.e_clamp_wh += socRaw - st.soc_wh;
        if (pArr >= pLoad) {
          aud.e_arr_used_wh += (pLoad + chg) * h;
          aud.e_load_served_wh += pLoad * h;
          aud.e_chg_cells_wh += chg * ep.batt_eta_chg * h;
          aud.e_loss_chg_wh += chg * (1 - ep.batt_eta_chg) * h;
        } else {
          const served = Math.min(pLoad, pArr + deficit);
          aud.e_arr_used_wh += pArr * h;
          aud.e_load_served_wh += served * h;
          aud.e_unserved_wh += Math.max(0, pLoad - served) * h;
          aud.e_dis_cells_wh += (deficit / ep.batt_eta_dis) * h;
          aud.e_loss_dis_wh += deficit * (1 / ep.batt_eta_dis - 1) * h;
        }
      }
    } else if (accounting && audit) {
      const h = dtS / 3600;
      const served = Math.min(pLoad, pArr);
      aud.e_arr_used_wh += served * h;
      aud.e_load_served_wh += served * h;
      aud.e_unserved_wh += Math.max(0, pLoad - served) * h;
    }
    if (accounting && audit) aud.e_arr_avail_wh += (pArr * dtS) / 3600;

    // --- thermal network update (order matters: coolant first, then the
    //     radiator sees the updated coolant temperature — Gauss-Seidel)
    const qCool = !idle
      ? pIt * (1 + th.pump_frac) + AUX_HEAT_FRAC * ep.aux_w
      : dz.idle_w * IDLE_HEAT_FRAC;
    const qAbs = qAbsWM2(th, env.alpha, illum) * aEff;

    // coolant node relaxes toward radiator + Q/UA with tau = C/UA
    const tCoolEq = st.t_rad_k + qCool / dz.ua_w_k;
    const tauC = th.c_cool_j_k / dz.ua_w_k;
    st.t_cool_k = tCoolEq + (st.t_cool_k - tCoolEq) * Math.exp(-dtS / tauC);

    // radiator node: UA in, eps*sigma*T^4 out, env flux in (see
    // radiatorNodeStep for the stiffness treatment — never explicit Euler)
    st.t_rad_k = radiatorNodeStep(
      st.t_rad_k,
      dz.ua_w_k,
      st.t_cool_k,
      qAbs,
      th.rad_eps,
      aEff,
      cRad,
      dtS,
    );

    st.f = f;
    const now = tjFixedPointC(ch, st.t_cool_k, idle ? ch.f_min : f, leakMult);
    const tjNow = now.tj;
    st.p_gpu_last = idle ? IDLE_P_GPU_TDP_FRAC * ch.tdp_w : now.pg;

    // hard-limit safeguard: emergency frequency cut above Tj_max
    if (tjNow > ch.tj_max_c && !idle) {
      st.f = Math.max(ch.f_min, st.f - TJ_HARD_LIMIT_F_STEP);
    }

    if (accounting) {
      nLast += 1;
      const fEff = idle ? 0 : f;
      if (trace) {
        trace.t_min.push((t - lastOrbitStart) / 60);
        trace.tj.push(tjNow);
        trace.t_rad_c.push(st.t_rad_k - C_TO_K);
        trace.t_cool_c.push(st.t_cool_k - C_TO_K);
        trace.f.push(fEff);
        trace.soc_frac.push(cap > 0 ? st.soc_wh / cap : 1);
        trace.illum.push(illum ? 1 : 0);
        trace.p_arr_w.push(pArr);
        trace.p_load_w.push(pLoad);
      }
      sF += fEff;
      sTj += tjNow;
      sTrad += st.t_rad_k;
      if (tjNow > tjMax) tjMax = tjNow;
      if (tjNow < tjMin) tjMin = tjNow;
      if (cap > 0 && st.soc_wh < socMin) socMin = st.soc_wh;
      if (powerLimited) nPowLim += 1;
      if (thermalLimited) nThLim += 1;
      if (idle) nIdle += 1;
    }
  }

  if (audit) aud.soc_end_wh = st.soc_wh;
  const n = Math.max(nLast, 1);
  return {
    f_mean: sF / n,
    tj_mean: sTj / n,
    tj_max: tjMax,
    dtj_cycle: tjMax - tjMin,
    t_rad_mean_c: sTrad / n - C_TO_K,
    dod: cap > 0 ? (cap - socMin) / cap : 0,
    frac_power_limited: nPowLim / n,
    frac_thermal_limited: nThLim / n,
    frac_idle: nIdle / n,
  };
}

/**
 * Re-index a final-orbit trace by orbit phase [0, period) so the UI can
 * sample it at the live orbital position (the steady-periodic approximation
 * says every orbit in the epoch looks like this one).
 */
export interface PhaseTrace {
  phase_s: Float64Array;
  tj: Float64Array;
  t_rad_c: Float64Array;
  t_cool_c: Float64Array;
  f: Float64Array;
  soc_frac: Float64Array;
  illum: Float64Array;
  p_arr_w: Float64Array;
  p_load_w: Float64Array;
}

export function rebaseTraceToPhase(
  tr: OrbitTrace,
  periodS: number,
  lastOrbitStartS: number,
): PhaseTrace {
  const n = tr.t_min.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  const phase = tr.t_min.map((tm) => (lastOrbitStartS + tm * 60) % periodS);
  idx.sort((a, b) => phase[a] - phase[b]);
  const pick = (src: number[]): Float64Array =>
    Float64Array.from(idx, (j) => src[j]);
  return {
    phase_s: Float64Array.from(idx, (j) => phase[j]),
    tj: pick(tr.tj),
    t_rad_c: pick(tr.t_rad_c),
    t_cool_c: pick(tr.t_cool_c),
    f: pick(tr.f),
    soc_frac: pick(tr.soc_frac),
    illum: pick(tr.illum),
    p_arr_w: pick(tr.p_arr_w),
    p_load_w: pick(tr.p_load_w),
  };
}
