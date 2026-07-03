/**
 * Inferno colormap (perceptually uniform, colorblind-safe; Matplotlib's
 * standard thermal ramp) for the radiator temperature coloring — a
 * sequential single-family ramp per the dataviz rules for magnitude.
 * 9 anchor stops, linearly interpolated.
 */
export type Rgb = [number, number, number];

// Matplotlib inferno sampled at t = 0, 1/8, ..., 1 (#000004, #1b0c42,
// #4b0c6b, #781c6d, #a52c60, #cf4446, #ed6925, #fb9a06, #fcffa4).
const STOPS: Rgb[] = [
  [0.0, 0.0, 0.016],
  [0.106, 0.047, 0.259],
  [0.294, 0.047, 0.42],
  [0.471, 0.11, 0.427],
  [0.647, 0.173, 0.376],
  [0.812, 0.267, 0.275],
  [0.929, 0.412, 0.145],
  [0.984, 0.604, 0.024],
  [0.988, 1.0, 0.643],
];

/** t in [0,1] -> inferno RGB (0..1 floats). */
export function inferno(t: number): Rgb {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.min(Math.floor(x), STOPS.length - 2);
  const f = x - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

/** Radiator display range [degC] — spans idle cold-soak to hot design point. */
export const RAD_T_MIN_C = -30;
export const RAD_T_MAX_C = 70;

/** Map radiator temperature [degC] to the ramp parameter. */
export function radT01(tC: number): number {
  return Math.min(1, Math.max(0, (tC - RAD_T_MIN_C) / (RAD_T_MAX_C - RAD_T_MIN_C)));
}

/** CSS gradient stops for the on-screen legend (must match inferno()). */
export function infernoCssGradient(n = 8): string {
  const stops: string[] = [];
  for (let i = 0; i <= n; i++) {
    const [r, g, b] = inferno(i / n);
    stops.push(
      `rgb(${Math.round(255 * r)},${Math.round(255 * g)},${Math.round(255 * b)}) ${(100 * i) / n}%`,
    );
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
