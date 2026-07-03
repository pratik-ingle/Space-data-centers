/**
 * Typed message protocol between the UI thread and the two workers.
 *
 * simWorker owns the live mission (wall-clock-paced epochs + orbit-phase
 * telemetry); analysisWorker runs synchronous jobs (projection for the
 * design panel, full missions for A/B compare, Monte Carlo ensembles).
 */
import type { Design, DesignWarning } from "../core/design";
import type {
  EpochRow,
  MissionEvent,
  MissionSummary,
} from "../core/mission";
import type { PhaseTrace } from "../core/orbitloop";
import type { Config } from "../core/params";

/** Instantaneous values sampled from the current epoch's orbit trace. */
export interface TickSample {
  tj_c: number;
  t_rad_c: number;
  t_cool_c: number;
  f: number;
  soc_frac: number;
  illum: number;
  p_arr_w: number;
  p_load_w: number;
  /** n_alive * PFLOPS * f * (1 - ovh) at this instant. */
  eff_pflops: number;
}

export type ToSim =
  | { t: "init"; cfg: Config }
  | { t: "play" }
  | { t: "pause" }
  | { t: "warp"; warp: number }
  | { t: "step" }
  | { t: "runToEnd" }
  | { t: "seek"; timeS: number };

export type FromSim =
  | {
      t: "ready";
      design: Design;
      warnings: DesignWarning[];
      periodS: number;
      missionEndS: number;
      nEpochs: number;
      stochastic: boolean;
    }
  | {
      t: "epoch";
      index: number;
      row: EpochRow;
      events: MissionEvent[];
      trace: PhaseTrace;
    }
  | {
      /** Bulk history replace (after seek / runToEnd). */
      t: "hist";
      rows: EpochRow[];
      events: MissionEvent[];
      epochIndex: number;
      trace: PhaseTrace | null;
    }
  | {
      t: "tick";
      timeS: number;
      phaseS: number;
      epoch: number;
      beta: number;
      fe: number;
      playing: boolean;
      warp: number;
      sample: TickSample | null;
    }
  | { t: "done"; summary: MissionSummary };

export type ToAnalysis =
  | { t: "project"; id: number; cfg: Config }
  | { t: "mission"; id: number; cfg: Config }
  | { t: "mc"; id: number; cfg: Config; runs: number; seed: number };

export interface McLite {
  delivered: number[];
  per_tonne: number[];
  survivors: number[];
  sensitivity: Record<string, number>;
  p5: number;
  p50: number;
  p95: number;
  labels: string[];
}

export type FromAnalysis =
  | { t: "projection"; id: number; summary: MissionSummary }
  | {
      t: "mission";
      id: number;
      summary: MissionSummary;
      hist: EpochRow[];
      events: MissionEvent[];
      design: Design;
    }
  | { t: "mcProgress"; id: number; done: number; total: number }
  | { t: "mc"; id: number; result: McLite };
