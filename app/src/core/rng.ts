/**
 * Deterministic seeded RNG so every stochastic run is bit-reproducible
 * (simulator.md: seeded RNG for all stochastic processes).
 *
 * Base generator: mulberry32 (Tommy Ettinger, public domain) — a 32-bit
 * state PRNG with good statistical quality for simulation (not crypto).
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  uniform(lo: number, hi: number): number;
  /** Standard normal via Box-Muller (two uniforms per draw). */
  normal(): number;
  /** Lognormal with underlying N(mu, sigma^2) — numpy convention. */
  lognormal(mu: number, sigma: number): number;
  /** Poisson via Knuth's product method (fine for lambda < ~30). */
  poisson(lambda: number): number;
  /** Binomial as a sum of Bernoulli trials (fine for n <= a few thousand). */
  binomial(n: number, p: number): number;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    uniform: (lo, hi) => lo + (hi - lo) * next(),
    normal: () => {
      // Box-Muller; guard u1 > 0 to avoid log(0).
      let u1 = next();
      if (u1 <= 1e-12) u1 = 1e-12;
      const u2 = next();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    lognormal: (mu, sigma) => Math.exp(mu + sigma * rng.normal()),
    poisson: (lambda) => {
      if (lambda <= 0) return 0;
      const l = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k += 1;
        p *= next();
      } while (p > l);
      return k - 1;
    },
    binomial: (n, p) => {
      if (p <= 0 || n <= 0) return 0;
      if (p >= 1) return n;
      let s = 0;
      for (let i = 0; i < n; i++) if (next() < p) s += 1;
      return s;
    },
  };
  return rng;
}

/**
 * Derive an independent stream seed from a base seed and an index
 * (golden-ratio increment, splitmix-style mixing).
 */
export function deriveSeed(base: number, index: number): number {
  let x = (base + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return (x ^ (x >>> 15)) >>> 0;
}
