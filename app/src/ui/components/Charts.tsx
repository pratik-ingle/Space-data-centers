/**
 * Telemetry charts: orbit-scale (one steady-periodic orbit of the current
 * epoch) and mission-scale (per-epoch history). Time axis is switchable
 * between the two, per the UI spec. One unit family per chart — never a
 * dual axis.
 */
import { useMemo, useState } from "react";
import type uPlot from "uplot";
import { SECONDS_PER_YEAR } from "../../core/constants";
import { fmtFixed } from "../format";
import { CHROME, SERIES } from "../palette";
import { useStudio } from "../store";
import { missionSeries, orbitSeries } from "../telemetryData";
import type { BandSpec } from "./UPlotChart";
import { UPlotChart } from "./UPlotChart";

const FONT = "11px system-ui, -apple-system, 'Segoe UI', sans-serif";
const CHART_H = 128;

interface SeriesSpec {
  label: string;
  color: string;
  dash?: number[];
  width?: number;
}

interface OptArgs {
  title: string;
  syncKey: string;
  xMax: number;
  series: SeriesSpec[];
  /** Fixed 0..105 percent scale. */
  yPct?: boolean;
  /** Anchor auto range at zero. */
  yFromZero?: boolean;
  /** Legend value decimals. */
  dec?: number;
}

function mkOpts(a: OptArgs): Omit<uPlot.Options, "width" | "height"> {
  const axis: uPlot.Axis = {
    stroke: CHROME.inkMuted,
    font: FONT,
    ticks: { stroke: CHROME.baseline, width: 1, size: 4 },
    grid: { stroke: CHROME.grid, width: 1 },
  };
  const dec = a.dec ?? 1;
  const yRange: uPlot.Scale.Range = a.yPct
    ? () => [0, 105]
    : (_u, min, max) => {
        if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
        const lo = a.yFromZero ? 0 : min;
        const pad = 0.08 * Math.max(max - lo, Math.abs(max), 1e-9);
        return [a.yFromZero ? 0 : min - pad, max + pad];
      };
  return {
    title: a.title,
    cursor: {
      sync: { key: a.syncKey },
      y: false,
      drag: { x: false, y: false },
      points: { size: 6 },
    },
    legend: { live: true, show: a.series.length > 1 },
    scales: {
      x: { time: false, range: () => [0, a.xMax] },
      y: { range: yRange },
    },
    axes: [
      { ...axis, size: 26 },
      { ...axis, size: 46 },
    ],
    series: [
      {},
      ...a.series.map(
        (s): uPlot.Series => ({
          label: s.label,
          stroke: s.color,
          width: s.width ?? 1.5,
          dash: s.dash,
          // markers only while the series is too short to draw a line
          points: { show: (u) => (u.data[0]?.length ?? 0) < 3, size: 5 },
          value: (_u, v) => (v == null ? "–" : fmtFixed(v, dec)),
        }),
      ),
    ],
  };
}

function OrbitCharts() {
  const trace = useStudio((s) => s.trace);
  const periodS = useStudio((s) => s.periodS);
  const phaseMin = useStudio((s) => s.tick.phaseS) / 60;
  const d = useMemo(() => (trace ? orbitSeries(trace) : null), [trace]);
  const xMax = Math.max(periodS / 60, 1);

  const tempOpts = useMemo(
    () =>
      mkOpts({
        title: "Temperatures · °C",
        syncKey: "orbit",
        xMax,
        series: [
          { label: "Tj", color: SERIES.tj },
          { label: "radiator", color: SERIES.tRad },
          { label: "coolant", color: SERIES.tCool },
        ],
      }),
    [xMax],
  );
  const powerOpts = useMemo(
    () =>
      mkOpts({
        title: "Power · kW",
        syncKey: "orbit",
        xMax,
        yFromZero: true,
        series: [
          { label: "array", color: SERIES.pArr },
          { label: "load", color: SERIES.pLoad },
        ],
      }),
    [xMax],
  );
  const dutyOpts = useMemo(
    () =>
      mkOpts({
        title: "DVFS clock & battery · %",
        syncKey: "orbit",
        xMax,
        yPct: true,
        dec: 0,
        series: [
          { label: "f", color: SERIES.f },
          { label: "SoC", color: SERIES.soc },
        ],
      }),
    [xMax],
  );

  const eclipse = useMemo<BandSpec[]>(
    () => (d ? [{ ranges: d.eclipse, color: CHROME.eclipseFill }] : []),
    [d],
  );

  if (!d) return <div className="chart-empty">waiting for first epoch…</div>;
  return (
    <>
      <UPlotChart
        opts={tempOpts}
        height={CHART_H}
        data={[d.x, d.tj, d.tRad, d.tCool]}
        bands={eclipse}
        cursorX={phaseMin}
      />
      <UPlotChart
        opts={powerOpts}
        height={CHART_H}
        data={[d.x, d.pArrKw, d.pLoadKw]}
        bands={eclipse}
        cursorX={phaseMin}
      />
      <UPlotChart
        opts={dutyOpts}
        height={CHART_H}
        data={[d.x, d.fPct, d.socPct]}
        bands={eclipse}
        cursorX={phaseMin}
      />
    </>
  );
}

