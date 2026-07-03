/**
 * 3D display geometry must agree with the physics, not approximate it:
 * the scene's cylindrical-shadow test integrated around the orbit has to
 * reproduce the environment model's eclipse fraction, and the sun vector
 * has to encode beta exactly. (The Earth terminator and scene lighting are
 * driven by the same sun vector, so their consistency follows.)
 */
import { describe, expect, it } from "vitest";
import { betaStarDeg, eclipseFraction } from "../core/environment";
import { inferno, infernoCssGradient, radT01 } from "../ui/colormap";
import {
  inShadow,
  orbitRadiusUnits,
  spacecraftDims,
  spacecraftPos,
  sunDirection,
  velocityDir,
} from "../ui/sceneGeometry";

describe("scene geometry vs physics", () => {
  it("shadow arc fraction reproduces eclipseFraction(h, beta)", () => {
    const N = 8192;
    for (const alt of [300, 550, 1200]) {
      for (const beta of [0, 20, 45, 60, 66, 75, 85]) {
        const s = sunDirection(beta);
        let dark = 0;
        for (let i = 0; i < N; i++) {
          if (inShadow(spacecraftPos(alt, i / N), s)) dark++;
        }
        const fe = eclipseFraction(alt, beta);
        expect(Math.abs(dark / N - fe)).toBeLessThan(2e-3);
      }
    }
  });

  it("shadow vanishes exactly above beta*", () => {
    const alt = 550;
    const bs = betaStarDeg(alt);
    const sBelow = sunDirection(bs - 0.5);
    const sAbove = sunDirection(bs + 0.5);
    // midnight point (phase 0.5) is the deepest-shadow point
    const midnight = spacecraftPos(alt, 0.5);
    expect(inShadow(midnight, sBelow)).toBe(true);
    expect(inShadow(midnight, sAbove)).toBe(false);
  });

  it("phase 0 (orbit noon) is always sunlit", () => {
    for (const beta of [0, 30, 60, 89]) {
      expect(inShadow(spacecraftPos(550, 0), sunDirection(beta))).toBe(false);
    }
  });

  it("sun vector encodes beta against the orbit plane", () => {
    for (const beta of [-30, 0, 45, 78, 90]) {
      const [x, y, z] = sunDirection(beta);
      expect(z).toBeCloseTo(Math.sin((beta * Math.PI) / 180), 12);
      expect(y).toBe(0);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    }
  });

  it("velocity is the prograde tangent", () => {
    const p = spacecraftPos(550, 0.13);
    const v = velocityDir(0.13);
    // perpendicular to radius, unit length, +z angular momentum
    expect(p[0] * v[0] + p[1] * v[1]).toBeCloseTo(0, 9);
    expect(Math.hypot(...v)).toBeCloseTo(1, 12);
    expect(p[0] * v[1] - p[1] * v[0]).toBeGreaterThan(0);
    expect(orbitRadiusUnits(550)).toBeCloseTo(6.928137, 5);
  });

  it("spacecraft dims conserve the sized areas", () => {
    const d = spacecraftDims(47.2, 66.0, 120, 3, 2700);
    expect(2 * d.radW * d.radL).toBeCloseTo(47.2, 9);
    expect(2 * d.wingChord * d.wingLen).toBeCloseTo(66.0, 9);
    // box side recovered from the shield mass line item
    const boxM2 = 120 / (2700 * 0.003);
    expect(d.busSide).toBeCloseTo(Math.sqrt(boxM2 / 6), 9);
  });
});

describe("radiator colormap", () => {
  it("inferno endpoints and monotone red channel", () => {
    expect(inferno(0)[0]).toBeLessThan(0.01);
    expect(inferno(1)[0]).toBeGreaterThan(0.95);
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const r = inferno(i / 20)[0];
      expect(r).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = r;
    }
  });

  it("radT01 clamps to the display range", () => {
    expect(radT01(-100)).toBe(0);
    expect(radT01(200)).toBe(1);
    expect(radT01(20)).toBeCloseTo(0.5, 9);
  });

  it("legend gradient matches the ramp", () => {
    const css = infernoCssGradient(4);
    expect(css.startsWith("linear-gradient(90deg")).toBe(true);
    expect(css).toContain("rgb(0,0,4) 0%");
  });
});
