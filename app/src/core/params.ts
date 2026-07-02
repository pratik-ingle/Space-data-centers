/**
 * The single parameter schema: every knob of the simulator with bounds,
 * default, unit, and tooltip. The UI generates its controls from PARAM_META,
 * and the physics consumes the zod-validated Config — so physics and UI can
 * never disagree about a parameter (simulator.md code-quality rule).
 *
 * Field names and defaults are kept identical to the authoritative Python
 * reference (sdcsim/params.py, snake_case) so the port can be diffed against
 * it line by line. Defaults are order-of-magnitude, calibrated to public
 * sources (SPENVIS-class LEO environment outputs, H100-class GPU specs,
 * published subsystem specific masses); see MODEL.md for what real data each
 * one would need.
 */
import { z } from "zod";

// ------------------------------------------------------------------- schema

export const OrbitProfile = z.enum(["dd_sso", "mid_incl", "custom"]);
export type OrbitProfileT = z.infer<typeof OrbitProfile>;

export const OrbitSchema = z.object({
  alt_km: z.number().min(200).max(2000).default(550),
  profile: OrbitProfile.default("dd_sso"),
  // dawn-dusk / custom seasonal beta model: beta = mean + amp*cos(2*pi*t/yr)
  beta_mean_deg: z.number().min(-90).max(90).default(78),
  beta_amp_deg: z.number().min(0).max(90).default(13),
  // mid-inclination beta model: beta = a1*sin(2pi t/T_prec) + a2*sin(2pi t/yr)
  mi_a1_deg: z.number().min(0).max(70).default(42),
  mi_a2_deg: z.number().min(0).max(45).default(22),
  mi_precession_days: z.number().min(20).max(365).default(60),
});

export const ChipSchema = z.object({
  n_gpu: z.number().int().min(1).max(2048).default(32),
  tdp_w: z.number().min(100).max(2000).default(700),
  pflops_nominal: z.number().min(0.1).max(10).default(1.0),
  p_dyn0_w: z.number().min(0).max(2000).default(460),
  p_leak0_w: z.number().min(0).max(1000).default(120),
  t_leak_ref_c: z.number().min(0).max(100).default(60),
  leak_doubling_c: z.number().min(5).max(60).default(25),
  v_floor: z.number().min(0.3).max(0.9).default(0.55),
  f_min: z.number().min(0.05).max(0.95).default(0.4),
  r_j_cw: z.number().min(0.005).max(0.2).default(0.03),
  tj_target_c: z.number().min(30).max(110).default(85),
  tj_max_c: z.number().min(35).max(120).default(92),
  other_frac: z.number().min(0).max(1.5).default(0.45),
  other_idle_frac: z.number().min(0).max(1).default(0.5),
  idle_frac_of_design: z.number().min(0.01).max(0.5).default(0.1),
});

export const ThermalSchema = z.object({
  rad_eps: z.number().min(0.5).max(0.98).default(0.86),
  rad_alpha_bol: z.number().min(0.03).max(0.4).default(0.09),
  rad_alpha_drift: z.number().min(0).max(0.4).default(0.1),
  rad_alpha_tau_yr: z.number().min(0.5).max(10).default(3),
  rad_sides_eff: z.number().min(1).max(2).default(1.85),
  rad_kg_m2: z.number().min(2).max(25).default(6),
  rad_cp_j_kgk: z.number().min(300).max(2000).default(900),
  f_ir: z.number().min(0).max(1).default(0.12),
  f_alb: z.number().min(0).max(1).default(0.06),
  f_sun: z.number().min(0).max(1).default(0.02),
  dt_loop_design_k: z.number().min(3).max(30).default(12),
  c_cool_j_k: z.number().min(1e3).max(1e6).default(8e4),
  pump_frac: z.number().min(0).max(0.15).default(0.04),
  area_margin: z.number().min(1).max(1.5).default(1.1),
  rad_area_scale: z.number().min(0.3).max(3).default(1),
});

export const EpsSchema = z.object({
  eta0: z.number().min(0.15).max(0.4).default(0.3),
  temp_coeff_rel_per_k: z.number().min(-0.01).max(0).default(-0.0018),
  t_cell_sun_c: z.number().min(0).max(120).default(65),
  cos_pointing: z.number().min(0.5).max(1).default(0.98),
  pmad_eff: z.number().min(0.7).max(0.99).default(0.93),
  arr_degr_per_yr: z.number().min(0).max(0.1).default(0.025),
  arr_kw_per_kg: z.number().min(0.02).max(0.5).default(0.12),
  arr_margin: z.number().min(1).max(1.5).default(1.08),
  aux_w: z.number().min(0).max(20000).default(2300),
  batt_dod: z.number().min(0.1).max(0.9).default(0.35),
  batt_wh_per_kg: z.number().min(50).max(400).default(130),
  batt_eta_chg: z.number().min(0.8).max(1).default(0.95),
  batt_eta_dis: z.number().min(0.8).max(1).default(0.97),
  batt_sizing_frac: z.number().min(0).max(1).default(1),
  batt_c_dis: z.number().min(0.2).max(5).default(1),
  batt_c_chg: z.number().min(0.1).max(3).default(0.5),
  batt_fade_ref: z.number().min(0).max(5e-4).default(4e-5),
  batt_fade_dod_exp: z.number().min(0.5).max(4).default(2),
});

