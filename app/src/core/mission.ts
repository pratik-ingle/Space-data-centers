/**
 * Mission simulator: multi-rate epoch loop (port of sdcsim/mission.py).
 *
 * Fast loop (orbitloop) resolves one steady-periodic orbit per ~2-week
 * epoch; slow states (TID, coating alpha, array degradation, battery cycle
 * fade, node attrition) update per epoch. Deterministic mode propagates
 * expected values; stochastic mode samples Poisson SPEs and binomial deaths
 * from a seeded RNG. Exposed as a stepper (MissionSim) so the live worker
 * can pace epochs against the wall clock while projections run it to
 * completion synchronously — same code path, identical numbers.
 */
import {
  BATT_FADE_DOD_MIN,
  BATT_FADE_DOD_REF,
  C_TO_K,
  EPOCH0_ORBITS,
  EPOCH_ORBITS,
  K_B_EV,
  SECONDS_PER_DAY,
  SECONDS_PER_YEAR,
  SEL_SOLAR_BASE,
  S_SOLAR,
} from "./constants";
import { etaCell, sizeDesign } from "./design";
import type { Design } from "./design";
import { betaDeg, eclipseFraction, solarActivity } from "./environment";
import {
  emptyAudit,
  emptyTrace,
  initThermalState,
  simulateOrbit,
} from "./orbitloop";
import type {
  EnergyAudit,
  OrbitEnv,
  OrbitMetrics,
  OrbitTrace,
  ThermalState,
} from "./orbitloop";
import type { Config, RelP } from "./params";
import {
  checkpointOverhead,
  doseRateKradPerYr,
  speRatePerYr,
  uncErrorRatePerGpuDay,
} from "./radiation";
import type { Rng } from "./rng";
import { mulberry32 } from "./rng";

/** Arrhenius acceleration factor exp(Ea/k * (1/T_ref - 1/Tj)). */
export function arrhenius(rel: RelP, tjC: number): number {
  const t = tjC + C_TO_K;
  const tr = rel.tj_ref_c + C_TO_K;
  return Math.exp((rel.ea_ev / K_B_EV) * (1 / tr - 1 / t));
}

/** One row of the mission history (keys match the Python reference, plus
 *  extensions batt_cap_frac and spe_frac). */
export interface EpochRow {
  t_yr: number;
  beta: number;
  fe: number;
  s_act: number;
  f_mean: number;
  tj_mean: number;
  tj_max: number;
  dtj_cycle: number;
  t_rad_c: number;
  n_alive: number;
  tid_krad: number;
  leak_mult: number;
  alpha: number;
  arr_factor: number;
  p_arr_kw: number;
  load_kw: number;
  ovh: number;
  eff_pflops: number;
  dod: number;
  frac_power_limited: number;
  frac_thermal_limited: number;
  frac_idle: number;
  batt_cap_frac: number;
  spe_frac: number;
}

export type EventKind =
  | "spe"
  | "gpu_failure"
  | "safe_mode_start"
  | "safe_mode_end"
  | "throttle_start"
  | "throttle_end"
  | "tid_leakage"
  | "batt_fade"
  | "attrition_milestone"
  | "dod_exceeded"
  | "tj_hard_limit";

export interface MissionEvent {
  epoch: number;
  t_yr: number;
  kind: EventKind;
  severity: "info" | "warn" | "crit";
  label: string;
}

/** Loss-waterfall keys match the Python reference exactly. */
export interface Losses {
  "throttle (thermal+power)": number;
  "node attrition": number;
  "checkpoint/restart tax": number;
}

export interface MissionSummary {
  name: string;
  delivered_pflop_yr: number;
  nameplate_pflop_yr: number;
  utilization: number;
  per_tonne: number;
  mass_total_kg: number;
  losses: Losses;
  final_n_alive: number;
  final_tid_krad: number;
  final_batt_cap_frac: number;
  n_events: number;
}

export interface EpochOutput {
  epoch: number;
  row: EpochRow;
  metrics: OrbitMetrics;
  events: MissionEvent[];
  env: OrbitEnv;
  trace?: OrbitTrace;
  audit?: EnergyAudit;
}

export interface MissionResult {
  cfg: Config;
  design: Design;
  summary: MissionSummary;
  hist: EpochRow[];
  events: MissionEvent[];
}

export interface StepOptions {
  trace?: boolean;
  audit?: boolean;
}

/**
 * Steppable mission engine. Construct, then call stepEpoch() until it
 * returns null (or run()). Deterministic for a given (cfg, seed).
 */
