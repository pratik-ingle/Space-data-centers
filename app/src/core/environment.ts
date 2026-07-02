/**
 * Orbit + space-environment boundary conditions (the driving layer).
 *
 * Circular-orbit analytical models: beta-angle seasonal profiles, eclipse
 * fraction from cylindrical-shadow geometry, 11-year solar activity index.
 * Port of sdcsim/environment.py (see constants.ts for the Earth-radius note).
 */
import {
  MU_EARTH,
  R_EARTH_KM,
  SECONDS_PER_DAY,
  SECONDS_PER_YEAR,
  SOLAR_CYCLE_YR,
  WORST_FE_HORIZON_YR,
  WORST_FE_SAMPLES,
} from "./constants";
import type { OrbitP } from "./params";

/** Keplerian circular-orbit period T = 2*pi*sqrt(a^3/mu) [s]. */
export function orbitPeriodS(altKm: number): number {
  const a = R_EARTH_KM + altKm;
  return 2 * Math.PI * Math.sqrt(a ** 3 / MU_EARTH);
}

/**
 * Solar beta angle [deg] at mission time t.
 * dd_sso / custom: beta = mean + amp*cos(2*pi*t/yr)   (seasonal)
 * mid_incl: beta = a1*sin(2*pi*t/T_prec) + a2*sin(2*pi*t/yr)
 *           (nodal precession beat against the seasonal term, ISS-like)
 */
export function betaDeg(tS: number, o: OrbitP): number {
  const tYr = tS / SECONDS_PER_YEAR;
  switch (o.profile) {
    case "dd_sso":
    case "custom":
      return o.beta_mean_deg + o.beta_amp_deg * Math.cos(2 * Math.PI * tYr);
    case "mid_incl": {
      const tD = tS / SECONDS_PER_DAY;
      return (
        o.mi_a1_deg * Math.sin((2 * Math.PI * tD) / o.mi_precession_days) +
        o.mi_a2_deg * Math.sin(2 * Math.PI * tYr)
      );
    }
  }
}

/**
 * Fraction of a circular orbit spent in umbra (cylindrical Earth-shadow
 * model): fe = acos( sqrt(h^2 + 2*R*h) / ((R+h) cos beta) ) / pi, zero when
 * the argument exceeds 1 (orbit fully sunlit above beta*).
 */
export function eclipseFraction(altKm: number, beta: number): number {
  const cb = Math.cos((beta * Math.PI) / 180);
  if (cb <= 1e-9) return 0;
  const h = altKm;
  const r = R_EARTH_KM;
  const x = Math.sqrt(h * h + 2 * r * h) / ((r + h) * cb);
  if (x >= 1) return 0;
  return Math.acos(x) / Math.PI;
}

/** Beta angle above which a circular orbit at altKm is eclipse-free [deg]. */
export function betaStarDeg(altKm: number): number {
  const h = altKm;
  const r = R_EARTH_KM;
  const x = Math.sqrt(2 * r * h + h * h) / (r + h);
  return (Math.acos(x) * 180) / Math.PI;
}

/** Smoothed 11-year solar-cycle activity index in [0, 1]. */
export function solarActivity(tS: number, phase0 = 0): number {
  return (
    0.5 *
    (1 + Math.sin((2 * Math.PI * tS) / (SOLAR_CYCLE_YR * SECONDS_PER_YEAR) + phase0))
  );
}

/** Worst eclipse fraction over a one-year beta sweep (design driver). */
export function worstEclipseFraction(
  o: OrbitP,
  horizonYr = WORST_FE_HORIZON_YR,
  n = WORST_FE_SAMPLES,
): number {
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const t = (i * horizonYr * SECONDS_PER_YEAR) / n;
    const fe = eclipseFraction(o.alt_km, betaDeg(t, o));
    if (fe > worst) worst = fe;
  }
  return worst;
}

/**
 * Eclipse window within one orbit period [s], as used by the fast loop:
 * shadow centred at half-period, entry at 0.5*(1-fe)*P, exit fe*P later.
 */
export function eclipseWindow(
  fe: number,
  periodS: number,
): { start: number; end: number } {
  const start = 0.5 * (1 - fe) * periodS;
  return { start, end: start + fe * periodS };
}
