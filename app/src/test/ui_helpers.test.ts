/**
 * UI helper tests: display formatting, slider math round-trips, and the
 * pure telemetry-to-chart marshaling. The React/uPlot layer is exercised in
 * the browser; everything data-shaped is verified here.
 */
import { describe, expect, it } from "vitest";
import { runMission } from "../core/mission";
import { rebaseTraceToPhase } from "../core/orbitloop";
import { MissionSim } from "../core/mission";
import { PARAM_META, baselineDd, getParam } from "../core/params";
import {
  clamp,
  fmtDuration,
  fmtNum,
  fmtPct,
  fmtWarp,
  roundDust,
  stepDecimals,
} from "../ui/format";
import { posToVal, valToPos, SLIDER_STEPS } from "../ui/sliderMath";
import { missionSeries, offBands, orbitSeries } from "../ui/telemetryData";

describe("format helpers", () => {
  it("stepDecimals matches slider steps", () => {
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(10)).toBe(0);
    expect(stepDecimals(0.1)).toBe(1);
    expect(stepDecimals(0.05)).toBe(2);
    expect(stepDecimals(0.001)).toBe(3);
  });

  it("roundDust strips binary float dust", () => {
    expect(roundDust(0.1 + 0.2)).toBe(0.3);
    expect(roundDust(0)).toBe(0);
    expect(roundDust(5e-12)).toBe(5e-12);
  });

  it("fmtDuration picks sensible units", () => {
    expect(fmtDuration(3.15576e7)).toBe("1.00 yr");
    expect(fmtDuration(86400 * 10)).toBe("10.0 d");
    expect(fmtDuration(3600 * 3)).toBe("3.0 h");
    expect(fmtDuration(150)).toBe("2.5 min");
    expect(fmtDuration(90)).toBe("90 s");
  });

  it("fmtNum / fmtPct / fmtWarp", () => {
    expect(fmtNum(null)).toBe("–");
    expect(fmtNum(147.03)).toBe("147");
    expect(fmtNum(0.0123)).toBe("0.0123");
    expect(fmtNum(5e-12)).toBe("5.0e-12");
    expect(fmtPct(0.376, 1)).toBe("37.6%");
    expect(fmtWarp(3000)).toBe("3,000×");
  });

  it("clamp", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
  });
});

describe("slider math", () => {
  it("round-trips every schema default through its slider", () => {
    const cfg = baselineDd();
    for (const m of PARAM_META) {
      const v = getParam(cfg, m.path);
      const pos = valToPos(m, v);
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(pos).toBeLessThanOrEqual(SLIDER_STEPS);
      const back = posToVal(m, pos);
      // one slider quantum of tolerance (log sliders snap to 3 sig figs)
      const span = m.log ? v * 0.02 : (m.max - m.min) / SLIDER_STEPS + m.step;
      expect(Math.abs(back - v)).toBeLessThanOrEqual(span + 1e-12);
    }
  });

  it("endpoints map exactly", () => {
    for (const m of PARAM_META) {
      expect(posToVal(m, 0)).toBeCloseTo(m.min, 9);
      expect(posToVal(m, SLIDER_STEPS)).toBeCloseTo(m.max, 9);
    }
  });

  it("int params yield integers everywhere", () => {
    const m = PARAM_META.find((x) => x.path === "chip.n_gpu")!;
    for (let p = 0; p <= SLIDER_STEPS; p += 37) {
      expect(Number.isInteger(posToVal(m, p))).toBe(true);
    }
  });
});

describe("telemetry marshaling", () => {
  it("offBands finds contiguous eclipse windows", () => {
    const x = [0, 1, 2, 3, 4, 5, 6];
    const on = [1, 1, 0, 0, 0, 1, 1];
    expect(offBands(x, on)).toEqual([[2, 4]]);
    expect(offBands(x, [0, 0, 1, 1, 1, 0, 0])).toEqual([
      [0, 1],
      [5, 6],
    ]);
    expect(offBands(x, [1, 1, 1, 1, 1, 1, 1])).toEqual([]);
  });

  it("orbitSeries converts units and flags eclipse from an eclipsing orbit", () => {
    const cfg = baselineDd();
    cfg.orbit.profile = "custom";
    cfg.orbit.beta_mean_deg = 0; // guaranteed eclipse at beta = 0
    cfg.orbit.beta_amp_deg = 0;
    const sim = new MissionSim(cfg);
    const out = sim.stepEpoch({ trace: true })!;
    const pt = rebaseTraceToPhase(
      out.trace!,
      sim.design.period_s,
      0, // phase origin irrelevant for this check
    );
    const d = orbitSeries(pt);
    expect(d.x[d.x.length - 1]).toBeLessThanOrEqual(sim.design.period_s / 60);
    expect(d.eclipse.length).toBeGreaterThan(0);
    // fractions became percentages
    expect(Math.max(...d.socPct)).toBeLessThanOrEqual(100.0001);
    expect(Math.max(...d.fPct)).toBeLessThanOrEqual(100.0001);
    // power in kW, array peaks around the design load scale (tens of kW)
    expect(Math.max(...d.pArrKw)).toBeGreaterThan(10);
    expect(Math.max(...d.pArrKw)).toBeLessThan(1000);
  });

  it("missionSeries maps rows and marks SPE epochs", () => {
    const cfg = baselineDd();
    cfg.mission.years = 2;
    cfg.mission.stochastic = true;
    cfg.mission.seed = 42;
    const res = runMission(cfg);
    const d = missionSeries(
      res.hist,
      cfg.chip.n_gpu,
      cfg.chip.n_gpu * cfg.chip.pflops_nominal,
    );
    expect(d.x.length).toBe(res.hist.length);
    expect(d.nameplate[0]).toBe(32);
    expect(d.alivePct[0]).toBeLessThanOrEqual(100);
    expect(d.tidKrad[d.tidKrad.length - 1]).toBeGreaterThan(0);
    const nSpe = res.hist.filter((r) => r.spe_frac > 0).length;
    expect(d.spe.length).toBe(nSpe);
  });
});
