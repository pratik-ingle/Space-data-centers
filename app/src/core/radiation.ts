/**
 * Radiation environment and its compute-level consequences.
 *
 * Parametric fits with SPENVIS-class shapes: TID rate vs Al-equivalent shield
 * depth (power law + GCR floor), SEU-driven uncorrectable error rates, solar
 * particle event statistics, and the Daly checkpoint-overhead model that
 * turns error rates into lost compute. Port of sdcsim/radiation.py.
 */
import {
  CKPT_MAX_OVERHEAD,
  CKPT_MTBF_MIN_RATIO,
  DOSE_ALT_EFOLD_KM,
  DOSE_ANCHOR_KRAD_YR,
  DOSE_DEPTH_EXP,
  DOSE_FLOOR_KRAD_YR,
  DOSE_INCL_FACTOR_MID,
  DOSE_MIN_DEPTH_MM,
  DOSE_SOLAR_A,
  DOSE_SOLAR_B,
  SEU_SHIELD_AMPL,
  SEU_SHIELD_EFOLD_MM,
  SEU_SHIELD_FLOOR,
  SPE_RATE_MIN_PER_YR,
  SPE_RATE_RANGE_PER_YR,
} from "./constants";
import type { OrbitProfileT, RadP } from "./params";

/**
 * TID rate in silicon behind an Al-equivalent slab [krad(Si)/yr].
 *
 * Shape: trapped-particle power law (~ depth^-1.3) + GCR/secondary floor,
 * anchored to ~6 krad/yr behind 1 mm at 550 km SSO. Trapped protons at LEO
 * anticorrelate with solar activity (the atmosphere swells at solar max and
 * sweeps the inner belt). Replace with a SPENVIS/OMERE dose-depth table for
 * a real design point (see MODEL.md).
 */
export function doseRateKradPerYr(
  shieldMmEff: number,
  altKm: number,
  profile: OrbitProfileT,
  sAct: number,
  scale = 1,
): number {
  const aTrapped = DOSE_ANCHOR_KRAD_YR * Math.exp((altKm - 550) / DOSE_ALT_EFOLD_KM);
  const incl = profile === "dd_sso" || profile === "custom" ? 1 : DOSE_INCL_FACTOR_MID;
  const solar = DOSE_SOLAR_A - DOSE_SOLAR_B * sAct;
  const d = Math.max(shieldMmEff, DOSE_MIN_DEPTH_MM);
  return scale * incl * (aTrapped * solar * d ** DOSE_DEPTH_EXP + DOSE_FLOOR_KRAD_YR);
}

/** Poisson rate of significant solar particle events [1/yr]. */
export function speRatePerYr(sAct: number): number {
  return SPE_RATE_MIN_PER_YR + SPE_RATE_RANGE_PER_YR * sAct;
}

/** Uncorrectable (post-ECC) memory error rate per GPU per day. */
export function uncErrorRatePerGpuDay(
  rad: RadP,
  shieldMmEff: number,
  speMult = 1,
): number {
  const base =
    rad.seu_per_bit_day *
    (SEU_SHIELD_FLOOR + SEU_SHIELD_AMPL * Math.exp(-shieldMmEff / SEU_SHIELD_EFOLD_MM));
  return rad.seu_scale * base * rad.mem_bits_per_gpu * rad.unc_fraction * speMult;
}

/**
 * First-order Daly model: fraction of wall-clock lost to checkpoint writes +
 * rollback + restart at the optimal checkpoint interval tau* = sqrt(2*delta*M):
 *   overhead ~= delta/tau + tau/(2M) + R/M
 * (J. T. Daly, FGCS 22 (2006) 303-312). Clamped at 0.95 — beyond that the
 * machine spends its life restarting.
 */
export function checkpointOverhead(
  deltaS: number,
  restartS: number,
  mtbfS: number,
): number {
  if (deltaS <= 0) {
    // Free checkpoints: overhead reduces to restart time per failure.
    // (Reference never exercises delta <= 0; guard added for test 7.)
    return Math.min(CKPT_MAX_OVERHEAD, restartS / mtbfS);
  }
  if (mtbfS <= CKPT_MTBF_MIN_RATIO * deltaS) return CKPT_MAX_OVERHEAD;
  const tau = Math.sqrt(2 * deltaS * mtbfS);
  const ov = deltaS / tau + tau / (2 * mtbfS) + restartS / mtbfS;
  return Math.min(CKPT_MAX_OVERHEAD, ov);
}

/** Daly overhead at an arbitrary (non-optimal) checkpoint interval tau —
 *  used by the validation test that the optimum sits at sqrt(2*delta*M). */
export function checkpointOverheadAtTau(
  deltaS: number,
  restartS: number,
  mtbfS: number,
  tauS: number,
): number {
  return deltaS / tauS + tauS / (2 * mtbfS) + restartS / mtbfS;
}
