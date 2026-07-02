/**
 * Physical constants and fixed model constants (SI unless noted).
 *
 * Ported from sdcsim/constants.py plus every literal that appears inside the
 * reference physics loops, promoted to a named constant here so no magic
 * numbers live in the physics code (see simulator.md code-quality rules).
 */

/** Stefan-Boltzmann constant [W m^-2 K^-4] (CODATA). */
export const SIGMA = 5.670374419e-8;
/** Solar constant at 1 AU [W/m^2] (mean total solar irradiance). */
export const S_SOLAR = 1361.0;
/** Mean Earth outgoing longwave radiation [W/m^2] (ERBE/CERES-class mean). */
export const Q_EARTH_IR = 237.0;
/** Mean Earth Bond albedo [-]. */
export const ALBEDO = 0.3;
/**
 * Earth radius used for orbit geometry [km].
 *
 * NOTE: WGS-84 equatorial radius. sdcsim uses the 6371 km mean radius; the
 * spec acceptance test pins the 550 km circular period at 5,739 +/- 1 s which
 * requires the equatorial value. Affects period and eclipse fraction by
 * <0.2% relative to the Python reference (mission outputs shift <<1%).
 */
export const R_EARTH_KM = 6378.137;
/** Earth gravitational parameter mu [km^3/s^2] (EGM96). */
export const MU_EARTH = 398600.4418;
/** Julian year [s]. */
export const SECONDS_PER_YEAR = 365.25 * 86400.0;
export const SECONDS_PER_DAY = 86400.0;
/** Boltzmann constant [eV/K]. */
export const K_B_EV = 8.617333e-5;
/** 0 degC in kelvin. */
export const C_TO_K = 273.15;
/** Smoothed solar activity cycle length [yr]. */
export const SOLAR_CYCLE_YR = 11.0;

// ---------------------------------------------------------------- orbit loop
// Constants of the fast coupled loop (sdcsim/orbitloop.py), values identical.

/** DVFS proportional gain per 30 s step [1/K]; scaled by (dt/30). */
export const DVFS_KP_PER_30S = 0.006;
/** Reference step for the gain scaling [s]. */
export const DVFS_KP_DT_REF_S = 30.0;
/** Max DVFS frequency slew per step, upward [-/step]. */
export const F_SLEW_UP = 0.03;
/** Max DVFS frequency slew per step, downward [-/step]. */
export const F_SLEW_DOWN = 0.05;
/** Tj error above which the step counts as thermally limited [K]. */
export const THERMAL_LIMITED_ERR_K = 0.5;
/** f below this counts as "not at full clock" for the thermal-limited flag. */
export const F_NEAR_ONE = 0.999;
/** Fraction of stored battery energy accessible within one step [-]. */
export const SOC_ACCESS_FRAC = 0.98;
/** Bisection iterations for the supply-dispatch frequency cap. */
export const DISPATCH_BISECT_ITERS = 22;
/** Fixed-point iterations for the leakage<->Tj junction solve. */
export const TJ_FIXED_POINT_ITERS = 3;
/** Initial Tj guess offset above coolant for the fixed point [K]. */
export const TJ_INIT_OFFSET_K = 40.0;
/** Frequency cut applied when Tj exceeds the hard limit [-/step]. */
export const TJ_HARD_LIMIT_F_STEP = 0.1;
/** Heat into the loop while idle, as fraction of idle bus load [-]. */
export const IDLE_HEAT_FRAC = 0.9;
/** Pump power fraction retained while idle [-]. */
export const IDLE_PUMP_FRAC = 0.3;
/** Idle IT heat estimate scale (of scaled design heat) [-]. */
export const IDLE_P_IT_SCALE = 0.8;
/** GPU power placeholder while idle, as fraction of TDP [-]. */
export const IDLE_P_GPU_TDP_FRAC = 0.2;
/** Fraction of aux (avionics/comms) power dissipated into the coolant loop. */
export const AUX_HEAT_FRAC = 0.6;
/** Floor on lumped radiator heat capacity [J/K]. */
export const C_RAD_MIN_J_K = 1e3;
/** Warm-start orbits simulated for the first epoch [-]. */
export const EPOCH0_ORBITS = 4.0;
/** Orbits simulated per steady-periodic epoch thereafter [-]. */
export const EPOCH_ORBITS = 1.5;
/** Initial coolant node temperature [K]. */
export const T_COOL_INIT_K = 300.0;
/** Initial radiator node temperature [K]. */
export const T_RAD_INIT_K = 285.0;
/** Initial DVFS frequency [-]. */
export const F_INIT = 0.8;
/** Initial per-GPU power estimate, as fraction of TDP [-]. */
export const P_GPU_INIT_TDP_FRAC = 0.8;

