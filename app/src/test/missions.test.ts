/**
 * Full-mission parity with the Python reference (validation test 9 of
 * simulator.md: baseline outputs within 2%; in practice the only divergence
 * is the documented Earth-radius choice, so the baseline is also held to a
 * 0.5% tripwire). Cycle fade is zeroed for parity (the reference defines
 * batt_fade_ref but never applies it); a separate test checks the default
 * config, fade active, still meets the 2% acceptance bound.
 */
import { describe, it } from "vitest";
import { runMission } from "../core/mission";
import { expectClose, FIXTURE_CONFIGS, loadFixture, noFade } from "./helpers";

interface MissionFix {
  delivered_pflop_yr: number;
  nameplate_pflop_yr: number;
  per_tonne: number;
  utilization: number;
  mass_total_kg: number;
  losses: Record<string, number>;
  hist: Record<string, number[]>;
}

const M = loadFixture<Record<string, MissionFix>>("missions");

describe("mission parity with sdcsim", () => {
  for (const [name, fix] of Object.entries(M)) {
    it(`${name} (2% acceptance bound)`, () => {
      const cfg = noFade(FIXTURE_CONFIGS[name]());
      const res = runMission(cfg);
      const s = res.summary;
      expectClose(s.delivered_pflop_yr, fix.delivered_pflop_yr, 0.02, 0, `${name} delivered`);
      expectClose(s.nameplate_pflop_yr, fix.nameplate_pflop_yr, 1e-9, 0, `${name} nameplate`);
      expectClose(s.mass_total_kg, fix.mass_total_kg, 0.02, 0, `${name} mass`);
      expectClose(s.per_tonne, fix.per_tonne, 0.02, 0, `${name} per_tonne`);
      for (const [k, v] of Object.entries(fix.losses)) {
        expectClose(
          s.losses[k as keyof typeof s.losses],
          v,
          0.05,
          0.3,
          `${name} loss ${k}`,
        );
      }
      // History spot checks
      const n = fix.hist.n_alive.length;
      expectClose(res.hist.length, n, 0, 0, `${name} epochs`);
      expectClose(
        res.hist[n - 1].n_alive,
        fix.hist.n_alive[n - 1],
        0.01,
        0.05,
        `${name} final n_alive`,
      );
      expectClose(
        res.hist[n - 1].tid_krad,
        fix.hist.tid_krad[n - 1],
        0.005,
        0,
        `${name} final TID`,
      );
      const fMeanTs = res.hist.reduce((a, r) => a + r.f_mean, 0) / n;
      const fMeanPy = fix.hist.f_mean.reduce((a, b) => a + b, 0) / n;
      expectClose(fMeanTs, fMeanPy, 0, 0.005, `${name} mission-mean f`);
    });
  }

  it("baseline holds a 0.5% tripwire (port-bug detector)", () => {
    const res = runMission(noFade(FIXTURE_CONFIGS.baseline_dd()));
    const fix = M.baseline_dd;
    expectClose(res.summary.delivered_pflop_yr, fix.delivered_pflop_yr, 0.005, 0);
    expectClose(res.summary.mass_total_kg, fix.mass_total_kg, 0.005, 0);
    expectClose(res.summary.per_tonne, fix.per_tonne, 0.005, 0);
  });

  it("default config (cycle fade active) still meets the 2% bound", () => {
    const res = runMission(FIXTURE_CONFIGS.baseline_dd());
    const fix = M.baseline_dd;
    expectClose(res.summary.delivered_pflop_yr, fix.delivered_pflop_yr, 0.02, 0);
    expectClose(res.summary.per_tonne, fix.per_tonne, 0.02, 0);
  });
});
