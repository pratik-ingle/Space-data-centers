/** Shared test utilities: fixture loading and tolerance assertions. */
import { readFileSync } from "node:fs";
import { expect } from "vitest";
import type { Config } from "../core/params";
import { baselineDd, issLike } from "../core/params";

export function loadFixture<T>(name: string): T {
  const url = new URL(`./fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf-8")) as T;
}

/** |a-b| <= abs + rel*|b|  (b is the reference value). */
export function expectClose(
  a: number,
  b: number,
  rel = 1e-9,
  abs = 1e-9,
  msg = "",
): void {
  const tol = abs + rel * Math.abs(b);
  expect(
    Math.abs(a - b),
    `${msg} got ${a}, want ${b} (tol ${tol})`,
  ).toBeLessThanOrEqual(tol);
}

/** Disable the battery cycle-fade extension for exact parity with the
 *  Python reference (which defines the knob but never applies it). */
export function noFade(c: Config): Config {
  c.eps.batt_fade_ref = 0;
  return c;
}

/** The mission/sizing fixture variants, mirrored from scripts/gen_fixtures.py. */
export const FIXTURE_CONFIGS: Record<string, () => Config> = {
  baseline_dd: () => baselineDd(),
  iss_full: () => issLike(1.0),
  iss_lean: () => issLike(0.35),
  rad07: () => {
    const c = baselineDd();
    c.thermal.rad_area_scale = 0.7;
    return c;
  },
  tj65: () => {
    const c = baselineDd();
    c.chip.tj_target_c = 65;
    c.chip.tj_max_c = 72;
    return c;
  },
  shield15: () => {
    const c = baselineDd();
    c.rad.shield_mm = 1.5;
    return c;
  },
  shield08: () => {
    const c = baselineDd();
    c.rad.shield_mm = 0.8;
    return c;
  },
  alt800: () => {
    const c = baselineDd();
    c.orbit.alt_km = 800;
    return c;
  },
  n128: () => {
    const c = baselineDd();
    c.chip.n_gpu = 128;
    return c;
  },
  dod55: () => {
    const c = baselineDd();
    c.eps.batt_dod = 0.55;
    c.eps.batt_c_dis = 2.0;
    return c;
  },
};
