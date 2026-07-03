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
  parseConfig,
  PRESETS,
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
  McLite,
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

/** Snapshot of a design pinned for A/B comparison (deterministic run). */
export interface PinnedBaseline {
  name: string;
  cfg: Config;
  summary: MissionSummary;
  hist: EpochRow[];
  design: Design;
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
  // --- A/B compare
  pinned: PinnedBaseline | null;
  pinning: boolean;
  /** Active preset id, or "custom" once any parameter is touched. */
  presetId: string;
  // --- Monte Carlo ensemble (analysis worker)
  mcRunning: boolean;
  mcDone: number;
  mcTotal: number;
  /** Cleared whenever the design changes — a stale ensemble is misleading. */
  mcResult: McLite | null;
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
  applyPreset: (id: string) => void;
  pinBaseline: () => void;
  unpin: () => void;
  exportJson: () => string;
  /** Throws (ZodError/SyntaxError) on invalid input; caller shows the message. */
  importJson: (text: string) => void;
  runMc: () => void;
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
let pinReqId = 0;
let mcReqId = 0;
/** Cfg snapshot taken when the pin request was posted (not when it lands). */
let pinReqCfg: Config | null = null;
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
    const applyCfg = (cfg: Config, presetId = "custom"): void => {
      const design = sizeDesign(cfg);
      mcReqId++; // orphan any in-flight ensemble; its cfg is stale now
      set({
        cfg,
        design,
        warnings: designWarnings(cfg, design),
        presetId,
        mcResult: null,
        mcRunning: false,
      });
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
      pinned: null,
      pinning: false,
      presetId: "baseline_dd",
      mcRunning: false,
      mcDone: 0,
      mcTotal: 0,
      mcResult: null,

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

      resetCfg: () => applyCfg(baselineDd(), "baseline_dd"),

      play: () => postSim({ t: "play" }),
      pause: () => postSim({ t: "pause" }),
      stepEpoch: () => postSim({ t: "step" }),
      runToEnd: () => postSim({ t: "runToEnd" }),
      setWarp: (warp) => {
        postSim({ t: "warp", warp });
        set((s) => ({ tick: { ...s.tick, warp } }));
      },
      seek: (timeS) => postSim({ t: "seek", timeS }),

      applyPreset: (id) => {
        const p = PRESETS.find((x) => x.id === id);
        if (p) applyCfg(p.make(), id);
      },

      pinBaseline: () => {
        // A/B compares EXPECTED outcomes: force the deterministic path so
        // the pinned curve matches projection semantics even for presets
        // that default to sampled mode.
        const cfg = structuredClone(get().cfg);
        cfg.mission.stochastic = false;
        pinReqCfg = cfg;
        set({ pinning: true });
        postAna({ t: "mission", id: ++pinReqId, cfg });
      },

      unpin: () => set({ pinned: null, pinning: false }),

      exportJson: () => JSON.stringify(get().cfg, null, 2),

      importJson: (text) => {
        const cfg = parseConfig(JSON.parse(text));
        applyCfg(cfg);
      },

      runMc: () => {
        const { cfg } = get();
        set({ mcRunning: true, mcDone: 0, mcTotal: cfg.mission.mc_runs, mcResult: null });
        postAna({
          t: "mc",
          id: ++mcReqId,
          cfg,
          runs: cfg.mission.mc_runs,
          seed: cfg.mission.seed,
        });
      },
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
      if (m.id === pinReqId && pinReqCfg) {
        useStudio.setState({
          pinned: {
            name: pinReqCfg.name,
            cfg: pinReqCfg,
            summary: m.summary,
            hist: m.hist,
            design: m.design,
          },
          pinning: false,
        });
      }
      break;
    case "mcProgress":
      if (m.id === mcReqId) {
        useStudio.setState({ mcDone: m.done, mcTotal: m.total });
      }
      break;
    case "mc":
      if (m.id === mcReqId) {
        useStudio.setState({ mcResult: m.result, mcRunning: false });
      }
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
