/** Seeded-RNG determinism and distribution sanity. */
import { describe, expect, it } from "vitest";
import { deriveSeed, mulberry32 } from "../core/rng";

describe("mulberry32", () => {
  it("is deterministic for a fixed seed and differs across seeds", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const c = mulberry32(124);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    const seqC = Array.from({ length: 100 }, () => c.next());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const x of seqA) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("lognormal(-s^2/2, s) has mean ~1 (unit-mean multiplier convention)", () => {
    const rng = mulberry32(7);
    const n = 8000;
    let acc = 0;
    for (let i = 0; i < n; i++) acc += rng.lognormal(-0.5 * 0.5 * 0.5, 0.5);
    expect(Math.abs(acc / n - 1)).toBeLessThan(0.03);
  });

  it("poisson and binomial have the right means", () => {
    const rng = mulberry32(42);
    const n = 6000;
    let sp = 0;
    let sb = 0;
    for (let i = 0; i < n; i++) {
      sp += rng.poisson(0.8);
      sb += rng.binomial(32, 0.1);
    }
    expect(Math.abs(sp / n - 0.8)).toBeLessThan(0.05);
    expect(Math.abs(sb / n - 3.2)).toBeLessThan(0.1);
  });

  it("deriveSeed yields distinct streams", () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 1000; i++) seeds.add(deriveSeed(7, i));
    expect(seeds.size).toBe(1000);
  });
});