export class MissionSim {
  readonly cfg: Config;
  readonly design: Design;
  readonly nEpochs: number;
  readonly dtYr: number;
  readonly dtS: number;
  readonly stochastic: boolean;

  epoch = 0;
  st: ThermalState;
  tidKrad = 0;
  nAlive: number;
  battCapFrac = 1;
  delivered = 0;
  hist: EpochRow[] = [];
  events: MissionEvent[] = [];

  private rng: Rng;
  private readonly shieldEff: number;
  // loss-accounting integrals [PFLOP-yr]
  private iFull = 0;
  private iThr = 0;
  private iAtt = 0;
  private iOvh = 0;
  // episode trackers for event extraction
  private wasIdle = false;
  private wasThrottled = false;
  private wasDodOver = false;
  private wasTjOver = false;
  private leakMilestone = 0;
  private aliveMilestone = 0;
  private fadeMilestone = 0;

  constructor(
    cfg: Config,
    opts?: { stochastic?: boolean; seed?: number; rng?: Rng },
  ) {
    this.cfg = cfg;
    this.design = sizeDesign(cfg);
    this.st = initThermalState(cfg, this.design);
    this.stochastic = opts?.stochastic ?? cfg.mission.stochastic;
    this.rng = opts?.rng ?? mulberry32(opts?.seed ?? cfg.mission.seed);
    this.nEpochs = Math.round(cfg.mission.years * cfg.mission.epochs_per_year);
    this.dtYr = 1 / cfg.mission.epochs_per_year;
    this.dtS = this.dtYr * SECONDS_PER_YEAR;
    this.nAlive = cfg.chip.n_gpu;
    this.shieldEff = cfg.rad.shield_mm + cfg.rad.shield_intrinsic_mm;
  }

  get done(): boolean {
    return this.epoch >= this.nEpochs;
  }

  /** Boundary conditions for the CURRENT epoch (before stepping it). */
  envForEpoch(): { env: OrbitEnv; tMidS: number } {
    const { cfg } = this;
    const tMidS = (this.epoch + 0.5) * this.dtS;
    const tYr = tMidS / SECONDS_PER_YEAR;
    const th = cfg.thermal;
    const beta = betaDeg(tMidS, cfg.orbit);
    const fe = eclipseFraction(cfg.orbit.alt_km, beta);
    const alpha =
      th.rad_alpha_bol + th.rad_alpha_drift * (1 - Math.exp(-tYr / th.rad_alpha_tau_yr));
    const arrFactor = Math.exp(-cfg.eps.arr_degr_per_yr * tYr);
    const leakMult = 1 + cfg.rad.leak_per_krad * this.tidKrad;
    const pArrW =
      S_SOLAR *
      this.design.arr_area_m2 *
      etaCell(cfg.eps, cfg.eps.t_cell_sun_c) *
      cfg.eps.cos_pointing *
      cfg.eps.pmad_eff *
      arrFactor;
    return {
      tMidS,
      env: {
        fe,
        p_arr_w: pArrW,
        alpha,
        leak_mult: leakMult,
        n_alive: this.nAlive,
        tj_target_c: cfg.chip.tj_target_c,
        batt_cap_frac: this.battCapFrac,
      },
    };
  }