// -------------------------------------------------------------------- sizing
// Constants of the design-point sizing rules (sdcsim/design.py).

/** Floor on net radiator rejection used in sizing [W/m^2]; hitting it means
 *  the radiator cannot reach equilibrium at the requested setpoint — surfaced
 *  as a design warning, never silently. */
export const NET_REJECTION_FLOOR_W_M2 = 30.0;
/** Coating absorptance used for sizing: alpha_BOL + this fraction of drift. */
export const SIZING_ALPHA_DRIFT_FRAC = 0.6;
/** Sample count for the worst-eclipse-fraction scan over one year. */
export const WORST_FE_SAMPLES = 1600;
/** Worst-eclipse scan horizon [yr]. */
export const WORST_FE_HORIZON_YR = 1.0;
/** Density of aluminium shielding [kg/m^3]. */
export const AL_DENSITY_KG_M3 = 2700.0;
/** Solar-cell reference temperature for the efficiency law [degC]. */
export const CELL_T_REF_C = 28.0;

// ----------------------------------------------------------------- radiation
// Constants of the parametric radiation environment (sdcsim/radiation.py).
// All anchored to SPENVIS-class LEO outputs; see MODEL.md for calibration.

/** Trapped-dose anchor: krad(Si)/yr behind 1 mm Al at 550 km SSO. */
export const DOSE_ANCHOR_KRAD_YR = 6.0;
/** Altitude e-folding of the trapped-dose anchor [km]. */
export const DOSE_ALT_EFOLD_KM = 250.0;
/** Dose-depth power-law exponent [-] (Al-equivalent slab). */
export const DOSE_DEPTH_EXP = -1.3;
/** GCR/secondary dose floor [krad/yr]. */
export const DOSE_FLOOR_KRAD_YR = 0.35;
/** Minimum effective shield depth for the power law [mm]. */
export const DOSE_MIN_DEPTH_MM = 0.2;
/** Inclination factor for mid-inclination (non-polar) orbits [-]. */
export const DOSE_INCL_FACTOR_MID = 0.85;
/** Trapped-proton solar modulation: rate = (a - b*s_act). */
export const DOSE_SOLAR_A = 1.15;
export const DOSE_SOLAR_B = 0.3;
/** SPE Poisson rate = min + range*s_act [1/yr]. */
export const SPE_RATE_MIN_PER_YR = 0.4;
export const SPE_RATE_RANGE_PER_YR = 4.6;
/** SEU shielding response: floor + ampl*exp(-depth/scale). */
export const SEU_SHIELD_FLOOR = 0.7;
export const SEU_SHIELD_AMPL = 0.3;
export const SEU_SHIELD_EFOLD_MM = 2.0;
/** SPE dose-pulse attenuation e-folding depth beyond 1 mm [mm]. */
export const SPE_DOSE_ATTEN_MM = 1.2;
/** Checkpoint overhead ceiling (work grinds to a halt) [-]. */
export const CKPT_MAX_OVERHEAD = 0.95;
/** MTBF below this multiple of the checkpoint write time -> ceiling. */
export const CKPT_MTBF_MIN_RATIO = 4.0;
/** SEL hazard solar-activity weighting: rate * (base + s_act). */
export const SEL_SOLAR_BASE = 0.5;

// ------------------------------------------------------------------- battery
/** Reference depth-of-discharge for the cycle-fade coefficient [-]. */
export const BATT_FADE_DOD_REF = 0.4;
/** Minimum per-orbit DoD that counts as a battery cycle for fade [-]. */
export const BATT_FADE_DOD_MIN = 0.01;
