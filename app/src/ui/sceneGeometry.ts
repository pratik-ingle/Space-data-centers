/**
 * Pure display geometry for the 3D scene (no Three.js imports; unit-tested).
 *
 * Frame convention (matches the physics' phase convention exactly):
 *  - Earth at origin; the orbit is the x-y plane, orbit normal = +z.
 *  - The sun direction lies in the x-z plane: s = (cos beta, 0, sin beta),
 *    so beta is the angle between the sun vector and the orbit plane —
 *    the same beta the environment model produces.
 *  - Orbit phase theta = 2*pi * (phase_s / period): theta = 0 is the
 *    sub-solar point ("orbit noon"). The fast loop centres its eclipse
 *    window at half-period (environment.eclipseWindow), i.e. at theta = pi,
 *    which is exactly where the cylindrical-shadow test below is deepest —
 *    the 3D shadow and the telemetry illum flag agree by construction.
 *
 * Scene scale: 1 unit = 1000 km. Spacecraft geometry uses an exaggeration
 * factor so the vehicle is visible against the planet; the *relative*
 * proportions of bus / radiator / wings stay true to the sized areas.
 */
import { R_EARTH_KM } from "../core/constants";

export type Vec3 = [number, number, number];

export const KM_PER_UNIT = 1000;
export const R_EARTH_UNITS = R_EARTH_KM / KM_PER_UNIT;
/** Spacecraft drawing scale [scene units per metre] (~50,000x true scale). */
export const METERS_TO_UNITS = 0.05;

/** Unit sun direction for a given beta angle [deg]. */
export function sunDirection(betaDeg: number): Vec3 {
  const b = (betaDeg * Math.PI) / 180;
  return [Math.cos(b), 0, Math.sin(b)];
}

/** Orbit radius in scene units. */
export function orbitRadiusUnits(altKm: number): number {
  return (R_EARTH_KM + altKm) / KM_PER_UNIT;
}

/** Spacecraft position for phase fraction in [0,1) (0 = sub-solar). */
export function spacecraftPos(altKm: number, phaseFrac: number): Vec3 {
  const r = orbitRadiusUnits(altKm);
  const th = 2 * Math.PI * phaseFrac;
  return [r * Math.cos(th), r * Math.sin(th), 0];
}

/**
 * Cylindrical Earth-shadow test (the same reduced-order model the physics
 * uses for eclipse fraction): in umbra iff the point is on the anti-sun
 * side and its distance from the shadow axis is under one Earth radius.
 */
export function inShadow(pos: Vec3, sunDir: Vec3): boolean {
  const d = pos[0] * sunDir[0] + pos[1] * sunDir[1] + pos[2] * sunDir[2];
  if (d >= 0) return false;
  const px = pos[0] - d * sunDir[0];
  const py = pos[1] - d * sunDir[1];
  const pz = pos[2] - d * sunDir[2];
  return Math.hypot(px, py, pz) < R_EARTH_UNITS;
}

/** Velocity direction (prograde tangent) at phase fraction. */
export function velocityDir(phaseFrac: number): Vec3 {
  const th = 2 * Math.PI * phaseFrac;
  return [-Math.sin(th), Math.cos(th), 0];
}

export interface SpacecraftDims {
  /** Shielded-box side [m]. */
  busSide: number;
  /** One radiator panel: width (radial) x length (along orbit normal) [m]. */
  radW: number;
  radL: number;
  /** One solar wing: chord x length (along velocity boom) [m]. */
  wingChord: number;
  wingLen: number;
}

/**
 * Physical part dimensions from the sized design. Areas are exact; aspect
 * ratios are display choices (panels 1:2, wings 1:2.2). The shielded-box
 * area is recovered from the shield mass line item rather than re-deriving
 * IT power here (no physics in the display layer).
 */
export function spacecraftDims(
  radAreaPhysM2: number,
  arrAreaM2: number,
  shieldMassKg: number,
  shieldMm: number,
  alDensityKgM3: number,
): SpacecraftDims {
  const boxM2 = Math.max(
    shieldMassKg / Math.max(alDensityKgM3 * (shieldMm / 1000), 1e-9),
    0.5,
  );
  const busSide = Math.sqrt(boxM2 / 6);
  // two radiator panels, each radAreaPhys/2, aspect L = 2W
  const radW = Math.sqrt(radAreaPhysM2 / 4);
  const radL = 2 * radW;
  // two wings, each arrArea/2, aspect L = 2.2C
  const wingChord = Math.sqrt(arrAreaM2 / 4.4);
  const wingLen = 2.2 * wingChord;
  return { busSide, radW, radL, wingChord, wingLen };
}
