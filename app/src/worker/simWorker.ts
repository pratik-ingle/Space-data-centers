/**
 * Live mission engine (Web Worker). Owns a MissionSim and paces it against
 * the wall clock at the requested time-warp: epochs are processed exactly as
 * in the reference epoch loop the moment the mission clock enters them, and
 * the in-orbit telemetry shown between epoch boundaries is the epoch's
 * steady-periodic orbit sampled at the live orbital phase — the same
 * reduced-order approximation the physics itself makes, so the display never
 * shows anything the model didn't compute.
 */
import { EPOCH0_ORBITS, EPOCH_ORBITS } from "../core/constants";
import { designWarnings } from "../core/design";
import { betaDeg } from "../core/environment";
import { MissionSim } from "../core/mission";
import type { EpochOutput } from "../core/mission";
import { rebaseTraceToPhase } from "../core/orbitloop";
import type { PhaseTrace } from "../core/orbitloop";
import type { Config } from "../core/params";
import type { FromSim, TickSample, ToSim } from "./protocol";

const TICK_MS = 33;

let cfg: Config | null = null;
let sim: MissionSim | null = null;
let simTimeS = 0;
let warp = 3000;
let playing = false;
let missionEndS = 0;
let phaseTrace: PhaseTrace | null = null;
let currentRowFe = 0;
let lastWall = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const post = (m: FromSim): void => {
  (self as unknown as Worker).postMessage(m);
};

/** Process one epoch, keeping its phase-rebased orbit trace for display. */
function stepOnce(): EpochOutput | null {
  if (!sim) return null;
  const e = sim.epoch;
  const out = sim.stepEpoch({ trace: true });
  if (!out || !out.trace) return out;
  const nOrbits = e === 0 ? EPOCH0_ORBITS : EPOCH_ORBITS;
  phaseTrace = rebaseTraceToPhase(
    out.trace,
    sim.design.period_s,
    (nOrbits - 1) * sim.design.period_s,
  );
  currentRowFe = out.row.fe;
  return out;
}

function sampleAtPhase(phaseS: number): TickSample | null {
  const tr = phaseTrace;
  if (!sim || !tr || tr.phase_s.length === 0) return null;
  // binary search the nearest phase sample
  const xs = tr.phase_s;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= phaseS) lo = mid;
    else hi = mid;
  }
  const i = phaseS - xs[lo] <= xs[hi] - phaseS ? lo : hi;
  const row = sim.hist[Math.min(sim.epoch, sim.hist.length) - 1];
  const ovh = row?.ovh ?? 0;
  const nAlive = row?.n_alive ?? sim.nAlive;
  return {
    tj_c: tr.tj[i],
    t_rad_c: tr.t_rad_c[i],
    t_cool_c: tr.t_cool_c[i],
    f: tr.f[i],
    soc_frac: tr.soc_frac[i],
    illum: tr.illum[i],
    p_arr_w: tr.p_arr_w[i],
    p_load_w: tr.p_load_w[i],
    eff_pflops:
      nAlive * (cfg?.chip.pflops_nominal ?? 1) * tr.f[i] * (1 - ovh),
  };
}

function emitTick(): void {
  if (!sim || !cfg) return;
  const phaseS = simTimeS % sim.design.period_s;
  post({
    t: "tick",
    timeS: simTimeS,
    phaseS,
    epoch: Math.min(Math.floor(simTimeS / sim.dtS), sim.nEpochs - 1),
    beta: betaDeg(simTimeS, cfg.orbit),
    fe: currentRowFe,
    playing,
    warp,
    sample: sampleAtPhase(phaseS),
  });
}

/** Advance the mission clock and process any epochs it has entered. */
function advanceTo(targetS: number): void {
  if (!sim) return;
  simTimeS = Math.min(targetS, missionEndS);
  const targetEpoch = Math.min(
    Math.floor(simTimeS / sim.dtS),
    sim.nEpochs - 1,
  );
  while (!sim.done && sim.epoch <= targetEpoch) {
    const out = stepOnce();
    if (out) {
      post({
        t: "epoch",
        index: out.epoch,
        row: out.row,
        events: out.events,
        trace: phaseTrace!,
      });
    }
  }
  if (sim.done && simTimeS >= missionEndS) {
    playing = false;
    post({ t: "done", summary: sim.summary() });
  }
}

function onTimer(): void {
  const now = performance.now();
  const dtReal = Math.min((now - lastWall) / 1000, 0.25);
  lastWall = now;
  if (playing && sim && !(sim.done && simTimeS >= missionEndS)) {
    advanceTo(simTimeS + warp * dtReal);
  }
  emitTick();
}

function init(newCfg: Config): void {
  cfg = newCfg;
  sim = new MissionSim(newCfg);
  simTimeS = 0;
  phaseTrace = null;
  currentRowFe = 0;
  missionEndS = sim.nEpochs * sim.dtS;
  post({
    t: "ready",
    design: sim.design,
    warnings: designWarnings(newCfg, sim.design),
    periodS: sim.design.period_s,
    missionEndS,
    nEpochs: sim.nEpochs,
    stochastic: sim.stochastic,
  });
  // epoch 0 is computed immediately so the orbit view is live from t=0
  advanceTo(0);
  emitTick();
  if (!timer) {
    lastWall = performance.now();
    timer = setInterval(onTimer, TICK_MS);
  }
}

/** Rebuild deterministically and fast-forward to a target time (scrub). */
function seek(timeS: number): void {
  if (!cfg || !sim) return;
  const clamped = Math.max(0, Math.min(timeS, missionEndS));
  const targetEpoch = Math.min(Math.floor(clamped / sim.dtS), sim.nEpochs - 1);
  sim = new MissionSim(cfg);
  for (let e = 0; e < targetEpoch; e++) sim.stepEpoch();
  stepOnce(); // target epoch, with trace
  simTimeS = clamped;
  post({
    t: "hist",
    rows: sim.hist,
    events: sim.events,
    epochIndex: targetEpoch,
    trace: phaseTrace,
  });
  emitTick();
}

self.onmessage = (ev: MessageEvent<ToSim>) => {
  const m = ev.data;
  switch (m.t) {
    case "init":
      init(m.cfg);
      break;
    case "play":
      playing = true;
      if (sim && sim.done && simTimeS >= missionEndS) seek(0); // replay
      break;
    case "pause":
      playing = false;
      break;
    case "warp":
      warp = m.warp;
      break;
    case "step":
      if (sim) advanceTo((Math.floor(simTimeS / sim.dtS) + 1) * sim.dtS);
      emitTick();
      break;
    case "runToEnd":
      if (sim && cfg) {
        while (!sim.done) stepOnce();
        simTimeS = missionEndS;
        playing = false;
        post({
          t: "hist",
          rows: sim.hist,
          events: sim.events,
          epochIndex: sim.nEpochs - 1,
          trace: phaseTrace,
        });
        post({ t: "done", summary: sim.summary() });
        emitTick();
      }
      break;
    case "seek":
      seek(m.timeS);
      break;
  }
};