export const RadSchema = z.object({
  shield_mm: z.number().min(0.2).max(20).default(3),
  shield_intrinsic_mm: z.number().min(0).max(5).default(0.8),
  dose_scale: z.number().min(0).max(10).default(1),
  tid_char_krad: z.number().min(2).max(200).default(26),
  tid_shape: z.number().min(1).max(8).default(3.2),
  leak_per_krad: z.number().min(0).max(0.1).default(0.012),
  seu_per_bit_day: z.number().min(1e-14).max(1e-9).default(5e-12),
  mem_bits_per_gpu: z.number().min(1e10).max(1e13).default(6.9e11),
  unc_fraction: z.number().min(1e-4).max(1).default(0.01),
  seu_scale: z.number().min(0.05).max(50).default(1),
  spe_dur_days: z.number().min(0.5).max(10).default(2.5),
  spe_seu_mult: z.number().min(1).max(300).default(30),
  spe_dose_krad_1mm: z.number().min(0).max(3).default(0.3),
  box_m2_per_kw_it: z.number().min(0.2).max(5).default(1),
});

export const RelSchema = z.object({
  afr_base_per_yr: z.number().min(0).max(0.3).default(0.02),
  tj_ref_c: z.number().min(40).max(110).default(80),
  thermal_frac: z.number().min(0).max(1).default(0.6),
  ea_ev: z.number().min(0.2).max(1.4).default(0.7),
  sel_per_gpu_yr: z.number().min(0).max(0.1).default(0.003),
  mmod_per_gpu_yr: z.number().min(0).max(0.05).default(1.2e-3),
  cyc_nf_ref: z.number().min(1e3).max(1e7).default(1.2e5),
  cyc_dt_ref_k: z.number().min(10).max(80).default(30),
  cyc_exp: z.number().min(1).max(5).default(2.35),
  cyc_dt_min_k: z.number().min(1).max(30).default(6),
  afr_scale: z.number().min(0.1).max(10).default(1),
  ckpt_write_s: z.number().min(0).max(600).default(45),
  restart_s: z.number().min(0).max(3600).default(300),
});

export const MassSchema = z.object({
  it_kg_per_gpu: z.number().min(5).max(100).default(28),
  struct_frac: z.number().min(0.1).max(0.6).default(0.28),
  fixed_bus_kg: z.number().min(50).max(2000).default(400),
  fixed_frac: z.number().min(0).max(0.2).default(0.03),
});

export const MissionSchema = z.object({
  years: z.number().min(0.5).max(15).default(5),
  epochs_per_year: z.number().int().min(6).max(52).default(26),
  solar_phase0: z
    .number()
    .min(0)
    .max(2 * Math.PI)
    .default(0),
  dt_orbit_s: z.number().min(5).max(120).default(30),
  // Extensions beyond the Python reference (which takes these as call args):
  stochastic: z.boolean().default(false),
  seed: z.number().int().min(0).max(0xffffffff).default(7),
  mc_runs: z.number().int().min(10).max(1000).default(200),
});

// Defaults are lazy factories: a shared default object instance would alias
// every parsed Config's sub-objects and mutations would corrupt the defaults.
export const ConfigSchema = z.object({
  orbit: OrbitSchema.default(() => OrbitSchema.parse({})),
  chip: ChipSchema.default(() => ChipSchema.parse({})),
  thermal: ThermalSchema.default(() => ThermalSchema.parse({})),
  eps: EpsSchema.default(() => EpsSchema.parse({})),
  rad: RadSchema.default(() => RadSchema.parse({})),
  rel: RelSchema.default(() => RelSchema.parse({})),
  mass: MassSchema.default(() => MassSchema.parse({})),
  mission: MissionSchema.default(() => MissionSchema.parse({})),
  name: z.string().default("baseline_dd_sso"),
});

export type Config = z.infer<typeof ConfigSchema>;
export type OrbitP = Config["orbit"];
export type ChipP = Config["chip"];
export type ThermalP = Config["thermal"];
export type EpsP = Config["eps"];
export type RadP = Config["rad"];
export type RelP = Config["rel"];
export type MassP = Config["mass"];
export type MissionP = Config["mission"];

// ------------------------------------------------------------------ presets

/** 40 kW-IT cluster, 550 km dawn-dusk SSO, anti-sun double-sided radiator. */
export function baselineDd(): Config {
  return ConfigSchema.parse({});
}

/** Same cluster, 51.6 deg / 420 km: heavy eclipses, worse radiator view. */
export function issLike(battSizingFrac = 1.0): Config {
  const c = ConfigSchema.parse({});
  c.name = `iss_like_batt${battSizingFrac.toFixed(2)}`;
  c.orbit.alt_km = 420;
  c.orbit.profile = "mid_incl";
  // radiator can no longer stay anti-sun/edge-on all orbit
  c.thermal.f_ir = 0.3;
  c.thermal.f_alb = 0.12;
  c.thermal.f_sun = 0.06;
  c.eps.batt_sizing_frac = battSizingFrac;
  c.rad.shield_mm = 3.0;
  return c;
}

