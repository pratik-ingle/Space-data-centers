/**
 * Display-side number/time formatting. SI units live in the core; the UI
 * boundary converts to display units (degC, kW, %, yr) and here we only
 * decide how many digits to print.
 */
import { SECONDS_PER_DAY, SECONDS_PER_YEAR } from "../core/constants";

/** Decimal places implied by a slider step (0.05 -> 2, 10 -> 0). */
export function stepDecimals(step: number): number {
  if (step >= 1) return 0;
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

/** Strip binary-float dust without losing real precision (0.30000000000000004 -> 0.3). */
export function roundDust(v: number): number {
  return v === 0 ? 0 : Number(v.toPrecision(12));
}

/** Clamp helper. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * General numeric formatting: fixed-point in the human range, scientific
 * outside it. Used for readouts and chart legend values.
 */
export function fmtNum(v: number | null | undefined, sig = 3): string {
  if (v == null || Number.isNaN(v)) return "–";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(Math.max(0, sig - 2));
  const dec = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
  return v.toFixed(Math.min(dec, 4));
}

/** Fixed decimals, en-dash for missing. */
export function fmtFixed(v: number | null | undefined, dec: number): string {
  if (v == null || Number.isNaN(v)) return "–";
  return v.toFixed(dec);
}

/** Percent from a 0..1 fraction. */
export function fmtPct(frac: number | null | undefined, dec = 0): string {
  if (frac == null || Number.isNaN(frac)) return "–";
  return `${(100 * frac).toFixed(dec)}%`;
}

/** Mission time: years above ~2 months, else days/hours/minutes. */
export function fmtDuration(s: number): string {
  if (!Number.isFinite(s)) return "–";
  const yr = s / SECONDS_PER_YEAR;
  if (yr >= 0.15) return `${yr.toFixed(2)} yr`;
  const d = s / SECONDS_PER_DAY;
  if (d >= 2) return `${d.toFixed(1)} d`;
  const h = s / 3600;
  if (h >= 2) return `${h.toFixed(1)} h`;
  const m = s / 60;
  if (m >= 2) return `${m.toFixed(1)} min`;
  return `${s.toFixed(0)} s`;
}

/** Time-warp label: "3,000x". */
export function fmtWarp(w: number): string {
  return `${Math.round(w).toLocaleString("en-US")}×`;
}
