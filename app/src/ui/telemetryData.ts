/**
 * Pure marshaling of worker telemetry into chart-ready aligned arrays.
 * No DOM, no uPlot imports — unit-testable in node. Display units are
 * chosen here (degC stays, W -> kW, fractions -> %).
 */
import type { EpochRow } from "../core/mission";
import type { PhaseTrace } from "../core/orbitloop";

export type Band = [number, number];

/**
 * Contiguous x-ranges where `on[i] < thr` (e.g. eclipse = illum < 0.5).
 * Range edges sit at the first/last affected sample.
 */
export function offBands(
  xs: ArrayLike<number>,
  on: ArrayLike<number>,
  thr = 0.5,
): Band[] {
  const out: Band[] = [];
  let start: number | null = null;
  const n = xs.length;
  for (let i = 0; i < n; i++) {
    const off = on[i] < thr;
    if (off && start === null) start = xs[i];
    if (!off && start !== null) {
      out.push([start, xs[i - 1]]);
      start = null;
    }
  }
  if (start !== null) out.push([start, xs[n - 1]]);
  return out;
}

export interface OrbitSeriesData {
  /** Orbit phase [min]. */
  x: Float64Array;
  tj: Float64Array;
  tRad: Float64Array;
  tCool: Float64Array;
  /** DVFS clock [%]. */
  fPct: Float64Array;
  /** Battery state of charge [%]. */
  socPct: Float64Array;
  pArrKw: Float64Array;
  pLoadKw: Float64Array;
  /** Eclipse windows in x units. */
  eclipse: Band[];
}

export function orbitSeries(tr: PhaseTrace): OrbitSeriesData {
  const x = Float64Array.from(tr.phase_s, (s) => s / 60);
  return {
    x,
    tj: tr.tj,
    tRad: tr.t_rad_c,
    tCool: tr.t_cool_c,
    fPct: Float64Array.from(tr.f, (v) => 100 * v),
    socPct: Float64Array.from(tr.soc_frac, (v) => 100 * v),
    pArrKw: Float64Array.from(tr.p_arr_w, (v) => v / 1e3),
    pLoadKw: Float64Array.from(tr.p_load_w, (v) => v / 1e3),
    eclipse: offBands(x, tr.illum),
  };
}

export interface MissionSeriesData {
  /** Mission time [yr]. */
  x: number[];
  effPflops: number[];
  /** Nameplate reference [PFLOPS] (constant). */
  nameplate: number[];
  alivePct: number[];
  battCapPct: number[];
  dodPct: number[];
  tjMean: number[];
  tjMax: number[];
  tRad: number[];
  pArrKw: number[];
  loadKw: number[];
  tidKrad: number[];
  fMeanPct: number[];
  ovhPct: number[];
  idlePct: number[];
  /** Epochs containing solar particle events (stochastic runs). */
  spe: Band[];
}

export function missionSeries(
  rows: EpochRow[],
  nGpu: number,
  nameplatePflops: number,
  /** Only sampled (stochastic) runs have discrete storms to mark; in
   *  expected-value mode spe_frac is a small nonzero mean every epoch. */
  markSpe = true,
): MissionSeriesData {
  const n = rows.length;
  const x = rows.map((r) => r.t_yr);
  const halfDt = n > 1 ? (x[1] - x[0]) / 2 : 0.02;
  const spe: Band[] = [];
  if (markSpe) {
    for (const r of rows) {
      if (r.spe_frac > 0) spe.push([r.t_yr - halfDt, r.t_yr + halfDt]);
    }
  }
  return {
    x,
    effPflops: rows.map((r) => r.eff_pflops),
    nameplate: rows.map(() => nameplatePflops),
    alivePct: rows.map((r) => (100 * r.n_alive) / nGpu),
    battCapPct: rows.map((r) => 100 * r.batt_cap_frac),
    dodPct: rows.map((r) => 100 * r.dod),
    tjMean: rows.map((r) => r.tj_mean),
    tjMax: rows.map((r) => r.tj_max),
    tRad: rows.map((r) => r.t_rad_c),
    pArrKw: rows.map((r) => r.p_arr_kw),
    loadKw: rows.map((r) => r.load_kw),
    tidKrad: rows.map((r) => r.tid_krad),
    fMeanPct: rows.map((r) => 100 * r.f_mean),
    ovhPct: rows.map((r) => 100 * r.ovh),
    idlePct: rows.map((r) => 100 * r.frac_idle),
    spe,
  };
}