/** Baseline launched at solar maximum with a hot particle environment:
 *  stochastic SPE storms, elevated dose and SEU rates. */
export function solarStorm(): Config {
  const c = ConfigSchema.parse({});
  c.name = "solar_storm_stress";
  c.mission.solar_phase0 = Math.PI / 2; // activity = 1.0 at t = 0
  c.rad.dose_scale = 1.3;
  c.rad.seu_scale = 2.0;
  c.mission.stochastic = true;
  c.mission.seed = 42;
  return c;
}

export interface Preset {
  id: string;
  label: string;
  description: string;
  make: () => Config;
}

export const PRESETS: Preset[] = [
  {
    id: "baseline_dd",
    label: "550 km dawn-dusk SSO (baseline)",
    description:
      "32x H100-class, 40 kW-IT. Near-permanent sun, radiator anti-sun " +
      "edge-on. The reference design: ~147 PFLOP-yr delivered at ~46/t.",
    make: baselineDd,
  },
  {
    id: "iss_full",
    label: "ISS-like 51.6deg, full battery",
    description:
      "420 km / 51.6 deg: 35% eclipses every orbit. Battery sized to carry " +
      "the full load through shadow — heavy but keeps compute running.",
    make: () => issLike(1.0),
  },
  {
    id: "iss_lean",
    label: "ISS-like 51.6deg, battery-lean",
    description:
      "Battery sized for only 35% of the load: nodes idle every eclipse, " +
      "cold-soak thermal cycling drives Coffin-Manson fatigue attrition — " +
      "the death-spiral design.",
    make: () => issLike(0.35),
  },
  {
    id: "solar_storm",
    label: "Solar-storm stress test",
    description:
      "Launched at solar max with pessimistic dose/SEU scales and stochastic " +
      "particle events: watch SEU checkpoint tax spikes and dose pulses.",
    make: solarStorm,
  },
];

// ----------------------------------------------------------- UI param metadata

export type ParamGroup =
  | "Orbit"
  | "Compute"
  | "Thermal"
  | "Power"
  | "Radiation"
  | "Reliability"
  | "Mission";

export interface ParamMeta {
  /** Dot path into Config, e.g. "chip.tdp_w". */
  path: string;
  group: ParamGroup;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  /** Log-scaled slider for wide-range params. */
  log?: boolean;
  int?: boolean;
  /** Collapsed into the group's "advanced" section. */
  advanced?: boolean;
  /** Only meaningful for these orbit profiles (UI hides otherwise). */
  profiles?: OrbitProfileT[];
  tooltip: string;
}

/**
 * Slider ranges follow simulator.md's interactive-parameter spec; everything
 * else is exposed under "advanced" so every model constant stays inspectable
 * and adjustable. Tooltips state the physical trade in one line.
 */
