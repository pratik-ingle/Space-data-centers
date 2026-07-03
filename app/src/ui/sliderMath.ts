/**
 * Slider position <-> parameter value mapping (pure; unit-tested).
 * Linear sliders snap to the schema step; log sliders (wide-range params)
 * snap to 3 significant figures; int params round to integers.
 */
import type { ParamMeta } from "../core/params";
import { clamp, roundDust } from "./format";

export const SLIDER_STEPS = 1000;

export function valToPos(m: ParamMeta, v: number): number {
  const t = m.log
    ? Math.log(v / m.min) / Math.log(m.max / m.min)
    : (v - m.min) / (m.max - m.min);
  return Math.round(clamp(t, 0, 1) * SLIDER_STEPS);
}

export function posToVal(m: ParamMeta, pos: number): number {
  const t = clamp(pos / SLIDER_STEPS, 0, 1);
  let v = m.log ? m.min * (m.max / m.min) ** t : m.min + (m.max - m.min) * t;
  if (m.log) {
    v = Number(v.toPrecision(3));
  } else {
    v = m.min + Math.round((v - m.min) / m.step) * m.step;
  }
  if (m.int) v = Math.round(v);
  return roundDust(clamp(v, m.min, m.max));
}
