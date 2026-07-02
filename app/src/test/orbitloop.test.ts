/**
 * Fast-loop parity with the Python reference.
 *
 * Pinned cases: every Design field the loop reads is overridden with the
 * same round numbers on both sides, so the coupled thermal/DVFS/dispatch
 * loop itself must match to ~1e-9 (step-for-step identical port).
 *
 * Sized cases: full sizing feeds the loop; the documented Earth-radius
 * difference shifts step counts and eclipse timing slightly, so metrics get
 * physical tolerances instead.
 */
import { describe, it, expect } from "vitest";
import { sizeDesign } from "../core/design";
import type { Design } from "../core/design";
import {
  emptyTrace,
  initThermalState,
  simulateOrbit,
} from "../core/orbitloop";
import type { OrbitEnv, OrbitMetrics } from "../core/orbitloop";
import { baselineDd, issLike } from "../core/params";
import type { Config } from "../core/params";
import { expectClose, FIXTURE_CONFIGS, loadFixture } from "./helpers";

interface EnvFix {
  fe: number;
  p_arr_w: number;
  alpha: number;
  leak_mult: number;
  n_alive: number;
  tj_target_c: number;
}
interface OrbitFix {
  label: string;
  env: EnvFix;
  metrics: OrbitMetrics;
  state_end: { t_cool_k: number; t_rad_k: number; f: number; soc_wh: number };
  trace: Record<string, number[]>;
  dz?: Record<string, number>;
}

const PINNED = loadFixture<Record<string, OrbitFix>>("orbitloop_pinned");
const SIZED = loadFixture<Record<string, OrbitFix>>("orbitloop");

const PINNED_CFGS: Record<string, () => Config> = {
  baseline: () => baselineDd(),
  eclipse: () => issLike(1.0),
  lean: () => issLike(0.35),
  no_eclipse: () => baselineDd(),
  throttle: () => baselineDd(),
};

function runCase(cfg: Config, fix: OrbitFix, nOrbits: number) {
  const dz: Design = { ...sizeDesign(cfg), ...(fix.dz ?? {}) };
  const st = initThermalState(cfg, dz);
  const env: OrbitEnv = { ...fix.env };
  const trace = emptyTrace();
  const m = simulateOrbit(cfg, dz, env, st, nOrbits, undefined, trace);
  return { m, st, trace };
}

describe("orbit loop parity (pinned design -> ~1e-9)", () => {
  for (const [name, fix] of Object.entries(PINNED)) {
    it(`${name} (${fix.label})`, () => {
      const { m, st, trace } = runCase(PINNED_CFGS[name](), fix, 3.0);
      for (const [k, v] of Object.entries(fix.metrics)) {
        expectClose(m[k as keyof OrbitMetrics], v, 1e-9, 1e-9, `${name}.${k}`);
      }
      expectClose(st.t_cool_k, fix.state_end.t_cool_k, 1e-9, 1e-9, "t_cool");
      expectClose(st.t_rad_k, fix.state_end.t_rad_k, 1e-9, 1e-9, "t_rad");
      expectClose(st.f, fix.state_end.f, 1e-9, 1e-9, "f");
      expectClose(st.soc_wh, fix.state_end.soc_wh, 1e-9, 1e-6, "soc");
      // step-for-step trace parity, sampled
      const ref = fix.trace;
      expect(trace.tj.length).toBe(ref.tj.length);
      for (const key of ["t_min", "tj", "t_rad_c", "t_cool_c", "f", "soc_frac", "illum"] as const) {
        for (let i = 0; i < ref[key].length; i += 7) {
          expectClose(trace[key][i], ref[key][i], 1e-9, 1e-9, `${name}.${key}[${i}]`);
        }
      }
    });
  }
});

describe("orbit loop, fully sized designs (physical tolerances)", () => {
  for (const [name, fix] of Object.entries(SIZED)) {
    it(`${name} (${fix.label})`, () => {
      const cfg = FIXTURE_CONFIGS[
        name === "rad07_hot" ? "rad07" : name === "no_eclipse" ? "baseline_dd" : name
      ]();
      // Reference sized cases use worst_fe / BOL array power via its own
      // sizing; reproduce the env but let OUR sizing feed the loop.
      const dz = sizeDesign(cfg);
      const st = initThermalState(cfg, dz);
      const env: OrbitEnv = { ...fix.env };
      if (name !== "no_eclipse") env.fe = dz.worst_fe;
      env.p_arr_w = dz.arr_p_bol_w * cfg.eps.pmad_eff;
      const m = simulateOrbit(cfg, dz, env, st, 3.0);
      expectClose(m.tj_mean, fix.metrics.tj_mean, 0, 0.5, `${name}.tj_mean [K]`);
      expectClose(m.t_rad_mean_c, fix.metrics.t_rad_mean_c, 0, 0.5, `${name}.t_rad [K]`);
      expectClose(m.f_mean, fix.metrics.f_mean, 0, 0.01, `${name}.f_mean`);
      expectClose(m.dod, fix.metrics.dod, 0, 0.02, `${name}.dod`);
      expectClose(m.dtj_cycle, fix.metrics.dtj_cycle, 0.02, 1.0, `${name}.dtj`);
      expectClose(m.frac_idle, fix.metrics.frac_idle, 0, 0.03, `${name}.idle`);
      expectClose(
        m.frac_power_limited,
        fix.metrics.frac_power_limited,
        0,
        0.03,
        `${name}.powlim`,
      );
    });
  }
});