  /** Advance one degradation epoch; returns null when the mission is over. */
  stepEpoch(opts?: StepOptions): EpochOutput | null {
    if (this.done) return null;
    const { cfg, design: dz } = this;
    const ch = cfg.chip;
    const rd = cfg.rad;
    const rel = cfg.rel;
    const e = this.epoch;
    const { env, tMidS } = this.envForEpoch();
    const tYr = tMidS / SECONDS_PER_YEAR;
    const sAct = solarActivity(tMidS, cfg.mission.solar_phase0);
    const events: MissionEvent[] = [];

    // --- fast loop: one steady-periodic orbit for this epoch (warm start)
    const trace = opts?.trace ? emptyTrace() : undefined;
    const auditObj = opts?.audit ? emptyAudit() : undefined;
    const m = simulateOrbit(
      cfg,
      dz,
      env,
      this.st,
      e === 0 ? EPOCH0_ORBITS : EPOCH_ORBITS,
      undefined,
      trace,
      auditObj,
    );

    // --- SPE exposure this epoch (Poisson storms; expected value when
    //     deterministic — storms average into the epoch)
    const lamSpe = speRatePerYr(sAct);
    const kSpe = this.stochastic
      ? this.rng.poisson(lamSpe * this.dtYr)
      : lamSpe * this.dtYr;
    const speFrac = Math.min(1, (kSpe * rd.spe_dur_days * SECONDS_PER_DAY) / this.dtS);
    if (this.stochastic && kSpe >= 1) {
      events.push({
        epoch: e,
        t_yr: tYr,
        kind: "spe",
        severity: "warn",
        label: `Solar particle event${kSpe > 1 ? ` x${kSpe}` : ""}: SEU x${rd.spe_seu_mult}, prompt dose pulse`,
      });
    }

    // --- TID accumulation (incl. SPE dose pulses through the shield)
    const rate = doseRateKradPerYr(
      this.shieldEff,
      cfg.orbit.alt_km,
      cfg.orbit.profile,
      sAct,
      rd.dose_scale,
    );
    let tidNew = this.tidKrad + rate * this.dtYr;
    tidNew +=
      kSpe *
      rd.spe_dose_krad_1mm *
      Math.exp(-(this.shieldEff - 1) / 1.2) *
      rd.dose_scale;

    // --- checkpoint overhead (quiet / storm weighted) via cluster MTBF
    const lamHardYr =
      rel.afr_scale *
        rel.afr_base_per_yr *
        (1 - rel.thermal_frac + rel.thermal_frac * arrhenius(rel, m.tj_mean)) +
      rel.sel_per_gpu_yr * (SEL_SOLAR_BASE + sAct) +
      rel.mmod_per_gpu_yr;
    const ovhAt = (mult: number): number => {
      const rUnc =
        (uncErrorRatePerGpuDay(rd, this.shieldEff, mult) * this.nAlive) /
        SECONDS_PER_DAY;
      const rHard = (lamHardYr * this.nAlive) / SECONDS_PER_YEAR;
      const mtbf = 1 / Math.max(rUnc + rHard, 1e-12);
      return checkpointOverhead(rel.ckpt_write_s, rel.restart_s, mtbf);
    };
    const ovh = (1 - speFrac) * ovhAt(1) + speFrac * ovhAt(rd.spe_seu_mult);

    // --- attrition hazards: random (Arrhenius-accelerated) + SEL + MMOD +
    //     thermal-cycling fatigue (Coffin-Manson, one cycle per orbit) +
    //     TID mortality (Weibull conditional survival)
    let lam = lamHardYr;
    if (m.dtj_cycle > rel.cyc_dt_min_k) {
      const nf = rel.cyc_nf_ref * (m.dtj_cycle / rel.cyc_dt_ref_k) ** -rel.cyc_exp;
      lam += SECONDS_PER_YEAR / dz.period_s / nf;
    }
    const survRand = Math.exp(-lam * this.dtYr);
    const sTidOld = Math.exp(-((this.tidKrad / rd.tid_char_krad) ** rd.tid_shape));
    const sTidNew = Math.exp(-((tidNew / rd.tid_char_krad) ** rd.tid_shape));
    const surv = survRand * (sTidNew / Math.max(sTidOld, 1e-12));
    const nAliveOld = this.nAlive;
    if (this.stochastic) {
      const nInt = Math.round(this.nAlive);
      const deaths =
        nInt > 0 ? this.rng.binomial(nInt, 1 - Math.min(surv, 1)) : 0;
      this.nAlive = Math.max(0, this.nAlive - deaths);
      if (deaths > 0) {
        events.push({
          epoch: e,
          t_yr: tYr,
          kind: "gpu_failure",
          severity: "warn",
          label: `${deaths} GPU${deaths > 1 ? "s" : ""} failed (${this.nAlive.toFixed(0)}/${ch.n_gpu} alive)`,
        });
      }
    } else {
      this.nAlive *= surv;
      if (Math.floor(nAliveOld) - Math.floor(this.nAlive) >= 1) {
        events.push({
          epoch: e,
          t_yr: tYr,
          kind: "gpu_failure",
          severity: "info",
          label: `Expected attrition crossed ${Math.floor(this.nAlive)}/${ch.n_gpu} GPUs`,
        });
      }
    }
    this.tidKrad = tidNew;

    // --- battery cycle fade (extension beyond the reference, which defines
    //     batt_fade_ref but never applies it; set to 0 for exact parity).
    //     fade/cycle = ref * (DoD/0.4)^exp, one cycle per eclipse orbit.
    if (cfg.eps.batt_fade_ref > 0 && m.dod > BATT_FADE_DOD_MIN) {
      const cycles = this.dtS / dz.period_s;
      const fade =
        cycles *
        cfg.eps.batt_fade_ref *
        (m.dod / BATT_FADE_DOD_REF) ** cfg.eps.batt_fade_dod_exp;
      this.battCapFrac = Math.max(0.01, this.battCapFrac - fade);
    }

    // --- compute delivered this epoch (post-attrition population)
    const effPflops = this.nAlive * ch.pflops_nominal * m.f_mean * (1 - ovh);
    this.delivered += effPflops * this.dtYr;
    this.iFull += ch.n_gpu * ch.pflops_nominal * this.dtYr;
    this.iThr += ch.n_gpu * ch.pflops_nominal * m.f_mean * this.dtYr;
    this.iAtt += this.nAlive * ch.pflops_nominal * m.f_mean * this.dtYr;
    this.iOvh += effPflops * this.dtYr;

    // --- episode events
    const idleNow = m.frac_idle > 0.005;
    if (idleNow && !this.wasIdle) {
      events.push({
        epoch: e,
        t_yr: tYr,
        kind: "safe_mode_start",
        severity: "crit",
        label: `Safe mode: idling ${(m.frac_idle * 100).toFixed(0)}% of each orbit (supply below f_min load)`,
      });
    } else if (!idleNow && this.wasIdle) {
      events.push({
        epoch: e,
        t_yr: tYr,
        kind: "safe_mode_end",
        severity: "info",
        label: "Safe-mode episodes ended",
      });
    }
    this.wasIdle = idleNow;

    const throttledNow = m.frac_power_limited > 0.02 || m.frac_thermal_limited > 0.02;
    if (throttledNow && !this.wasThrottled) {
      const why =
        m.frac_power_limited > m.frac_thermal_limited ? "power" : "thermal";
      events.push({
        epoch: e,
        t_yr: tYr,
        kind: "throttle_start",
        severity: "warn",
        label: `Throttle episode (${why}-limited, f_mean ${m.f_mean.toFixed(2)})`,
      });
    } else if (!throttledNow && this.wasThrottled) {
      events.push({
        epoch: e,
        t_yr: tYr,
        kind: "throttle_end",
        severity: "info",
        label: "Throttling ended",
      });
    }
    this.wasThrottled = throttledNow;

    const leakMult = env.leak_mult;
    const leakSteps = [1.1, 1.25, 1.5];
    while (this.leakMilestone < leakSteps.length && leakMult >= leakSteps[this.leakMilestone]) {
      events.push({
        epoch: e,
        t_yr: tYr,
        kind: "tid_leakage",
        severity: this.leakMilestone === 0 ? "info" : "warn",
        label: `TID leakage multiplier passed ${leakSteps[this.leakMilestone].toFixed(2)} (${this.tidKrad.toFixed(1)} krad)`,
      });
      this.leakMilestone += 1;
    }
    const aliveFrac = this.nAlive / ch.n_gpu;
    const aliveSteps = [0.9, 0.75, 0.5];
    while (
      this.aliveMilestone < aliveSteps.length &&
      aliveFrac <= aliveSteps[this.aliveMilestone]
    ) {
      events.push({
        epoch: e,
        t_yr: tYr,
        kind: "attrition_milestone",
        severity: this.aliveMilestone === 0 ? "info" : this.aliveMilestone === 1 ? "warn" : "crit",
        label: `Fleet down to ${(aliveSteps[this.aliveMilestone] * 100).toFixed(0)}% (${this.nAlive.toFixed(1)} GPUs)`,
      });
      this.aliveMilestone += 1;
    }
    const fadeSteps = [0.8, 0.6];
    while (
      this.fadeMilestone < fadeSteps.length &&
      this.battCapFrac <= fadeSteps[this.fadeMilestone]
    ) {
      events.push({
        epoch: e,
        t_yr: tYr,
        kind: "batt_fade",
        severity: this.fadeMilestone === 0 ? "warn" : "crit",
        label: `Battery capacity faded to ${(this.battCapFrac * 100).toFixed(0)}%`,
      });
      this.fadeMilestone += 1;
    }
    const dodOver = m.dod > cfg.eps.batt_dod + 0.02;
    if (dodOver && !this.wasDodOver) {
      events.push({
        epoch: e,
        t_yr: tYr,
        kind: "dod_exceeded",
        severity: "warn",
        label: `Battery DoD ${(m.dod * 100).toFixed(0)}% exceeds the ${(cfg.eps.batt_dod * 100).toFixed(0)}% design limit`,
      });
    }
    this.wasDodOver = dodOver;
    const tjOver = m.tj_max > ch.tj_max_c;
    if (tjOver && !this.wasTjOver) {
      events.push({
        epoch: e,
        t_yr: tYr,
        kind: "tj_hard_limit",
        severity: "crit",
        label: `Tj peaked at ${m.tj_max.toFixed(1)} degC, above the ${ch.tj_max_c} degC hard limit`,
      });
    }
    this.wasTjOver = tjOver;

    const row: EpochRow = {
      t_yr: tYr,
      beta: betaDeg(tMidS, cfg.orbit),
      fe: env.fe,
      s_act: sAct,
      f_mean: m.f_mean,
      tj_mean: m.tj_mean,
      tj_max: m.tj_max,
      dtj_cycle: m.dtj_cycle,
      t_rad_c: m.t_rad_mean_c,
      n_alive: this.nAlive,
      tid_krad: this.tidKrad,
      leak_mult: leakMult,
      alpha: env.alpha,
      arr_factor: Math.exp(-cfg.eps.arr_degr_per_yr * tYr),
      p_arr_kw: env.p_arr_w / 1e3,
      load_kw: dz.load_design_w / 1e3,
      ovh,
      eff_pflops: effPflops,
      dod: m.dod,
      frac_power_limited: m.frac_power_limited,
      frac_thermal_limited: m.frac_thermal_limited,
      frac_idle: m.frac_idle,
      batt_cap_frac: this.battCapFrac,
      spe_frac: speFrac,
    };
    this.hist.push(row);
    this.events.push(...events);
    this.epoch += 1;

    return { epoch: e, row, metrics: m, events, env, trace, audit: auditObj };
  }