export const PARAM_META: ParamMeta[] = [
  // --- Orbit
  {
    path: "orbit.alt_km",
    group: "Orbit",
    label: "Altitude",
    unit: "km",
    min: 300,
    max: 1200,
    step: 10,
    tooltip:
      "Higher: longer orbit, less eclipse and drag, but steeply more trapped radiation dose.",
  },
  {
    path: "orbit.beta_mean_deg",
    group: "Orbit",
    label: "Mean beta angle",
    unit: "deg",
    min: 0,
    max: 90,
    step: 1,
    profiles: ["custom"],
    tooltip:
      "Sun elevation from the orbit plane; above ~67 deg (at 550 km) eclipses vanish.",
  },
  {
    path: "orbit.beta_amp_deg",
    group: "Orbit",
    label: "Seasonal beta swing",
    unit: "deg",
    min: 0,
    max: 45,
    step: 1,
    profiles: ["custom"],
    tooltip: "Annual oscillation amplitude of beta around its mean.",
  },
  // --- Compute
  {
    path: "chip.n_gpu",
    group: "Compute",
    label: "GPU count",
    min: 8,
    max: 512,
    step: 1,
    int: true,
    log: true,
    tooltip:
      "Cluster size: every subsystem (radiator, array, battery, shield box) re-sizes with it.",
  },
  {
    path: "chip.tdp_w",
    group: "Compute",
    label: "GPU TDP",
    unit: "W",
    min: 300,
    max: 1000,
    step: 10,
    tooltip:
      "Nameplate per-GPU power; dynamic and leakage shares scale with it (advanced overrides).",
  },
  {
    path: "chip.pflops_nominal",
    group: "Compute",
    label: "PFLOPS per GPU",
    unit: "PFLOPS",
    min: 0.5,
    max: 4,
    step: 0.05,
    tooltip: "Dense BF16 throughput at full clock (H100-class ~1.0).",
  },
  {
    path: "chip.tj_target_c",
    group: "Compute",
    label: "Tj setpoint",
    unit: "degC",
    min: 45,
    max: 95,
    step: 1,
    tooltip:
      "Run hot: smaller radiator (T^4) but more leakage and Arrhenius-accelerated failures.",
  },
  {
    path: "chip.f_min",
    group: "Compute",
    label: "Min DVFS clock",
    min: 0.2,
    max: 0.8,
    step: 0.01,
    tooltip:
      "Lowest throttle state; below it the cluster drops to idle/safe mode instead.",
  },
  // --- Thermal
  {
    path: "thermal.rad_area_scale",
    group: "Thermal",
    label: "Radiator area scale",
    unit: "x sized",
    min: 0.5,
    max: 2,
    step: 0.01,
    tooltip:
      "Multiplies the thermally-sized area: undersize throttles, oversize hauls dead mass.",
  },
  {
    path: "thermal.rad_kg_m2",
    group: "Thermal",
    label: "Radiator specific mass",
    unit: "kg/m2",
    min: 4,
    max: 16,
    step: 0.1,
    tooltip:
      "Deployable radiator + embedded loop areal density; drives the run-hot-vs-cool optimum.",
  },
  {
    path: "thermal.rad_eps",
    group: "Thermal",
    label: "Emissivity",
    min: 0.7,
    max: 0.95,
    step: 0.005,
    tooltip: "IR emissivity: rejection scales as eps*sigma*T^4.",
  },
  {
    path: "thermal.rad_alpha_bol",
    group: "Thermal",
    label: "Absorptance (BOL)",
    min: 0.05,
    max: 0.3,
    step: 0.005,
    tooltip: "Solar absorptance of fresh coating (OSR ~0.09, white paint ~0.2).",
  },
  {
    path: "thermal.rad_alpha_drift",
    group: "Thermal",
    label: "Absorptance drift",
    min: 0,
    max: 0.3,
    step: 0.005,
    tooltip:
      "Asymptotic UV/AO/contamination darkening: alpha(t) = BOL + drift*(1-e^(-t/tau)).",
  },
  {
    path: "thermal.dt_loop_design_k",
    group: "Thermal",
    label: "Loop delta-T",
    unit: "K",
    min: 5,
    max: 25,
    step: 0.5,
    tooltip:
      "Coolant-to-radiator design temperature drop: tighter needs more pumping/area.",
  },
  // --- Power
  {
    path: "eps.eta0",
    group: "Power",
    label: "Cell efficiency",
    min: 0.25,
    max: 0.34,
    step: 0.001,
    tooltip: "Triple-junction GaAs at 28 degC; derated with temperature.",
  },
  {
    path: "eps.arr_degr_per_yr",
    group: "Power",
    label: "Array degradation",
    unit: "/yr",
    min: 0.005,
    max: 0.06,
    step: 0.001,
    tooltip:
      "Radiation + UV + thermal cycling power fade; array is sized at end of life.",
  },
  {
    path: "eps.batt_dod",
    group: "Power",
    label: "Battery DoD limit",
    min: 0.2,
    max: 0.6,
    step: 0.01,
    tooltip:
      "Deeper discharge: lighter battery but faster cycle fade per orbit.",
  },
  {
    path: "eps.batt_c_dis",
    group: "Power",
    label: "Max discharge rate",
    unit: "C",
    min: 0.5,
    max: 3,
    step: 0.1,
    tooltip:
      "Power constraint on sizing: battery must push the eclipse load at this C-rate.",
  },
  {
    path: "eps.batt_c_chg",
    group: "Power",
    label: "Max charge rate",
    unit: "C",
    min: 0.2,
    max: 2,
    step: 0.1,
    tooltip: "Caps eclipse-exit recharge; too low and SoC never recovers.",
  },
  {
    path: "eps.batt_sizing_frac",
    group: "Power",
    label: "Battery sizing fraction",
    min: 0,
    max: 1,
    step: 0.01,
    tooltip:
      "Fraction of the bus load the battery carries in eclipse. Lean designs idle in shadow and thermally cycle to death — deliberately allowed.",
  },
  // --- Radiation
  {
    path: "rad.shield_mm",
    group: "Radiation",
    label: "Shield wall",
    unit: "mm Al",
    min: 0.5,
    max: 10,
    step: 0.1,
    tooltip:
      "Enclosure wall: thin = TID death, thick = dead launch mass. Optimum ~1.5 mm at 550 km.",
  },
  {
    path: "rad.tid_char_krad",
    group: "Radiation",
    label: "TID hardness (char.)",
    unit: "krad",
    min: 5,
    max: 80,
    step: 1,
    tooltip:
      "Weibull characteristic dose-to-failure of COTS GPU+HBM (published failures 5-50 krad).",
  },
  {
    path: "rad.seu_scale",
    group: "Radiation",
    label: "SEU rate scale",
    unit: "x",
    min: 0.1,
    max: 10,
    step: 0.1,
    log: true,
    tooltip:
      "Multiplier on the upset rate; feeds the Daly checkpoint tax via cluster MTBF.",
  },
  {
    path: "mission.solar_phase0",
    group: "Radiation",
    label: "Solar-cycle phase",
    unit: "rad",
    min: 0,
    max: 6.283,
    step: 0.05,
    tooltip:
      "Where in the 11-yr cycle the mission starts; pi/2 = launch at solar max (more SPEs, less trapped dose).",
  },
  // --- Reliability
  {
    path: "rel.afr_base_per_yr",
    group: "Reliability",
    label: "Base AFR",
    unit: "/yr",
    min: 0.005,
    max: 0.1,
    step: 0.001,
    tooltip: "Random hard-failure rate per GPU at the reference junction temp.",
  },
  {
    path: "rel.ea_ev",
    group: "Reliability",
    label: "Arrhenius Ea",
    unit: "eV",
    min: 0.3,
    max: 1.1,
    step: 0.01,
    tooltip:
      "Activation energy of the thermally-driven failure fraction (~2x per 10 K at 0.7 eV).",
  },
  {
    path: "rel.cyc_exp",
    group: "Reliability",
    label: "Coffin-Manson exp.",
    min: 1.5,
    max: 4,
    step: 0.05,
    tooltip:
      "Fatigue exponent: cycles-to-fail = Nf_ref*(dTj/30K)^-m, one cycle per orbit.",
  },
  {
    path: "rel.ckpt_write_s",
    group: "Reliability",
    label: "Checkpoint write",
    unit: "s",
    min: 5,
    max: 300,
    step: 5,
    tooltip:
      "Time to write a checkpoint; optimal interval tau* = sqrt(2*delta*MTBF) (Daly).",
  },
  {
    path: "rel.restart_s",
    group: "Reliability",
    label: "Restart time",
    unit: "s",
    min: 30,
    max: 1200,
    step: 10,
    tooltip: "Reboot + reload + rollback time after an uncorrectable error.",
  },
  // --- Mission
  {
    path: "mission.years",
    group: "Mission",
    label: "Mission duration",
    unit: "yr",
    min: 1,
    max: 10,
    step: 0.5,
    tooltip:
      "Design life: arrays sized EOL, attrition and dose integrate over it.",
  },

  // ------------------------------------------------- advanced (all groups)
  {
    path: "orbit.mi_a1_deg",
    group: "Orbit",
    label: "MI precession amp",
    unit: "deg",
    min: 0,
    max: 70,
    step: 1,
    advanced: true,
    profiles: ["mid_incl"],
    tooltip: "Nodal-precession beta amplitude of the mid-inclination model.",
  },
  {
    path: "orbit.mi_a2_deg",
    group: "Orbit",
    label: "MI seasonal amp",
    unit: "deg",
    min: 0,
    max: 45,
    step: 1,
    advanced: true,
    profiles: ["mid_incl"],
    tooltip: "Seasonal beta amplitude of the mid-inclination model.",
  },
  {
    path: "orbit.mi_precession_days",
    group: "Orbit",
    label: "MI precession period",
    unit: "d",
    min: 20,
    max: 365,
    step: 1,
    advanced: true,
    profiles: ["mid_incl"],
    tooltip: "Nodal precession period (ISS-like ~60 d).",
  },
  {
    path: "chip.p_dyn0_w",
    group: "Compute",
    label: "Dynamic power @f=1",
    unit: "W",
    min: 100,
    max: 1500,
    step: 5,
    advanced: true,
    tooltip: "P_dyn = P_dyn0 * f * V(f)^2; auto-scales when TDP slider moves.",
  },
  {
    path: "chip.p_leak0_w",
    group: "Compute",
    label: "Leakage @V=1,60C",
    unit: "W",
    min: 10,
    max: 600,
    step: 5,
    advanced: true,
    tooltip:
      "Leakage doubles every 25 K above 60 degC and grows with TID; auto-scales with TDP.",
  },
  {
    path: "chip.leak_doubling_c",
    group: "Compute",
    label: "Leakage doubling",
    unit: "K",
    min: 10,
    max: 50,
    step: 1,
    advanced: true,
    tooltip: "Temperature rise that doubles subthreshold leakage.",
  },
  {
    path: "chip.v_floor",
    group: "Compute",
    label: "DVFS voltage floor",
    min: 0.4,
    max: 0.8,
    step: 0.01,
    advanced: true,
    tooltip: "V(f) = floor + (1-floor)*f; sets how much power DVFS can shed.",
  },
  {
    path: "chip.r_j_cw",
    group: "Compute",
    label: "Rth junction-coolant",
    unit: "K/W",
    min: 0.01,
    max: 0.1,
    step: 0.001,
    advanced: true,
    tooltip: "Cold-plate stack resistance per GPU: Tj = T_coolant + Rth*P.",
  },
  {
    path: "chip.tj_max_c",
    group: "Compute",
    label: "Tj hard limit",
    unit: "degC",
    min: 50,
    max: 110,
    step: 1,
    advanced: true,
    tooltip: "Emergency frequency cut above this junction temperature.",
  },
  {
    path: "chip.other_frac",
    group: "Compute",
    label: "Non-GPU IT power",
    unit: "x TDP",
    min: 0,
    max: 1,
    step: 0.01,
    advanced: true,
    tooltip: "CPU/NIC/memory host power as a fraction of GPU TDP.",
  },
  {
    path: "chip.other_idle_frac",
    group: "Compute",
    label: "Non-GPU idle share",
    min: 0,
    max: 1,
    step: 0.01,
    advanced: true,
    tooltip: "Load-independent share of the non-GPU power.",
  },
  {
    path: "chip.idle_frac_of_design",
    group: "Compute",
    label: "Idle IT power",
    unit: "x design",
    min: 0.02,
    max: 0.3,
    step: 0.01,
    advanced: true,
    tooltip: "IT power in idle/safe mode as a fraction of design IT power.",
  },
  {
    path: "thermal.rad_alpha_tau_yr",
    group: "Thermal",
    label: "Alpha drift tau",
    unit: "yr",
    min: 0.5,
    max: 10,
    step: 0.1,
    advanced: true,
    tooltip: "E-folding time of coating darkening.",
  },
  {
    path: "thermal.rad_sides_eff",
    group: "Thermal",
    label: "Effective sides",
    min: 1,
    max: 2,
    step: 0.01,
    advanced: true,
    tooltip: "Double-sided deployable radiator effectiveness (2 = ideal).",
  },
  {
    path: "thermal.rad_cp_j_kgk",
    group: "Thermal",
    label: "Radiator cp",
    unit: "J/kg-K",
    min: 300,
    max: 2000,
    step: 10,
    advanced: true,
    tooltip: "Specific heat of the radiator mass (thermal inertia).",
  },
  {
    path: "thermal.f_ir",
    group: "Thermal",
    label: "View factor: Earth IR",
    min: 0,
    max: 1,
    step: 0.01,
    advanced: true,
    tooltip:
      "Effective view to warm Earth; attitude preset sets this (anti-sun edge-on ~0.12).",
  },
  {
    path: "thermal.f_alb",
    group: "Thermal",
    label: "View factor: albedo",
    min: 0,
    max: 1,
    step: 0.01,
    advanced: true,
    tooltip: "Effective view to sunlit Earth.",
  },
  {
    path: "thermal.f_sun",
    group: "Thermal",
    label: "View factor: sun",
    min: 0,
    max: 0.5,
    step: 0.005,
    advanced: true,
    tooltip: "Residual direct solar leakage onto the radiator while lit.",
  },
  {
    path: "thermal.c_cool_j_k",
    group: "Thermal",
    label: "Coolant capacity",
    unit: "J/K",
    min: 1e4,
    max: 5e5,
    step: 1e3,
    log: true,
    advanced: true,
    tooltip: "Lumped coolant + coldplate heat capacity (loop thermal inertia).",
  },
  {
    path: "thermal.pump_frac",
    group: "Thermal",
    label: "Pump power",
    unit: "x IT",
    min: 0,
    max: 0.12,
    step: 0.005,
    advanced: true,
    tooltip: "Coolant pump power as a fraction of IT power.",
  },
  {
    path: "thermal.area_margin",
    group: "Thermal",
    label: "Sizing margin",
    min: 1,
    max: 1.4,
    step: 0.01,
    advanced: true,
    tooltip: "Radiator area margin applied at the design point.",
  },
  {
    path: "eps.temp_coeff_rel_per_k",
    group: "Power",
    label: "Cell temp coeff",
    unit: "/K",
    min: -0.005,
    max: 0,
    step: 0.0001,
    advanced: true,
    tooltip: "Relative efficiency loss per kelvin above 28 degC.",
  },
  {
    path: "eps.t_cell_sun_c",
    group: "Power",
    label: "Cell temp in sun",
    unit: "degC",
    min: 20,
    max: 110,
    step: 1,
    advanced: true,
    tooltip: "Operating temperature of illuminated cells.",
  },
  {
    path: "eps.cos_pointing",
    group: "Power",
    label: "Pointing cosine",
    min: 0.7,
    max: 1,
    step: 0.005,
    advanced: true,
    tooltip: "Mean cosine loss from array pointing error.",
  },
  {
    path: "eps.pmad_eff",
    group: "Power",
    label: "PMAD efficiency",
    min: 0.8,
    max: 0.98,
    step: 0.005,
    advanced: true,
    tooltip: "Power management and distribution chain efficiency.",
  },
  {
    path: "eps.arr_kw_per_kg",
    group: "Power",
    label: "Array specific power",
    unit: "kW/kg",
    min: 0.05,
    max: 0.3,
    step: 0.005,
    advanced: true,
    tooltip: "Wing-level specific power (~120 W/kg current flexible arrays).",
  },
  {
    path: "eps.arr_margin",
    group: "Power",
    label: "Array margin",
    min: 1,
    max: 1.3,
    step: 0.01,
    advanced: true,
    tooltip: "Sizing margin on the EOL array.",
  },
  {
    path: "eps.aux_w",
    group: "Power",
    label: "Aux bus load",
    unit: "W",
    min: 500,
    max: 10000,
    step: 100,
    advanced: true,
    tooltip: "Avionics + comms constant load.",
  },
  {
    path: "eps.batt_wh_per_kg",
    group: "Power",
    label: "Battery energy density",
    unit: "Wh/kg",
    min: 80,
    max: 300,
    step: 5,
    advanced: true,
    tooltip: "Pack-level specific energy (Li-ion ~130 Wh/kg space-rated).",
  },
  {
    path: "eps.batt_eta_chg",
    group: "Power",
    label: "Charge efficiency",
    min: 0.85,
    max: 1,
    step: 0.005,
    advanced: true,
    tooltip: "Energy retained per Wh pushed into the cells.",
  },
  {
    path: "eps.batt_eta_dis",
    group: "Power",
    label: "Discharge efficiency",
    min: 0.85,
    max: 1,
    step: 0.005,
    advanced: true,
    tooltip: "Energy delivered per Wh drawn from the cells.",
  },
  {
    path: "eps.batt_fade_ref",
    group: "Power",
    label: "Cycle fade @DoD 0.4",
    unit: "/cycle",
    min: 0,
    max: 2e-4,
    step: 1e-6,
    advanced: true,
    tooltip:
      "Capacity fade per cycle at 40% DoD (~20% at 5000 cycles); scales as (DoD/0.4)^exp.",
  },
  {
    path: "eps.batt_fade_dod_exp",
    group: "Power",
    label: "Fade DoD exponent",
    min: 1,
    max: 3,
    step: 0.1,
    advanced: true,
    tooltip: "DoD sensitivity of cycle fade (Li-ion ~2).",
  },
  {
    path: "rad.shield_intrinsic_mm",
    group: "Radiation",
    label: "Intrinsic shielding",
    unit: "mm Al",
    min: 0,
    max: 3,
    step: 0.1,
    advanced: true,
    tooltip: "Board/package/self-shielding on top of the enclosure wall.",
  },
  {
    path: "rad.dose_scale",
    group: "Radiation",
    label: "Dose rate scale",
    unit: "x",
    min: 0.2,
    max: 5,
    step: 0.1,
    log: true,
    advanced: true,
    tooltip: "Uncertainty multiplier on the TID environment.",
  },
  {
    path: "rad.tid_shape",
    group: "Radiation",
    label: "TID Weibull shape",
    min: 1.5,
    max: 6,
    step: 0.1,
    advanced: true,
    tooltip: "Spread of part dose-to-failure (higher = sharper cliff).",
  },
  {
    path: "rad.leak_per_krad",
    group: "Radiation",
    label: "Leakage per krad",
    unit: "/krad",
    min: 0,
    max: 0.05,
    step: 0.001,
    advanced: true,
    tooltip: "Fractional leakage-power growth per krad of TID.",
  },
  {
    path: "rad.seu_per_bit_day",
    group: "Radiation",
    label: "SEU per bit-day",
    min: 1e-13,
    max: 1e-10,
    step: 1e-13,
    log: true,
    advanced: true,
    tooltip: "Quiet-sun LEO upset rate behind nominal shielding.",
  },
  {
    path: "rad.mem_bits_per_gpu",
    group: "Radiation",
    label: "Memory bits per GPU",
    unit: "bit",
    min: 1e11,
    max: 5e12,
    step: 1e10,
    log: true,
    advanced: true,
    tooltip: "HBM + SRAM capacity exposed to upsets (80 GB ~ 6.9e11).",
  },
  {
    path: "rad.unc_fraction",
    group: "Radiation",
    label: "Uncorrectable frac",
    min: 0.001,
    max: 0.1,
    step: 0.001,
    log: true,
    advanced: true,
    tooltip: "Post-ECC fraction of upsets that kill the job.",
  },
  {
    path: "rad.spe_dur_days",
    group: "Radiation",
    label: "SPE duration",
    unit: "d",
    min: 0.5,
    max: 7,
    step: 0.5,
    advanced: true,
    tooltip: "Mean duration of a solar particle event.",
  },
  {
    path: "rad.spe_seu_mult",
    group: "Radiation",
    label: "SPE SEU multiplier",
    unit: "x",
    min: 5,
    max: 100,
    step: 1,
    advanced: true,
    tooltip: "Upset-rate multiplier during a storm.",
  },
  {
    path: "rad.spe_dose_krad_1mm",
    group: "Radiation",
    label: "SPE dose pulse",
    unit: "krad@1mm",
    min: 0,
    max: 1,
    step: 0.01,
    advanced: true,
    tooltip: "Prompt dose per event behind 1 mm Al.",
  },
  {
    path: "rad.box_m2_per_kw_it",
    group: "Radiation",
    label: "Enclosure area",
    unit: "m2/kW",
    min: 0.3,
    max: 3,
    step: 0.1,
    advanced: true,
    tooltip: "Shielded box surface area per kW of IT (sets shield mass).",
  },
  {
    path: "rel.tj_ref_c",
    group: "Reliability",
    label: "AFR reference Tj",
    unit: "degC",
    min: 60,
    max: 100,
    step: 1,
    advanced: true,
    tooltip: "Junction temperature at which the base AFR is quoted.",
  },
  {
    path: "rel.thermal_frac",
    group: "Reliability",
    label: "Thermal failure share",
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
    tooltip: "Share of hard failures that Arrhenius-accelerate with Tj.",
  },
  {
    path: "rel.sel_per_gpu_yr",
    group: "Reliability",
    label: "SEL rate",
    unit: "/GPU-yr",
    min: 0,
    max: 0.02,
    step: 0.0005,
    advanced: true,
    tooltip: "Destructive latch-up hazard (with protection circuits).",
  },
  {
    path: "rel.mmod_per_gpu_yr",
    group: "Reliability",
    label: "MMOD rate",
    unit: "/GPU-yr",
    min: 0,
    max: 0.01,
    step: 0.0002,
    advanced: true,
    tooltip: "Micrometeoroid/debris module-kill hazard mapped per GPU.",
  },
  {
    path: "rel.cyc_nf_ref",
    group: "Reliability",
    label: "Fatigue Nf @30K",
    unit: "cycles",
    min: 1e4,
    max: 1e6,
    step: 1e3,
    log: true,
    advanced: true,
    tooltip: "Coffin-Manson cycles-to-fail at the 30 K reference swing.",
  },
  {
    path: "rel.cyc_dt_ref_k",
    group: "Reliability",
    label: "Fatigue ref swing",
    unit: "K",
    min: 15,
    max: 60,
    step: 1,
    advanced: true,
    tooltip: "Reference per-orbit Tj swing for the fatigue law.",
  },
  {
    path: "rel.cyc_dt_min_k",
    group: "Reliability",
    label: "Fatigue threshold",
    unit: "K",
    min: 2,
    max: 20,
    step: 0.5,
    advanced: true,
    tooltip: "Per-orbit swings below this cause no fatigue damage.",
  },
  {
    path: "rel.afr_scale",
    group: "Reliability",
    label: "AFR scale",
    unit: "x",
    min: 0.2,
    max: 5,
    step: 0.1,
    log: true,
    advanced: true,
    tooltip: "Uncertainty multiplier on the hard-failure rate.",
  },
  {
    path: "mass.it_kg_per_gpu",
    group: "Mission",
    label: "IT mass per GPU",
    unit: "kg",
    min: 10,
    max: 60,
    step: 1,
    advanced: true,
    tooltip: "Server + enclosure + local loop share per GPU.",
  },
  {
    path: "mass.struct_frac",
    group: "Mission",
    label: "Structure fraction",
    min: 0.15,
    max: 0.45,
    step: 0.01,
    advanced: true,
    tooltip: "Primary structure + deployment mechanisms, of subsystem sum.",
  },
  {
    path: "mass.fixed_bus_kg",
    group: "Mission",
    label: "Fixed bus mass",
    unit: "kg",
    min: 100,
    max: 1500,
    step: 10,
    advanced: true,
    tooltip: "ADCS, propulsion, comms terminals, harness base.",
  },
  {
    path: "mass.fixed_frac",
    group: "Mission",
    label: "Bus scaling frac",
    min: 0,
    max: 0.1,
    step: 0.005,
    advanced: true,
    tooltip: "Bus mass share that scales with spacecraft size.",
  },
  {
    path: "mission.epochs_per_year",
    group: "Mission",
    label: "Epochs per year",
    unit: "/yr",
    min: 12,
    max: 52,
    step: 1,
    int: true,
    advanced: true,
    tooltip: "Degradation-epoch cadence (~2 weeks default).",
  },
  {
    path: "mission.dt_orbit_s",
    group: "Mission",
    label: "Fast-loop step",
    unit: "s",
    min: 10,
    max: 60,
    step: 5,
    advanced: true,
    tooltip: "Time step of the orbit transient loop.",
  },
];