function MissionCharts() {
  const rows = useStudio((s) => s.rows);
  const nGpu = useStudio((s) => s.cfg.chip.n_gpu);
  const pflopsNominal = useStudio((s) => s.cfg.chip.pflops_nominal);
  const years = useStudio((s) => s.cfg.mission.years);
  const stochasticRun = useStudio((s) => s.stochasticRun);
  const timeYr = useStudio((s) => s.tick.timeS) / SECONDS_PER_YEAR;

  const d = useMemo(
    () => missionSeries(rows, nGpu, nGpu * pflopsNominal, stochasticRun),
    [rows, nGpu, pflopsNominal, stochasticRun],
  );
  const xMax = years;

  const computeOpts = useMemo(
    () =>
      mkOpts({
        title: "Effective compute · PFLOPS",
        syncKey: "mission",
        xMax,
        yFromZero: true,
        series: [
          { label: "delivered", color: SERIES.pflops },
          { label: "nameplate", color: CHROME.reference, dash: [5, 5], width: 1 },
        ],
      }),
    [xMax],
  );
  const fleetOpts = useMemo(
    () =>
      mkOpts({
        title: "Fleet & battery · %",
        syncKey: "mission",
        xMax,
        yPct: true,
        dec: 0,
        series: [
          { label: "GPUs alive", color: SERIES.alive },
          { label: "batt capacity", color: SERIES.battCap, dash: [6, 4] },
          { label: "DoD", color: SERIES.dod },
        ],
      }),
    [xMax],
  );
  const tempOpts = useMemo(
    () =>
      mkOpts({
        title: "Temperatures · °C",
        syncKey: "mission",
        xMax,
        series: [
          { label: "Tj mean", color: SERIES.tj },
          { label: "Tj max", color: SERIES.tjMax, dash: [3, 3], width: 1 },
          { label: "radiator", color: SERIES.tRad },
        ],
      }),
    [xMax],
  );
  const powerOpts = useMemo(
    () =>
      mkOpts({
        title: "Power · kW",
        syncKey: "mission",
        xMax,
        yFromZero: true,
        series: [
          { label: "array (sunlit)", color: SERIES.pArr },
          { label: "design load", color: SERIES.pLoad },
        ],
      }),
    [xMax],
  );
  const doseOpts = useMemo(
    () =>
      mkOpts({
        title: "Accumulated dose · krad (storms shaded when sampled)",
        syncKey: "mission",
        xMax,
        yFromZero: true,
        series: [{ label: "TID", color: SERIES.tid }],
      }),
    [xMax],
  );
  const dutyOpts = useMemo(
    () =>
      mkOpts({
        title: "Throttle & tax · %",
        syncKey: "mission",
        xMax,
        yFromZero: true,
        dec: 2,
        series: [
          { label: "mean clock", color: SERIES.f },
          { label: "checkpoint tax", color: SERIES.ovh },
          { label: "idle share", color: SERIES.idle, dash: [6, 4] },
        ],
      }),
    [xMax],
  );

  const speBands = useMemo<BandSpec[]>(
    () => (d.spe.length ? [{ ranges: d.spe, color: CHROME.speFill }] : []),
    [d],
  );

  if (!rows.length)
    return <div className="chart-empty">waiting for first epoch…</div>;
  return (
    <>
      <UPlotChart
        opts={computeOpts}
        height={CHART_H}
        data={[d.x, d.effPflops, d.nameplate]}
        cursorX={timeYr}
      />
      <UPlotChart
        opts={fleetOpts}
        height={CHART_H}
        data={[d.x, d.alivePct, d.battCapPct, d.dodPct]}
        cursorX={timeYr}
      />
      <UPlotChart
        opts={tempOpts}
        height={CHART_H}
        data={[d.x, d.tjMean, d.tjMax, d.tRad]}
        cursorX={timeYr}
      />
      <UPlotChart
        opts={powerOpts}
        height={CHART_H}
        data={[d.x, d.pArrKw, d.loadKw]}
        cursorX={timeYr}
      />
      <UPlotChart
        opts={doseOpts}
        height={CHART_H}
        data={[d.x, d.tidKrad]}
        bands={speBands}
        cursorX={timeYr}
      />
      <UPlotChart
        opts={dutyOpts}
        height={CHART_H}
        data={[d.x, d.fMeanPct, d.ovhPct, d.idlePct]}
        cursorX={timeYr}
      />
    </>
  );
}

export function ChartsPanel() {
  const [mode, setMode] = useState<"orbit" | "mission">("orbit");
  return (
    <div className="charts-panel">
      <div className="charts-tabs">
        <button
          className={mode === "orbit" ? "tab active" : "tab"}
          onClick={() => setMode("orbit")}
        >
          Orbit
        </button>
        <button
          className={mode === "mission" ? "tab active" : "tab"}
          onClick={() => setMode("mission")}
        >
          Mission
        </button>
        <span className="tabs-note">
          {mode === "orbit"
            ? "x: orbit phase [min] · eclipse shaded"
            : "x: mission time [yr]"}
        </span>
      </div>
      <div className="charts-stack">
        {mode === "orbit" ? <OrbitCharts /> : <MissionCharts />}
      </div>
    </div>
  );
}