  losses(): Losses {
    return {
      "throttle (thermal+power)": this.iFull - this.iThr,
      "node attrition": this.iThr - this.iAtt,
      "checkpoint/restart tax": this.iAtt - this.iOvh,
    };
  }

  summary(): MissionSummary {
    const nameplate =
      this.cfg.chip.n_gpu * this.cfg.chip.pflops_nominal * this.cfg.mission.years;
    return {
      name: this.cfg.name,
      delivered_pflop_yr: this.delivered,
      nameplate_pflop_yr: nameplate,
      utilization: this.delivered / nameplate,
      per_tonne: this.delivered / (this.design.mass_total_kg / 1000),
      mass_total_kg: this.design.mass_total_kg,
      losses: this.losses(),
      final_n_alive: this.nAlive,
      final_tid_krad: this.tidKrad,
      final_batt_cap_frac: this.battCapFrac,
      n_events: this.events.length,
    };
  }

  run(): MissionResult {
    while (!this.done) this.stepEpoch();
    return {
      cfg: this.cfg,
      design: this.design,
      summary: this.summary(),
      hist: this.hist,
      events: this.events,
    };
  }
}

/** One-shot mission run (deterministic unless cfg/opts say otherwise). */
export function runMission(
  cfg: Config,
  opts?: { stochastic?: boolean; seed?: number },
): MissionResult {
  return new MissionSim(cfg, opts).run();
}

