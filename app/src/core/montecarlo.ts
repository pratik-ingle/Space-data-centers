/**
 * Monte-Carlo wrapper: environment & model-parameter uncertainty (port of
 * sdcsim/montecarlo.py, re-seeded on mulberry32 for browser determinism).
 *
 * Samples multiplicative uncertainties on the least-well-known inputs (dose
 * rate, SEU rate, hard-failure rate, coating drift, array degradation, TID
 * hardness) plus a random solar-cycle phase, runs the stochastic mission for
 * each draw, and reports the delivered-compute distribution and a Spearman
 * rank-correlation sensitivity ranking.
 */
import { MissionSim } from "./mission";
import type { Config } from "./params";
import { mulberry32 } from "./rng";
import type { Rng } from "./rng";

interface SampledParam {
  label: string;
  kind: "logn" | "unif";
  /** lognormal sigma, or uniform [lo, hi]. */
  p: number | [number, number];
  apply: (cfg: Config, x: number) => void;
}

/** Lognormals use mean = -sigma^2/2 so the multiplier has expectation 1. */
export const SAMPLED: SampledParam[] = [
  { label: "dose rate x", kind: "logn", p: 0.5, apply: (c, x) => void (c.rad.dose_scale *= x) },
  { label: "SEU rate x", kind: "logn", p: 0.6, apply: (c, x) => void (c.rad.seu_scale *= x) },
  { label: "hard AFR x", kind: "logn", p: 0.35, apply: (c, x) => void (c.rel.afr_scale *= x) },
  {
    label: "coating drift x",
    kind: "unif",
    p: [0.7, 1.5],
    apply: (c, x) => void (c.thermal.rad_alpha_drift *= x),
  },
  {
    label: "array degr x",
    kind: "logn",
    p: 0.3,
    apply: (c, x) => void (c.eps.arr_degr_per_yr *= x),
  },
  {
    label: "TID hardness x",
    kind: "logn",
    p: 0.25,
    apply: (c, x) => void (c.rad.tid_char_krad *= x),
  },
  {
    label: "solar phase",
    kind: "unif",
    p: [0, 2 * Math.PI],
    apply: (c, x) => void (c.mission.solar_phase0 = x),
  },
];

function sampleOne(rng: Rng, s: SampledParam): number {
  if (s.kind === "logn") {
    const sigma = s.p as number;
    return rng.lognormal(-0.5 * sigma * sigma, sigma);
  }
  const [lo, hi] = s.p as [number, number];
  return rng.uniform(lo, hi);
}

/** numpy-style linear-interpolation percentile of an unsorted sample. */
export function percentile(values: number[], q: number): number {
  const v = [...values].sort((a, b) => a - b);
  const pos = (q / 100) * (v.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, v.length - 1);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/** Rank-transform to zero-mean unit-variance scores (Spearman helper). */
function rankz(v: number[]): number[] {
  const n = v.length;
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => v[a] - v[b] || a - b,
  );
  const r = new Array<number>(n);
  for (let pos = 0; pos < n; pos++) r[order[pos]] = pos;
  const mean = (n - 1) / 2;
  let sd = 0;
  for (const x of r) sd += (x - mean) ** 2;
  sd = Math.max(Math.sqrt(sd / n), 1e-12);
  return r.map((x) => (x - mean) / sd);
}

export interface MonteCarloResult {
  /** Sampled multipliers, X[run][param]. */
  X: number[][];
  delivered: number[];
  per_tonne: number[];
  survivors: number[];
  /** Spearman rank correlation of each input with delivered compute. */
  sensitivity: Record<string, number>;
  p5: number;
  p50: number;
  p95: number;
  labels: string[];
}

/**
 * Run the ensemble. A single seeded stream drives both the parameter draws
 * and every stochastic mission, so a fixed seed is bit-reproducible.
 */
export function runMonteCarlo(
  cfg: Config,
  nRuns = cfg.mission.mc_runs,
  seed = cfg.mission.seed,
  onProgress?: (done: number, total: number) => void,
): MonteCarloResult {
  const rng = mulberry32(seed);
  const X: number[][] = [];
  for (let i = 0; i < nRuns; i++) {
    X.push(SAMPLED.map((s) => sampleOne(rng, s)));
  }

  const delivered: number[] = [];
  const perTonne: number[] = [];
  const survivors: number[] = [];
  for (let i = 0; i < nRuns; i++) {
    const c = structuredClone(cfg);
    SAMPLED.forEach((s, j) => s.apply(c, X[i][j]));
    // Each mission consumes the same continuing stream (as the reference
    // does with its numpy Generator), so one seed fixes the whole ensemble.
    const res = new MissionSim(c, { stochastic: true, rng }).run();
    delivered.push(res.summary.delivered_pflop_yr);
    perTonne.push(res.summary.per_tonne);
    survivors.push(res.summary.final_n_alive);
    onProgress?.(i + 1, nRuns);
  }

  const zy = rankz(delivered);
  const sensitivity: Record<string, number> = {};
  SAMPLED.forEach((s, j) => {
    const zx = rankz(X.map((row) => row[j]));
    let acc = 0;
    for (let i = 0; i < nRuns; i++) acc += zx[i] * zy[i];
    sensitivity[s.label] = acc / nRuns;
  });

  return {
    X,
    delivered,
    per_tonne: perTonne,
    survivors,
    sensitivity,
    p5: percentile(delivered, 5),
    p50: percentile(delivered, 50),
    p95: percentile(delivered, 95),
    labels: SAMPLED.map((s) => s.label),
  };
}
