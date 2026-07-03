/**
 * UI state store (zustand): owns the current Config, talks to the two
 * workers, and republishes their telemetry for React. No physics in here —
 * design sizing/warnings come from the pure core (instant, on the UI
 * thread), mission numbers come from the workers.
 */
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import {
  baselineDd,
  ConfigSchema,
  designWarnings,
  setParam as coreSetParam,
  sizeDesign,
} from "../core";
import type {
  Config,
  Design,
  DesignWarning,
  EpochRow,
  MissionEvent,
  MissionSummary,
  OrbitProfileT,
  PhaseTrace,
} from "../core";
import type {
  FromAnalysis,
  FromSim,
  TickSample,
  ToAnalysis,
  ToSim,
} from "../worker/protocol";

export interface TickState {
  timeS: number;
  phaseS: number;
  epoch: number;
  beta: number;
  fe: number;
  playing: boolean;
  warp: number;
  sample: TickSample | null;
}

export interface StudioState {
  cfg: Config;
  /** Sized design for the CURRENT sliders (recomputed synchronously). */
  design: Design;
  warnings: DesignWarning[];
  // --- live mission (sim worker)
  periodS: number;
  missionEndS: number;
  nEpochs: number;
  /** Whether the running mission samples stochastic events. */
  stochasticRun: boolean;
  tick: TickState;
  rows: EpochRow[];
  events: MissionEvent[];
  trace: PhaseTrace | null;
  traceEpoch: number;
  summary: MissionSummary | null;
  // --- deterministic projection of the current design (analysis worker)
  projection: MissionSummary | null;
  projecting: boolean;
  // --- actions
  setParam: (path: string, value: number) => void;
  mutateCfg: (mutate: (c: Config) => void) => void;
  setProfile: (p: OrbitProfileT) => void;
  setStochastic: (on: boolean) => void;
  setSeed: (seed: number) => void;
  resetCfg: () => void;
  play: () => void;
  pause: () => void;
  stepEpoch: () => void;
  runToEnd: () => void;
  setWarp: (warp: number) => void;
  seek: (timeS: number) => void;
}

const simWorker = new Worker(new URL("../worker/simWorker.ts", import.meta.url), {
  type: "module",
});
const anaWorker = new Worker(
  new URL("../worker/analysisWorker.ts", import.meta.url),
  { type: "module" },
);

const postSim = (m: ToSim): void => simWorker.postMessage(m);
const postAna = (m: ToAnalysis): void => anaWorker.postMessage(m);

let projId = 0;
let reinitTimer: ReturnType<typeof setTimeout> | undefined;

/** Debounced worker restart after slider motion settles. */
function scheduleReinit(cfg: Config): void {
  clearTimeout(reinitTimer);
  reinitTimer = setTimeout(() => {
    postSim({ t: "init", cfg });
    postAna({ t: "project", id: ++projId, cfg });
    useStudio.setState({ projecting: true });
  }, 250);
}

const initialCfg = baselineDd();

export const useStudio = create<StudioState>()(
  subscribeWithSelector((set, get) => {
    /** Apply a validated new config: instant sizing, debounced sim restart. */
    const applyCfg = (cfg: Config): void => {
      const design = sizeDesign(cfg);
      set({ cfg, design, warnings: designWarnings(cfg, design) });
      scheduleReinit(cfg);
    };

    return {
      cfg: initialCfg,
      design: sizeDesign(initialCfg),
      warnings: designWarnings(initialCfg, sizeDesign(initialCfg)),
      periodS: 1,
      missionEndS: 1,
      nEpochs: 0,
      stochasticRun: false,
      tick: {
        timeS: 0,
        phaseS: 0,
        epoch: 0,
        beta: 0,
        fe: 0,
        playing: false,
        warp: 3000,
        sample: null,
      },
      rows: [],
      events: [],
      trace: null,
      traceEpoch: -1,
      summary: null,
      projection: null,
      projecting: false,

      setParam: (path, value) => applyCfg(coreSetParam(get().cfg, path, value)),

      mutateCfg: (mutate) => {
        const next = structuredClone(get().cfg);
        mutate(next);
        applyCfg(ConfigSchema.parse(next));
      },

      setProfile: (p) =>
        get().mutateCfg((c) => {
          c.orbit.profile = p;
        }),

      setStochastic: (on) =>
        get().mutateCfg((c) => {
          c.mission.stochastic = on;
        }),

      setSeed: (seed) =>
        get().mutateCfg((c) => {
          c.mission.seed = Math.max(0, Math.round(seed));
        }),

      resetCfg: () => applyCfg(baselineDd()),

      play: () => postSim({ t: "play" }),
      pause: () => postSim({ t: "pause" }),
      stepEpoch: () => postSim({ t: "step" }),
      runToEnd: () => postSim({ t: "runToEnd" }),
      setWarp: (warp) => {
        postSim({ t: "warp", warp });
        set((s) => ({ tick: { ...s.tick, warp } }));
      },
      seek: (timeS) => postSim({ t: "seek", timeS }),
    };
  }),
);

simWorker.onmessage = (ev: MessageEvent<FromSim>) => {
  const m = ev.data;
  switch (m.t) {
    case "ready":
      useStudio.setState({
        design: m.design,
        warnings: m.warnings,
        periodS: m.periodS,
        missionEndS: m.missionEndS,
        nEpochs: m.nEpochs,
        stochasticRun: m.stochastic,
        rows: [],
        events: [],
        trace: null,
        traceEpoch: -1,
        summary: null,
      });
      break;
    case "epoch":
      useStudio.setState((s) => ({
        rows: [...s.rows, m.row],
        events: m.events.length ? [...s.events, ...m.events] : s.events,
        trace: m.trace,
        traceEpoch: m.index,
      }));
      break;
    case "hist":
      useStudio.setState({
        rows: m.rows.slice(),
        events: m.events.slice(),
        trace: m.trace,
        traceEpoch: m.epochIndex,
      });
      break;
    case "tick":
      useStudio.setState({
        tick: {
          timeS: m.timeS,
          phaseS: m.phaseS,
          epoch: m.epoch,
          beta: m.beta,
          fe: m.fe,
          playing: m.playing,
          warp: m.warp,
          sample: m.sample,
        },
      });
      break;
    case "done":
      useStudio.setState({ summary: m.summary });
      break;
  }
};

anaWorker.onmessage = (ev: MessageEvent<FromAnalysis>) => {
  const m = ev.data;
  switch (m.t) {
    case "projection":
      if (m.id === projId) {
        useStudio.setState({ projection: m.summary, projecting: false });
      }
      break;
    case "mission":
    case "mcProgress":
    case "mc":
      // consumed by M4/M5 features
      break;
  }
};

let booted = false;

/** Kick off the first mission + projection (idempotent across StrictMode). */
export function bootStudio(): void {
  if (booted) return;
  booted = true;
  const { cfg } = useStudio.getState();
  postSim({ t: "init", cfg });
  postAna({ t: "project", id: ++projId, cfg });
  useStudio.setState({ projecting: true });
}