/** Human-readable summary block (mirrors sdcsim.summarize). */
export function summarize(res: MissionResult): string {
  const d = res.design;
  const s = res.summary;
  const lossStr = Object.entries(s.losses)
    .map(([k, v]) => `${k}: ${v.toFixed(1)}`)
    .join(", ");
  const massStr = Object.entries(d.masses)
    .map(([k, v]) => `${k}: ${v.toFixed(0)}`)
    .join(", ");
  return [
    `== ${res.cfg.name} ==`,
    `nameplate: ${s.nameplate_pflop_yr.toFixed(1)} PFLOP-yr | delivered: ` +
      `${s.delivered_pflop_yr.toFixed(1)} PFLOP-yr (${(100 * s.utilization).toFixed(1)}%)`,
    `mass: ${d.mass_total_kg.toFixed(0)} kg -> ${s.per_tonne.toFixed(1)} PFLOP-yr/tonne`,
    `radiator: ${d.a_rad_phys.toFixed(1)} m2 phys (${d.a_rad_eff.toFixed(1)} m2 eff), ` +
      `array: ${d.arr_area_m2.toFixed(1)} m2 / ${(d.arr_p_bol_w / 1e3).toFixed(1)} kW BOL, ` +
      `battery: ${(d.batt_cap_wh / 1e3).toFixed(1)} kWh`,
    `worst eclipse fraction: ${d.worst_fe.toFixed(3)}`,
    `losses (PFLOP-yr): ${lossStr}`,
    `mass budget: ${massStr}`,
  ].join("\n");
}