// ------------------------------------------------------- config path helpers

/** Read a numeric config field by dot path (e.g. "chip.tdp_w"). */
export function getParam(cfg: Config, path: string): number {
  const [g, k] = path.split(".") as [keyof Config, string];
  const group = cfg[g] as unknown as Record<string, number>;
  return group[k];
}

/** Return a new Config with one field set (validated + coupled updates). */
export function setParam(cfg: Config, path: string, value: number): Config {
  const next = structuredClone(cfg);
  const [g, k] = path.split(".") as [keyof Config, string];
  (next[g] as unknown as Record<string, number>)[k] = value;
  // Coupled updates that keep the model self-consistent:
  if (path === "chip.tdp_w") {
    // Keep dynamic/leakage shares of TDP fixed (defaults 460/700 and 120/700,
    // constructed so P_gpu(f=1, Tj=85C) = TDP exactly).
    next.chip.p_dyn0_w = (value * 460) / 700;
    next.chip.p_leak0_w = (value * 120) / 700;
  }
  if (path === "chip.tj_target_c") {
    // Keep the hard limit a fixed 7 K above the setpoint (as in reference
    // study D) unless the user moved it explicitly in advanced.
    if (Math.abs(cfg.chip.tj_max_c - (cfg.chip.tj_target_c + 7)) < 1e-9) {
      next.chip.tj_max_c = value + 7;
    }
  }
  return ConfigSchema.parse(next);
}

/** Parse an imported design JSON; throws ZodError with readable issues. */
export function parseConfig(json: unknown): Config {
  return ConfigSchema.parse(json);
}
