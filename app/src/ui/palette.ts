/**
 * UI color tokens (display layer only — no physics meaning).
 *
 * Categorical series hues are the dataviz reference palette's dark-mode
 * steps, validated against this app's chart surface (#11151d) with the
 * palette validator: lightness band, chroma floor, CVD separation and
 * contrast all pass. Colors are assigned per physical entity and stay
 * fixed across every chart (identity never follows rank).
 */

/** Fixed per-entity series colors (dark-surface categorical steps). */
export const SERIES = {
  tj: "#e66767", // junction temperature (red)
  tjMax: "#e66767", // same entity, dashed stroke distinguishes
  tRad: "#3987e5", // radiator temperature (blue)
  tCool: "#c98500", // coolant temperature (yellow)
  f: "#9085e9", // DVFS clock fraction (violet)
  soc: "#199e70", // battery state of charge (aqua)
  pArr: "#008300", // array power (green)
  pLoad: "#d95926", // bus load (orange)
  pflops: "#3987e5", // effective compute (blue)
  alive: "#199e70", // GPUs alive (aqua)
  battCap: "#008300", // battery capacity after fade (green, dashed)
  dod: "#c98500", // depth of discharge (yellow)
  tid: "#d55181", // accumulated dose (magenta)
  ovh: "#d55181", // checkpoint tax (magenta)
  idle: "#d95926", // idle duty fraction (orange, dashed)
} as const;

/** Status colors (reserved; shipped with icon + label, never color alone). */
export const STATUS = {
  info: "#3987e5",
  warn: "#fab219",
  crit: "#d03b3b",
  good: "#0ca30c",
} as const;

/** Chart chrome. */
export const CHROME = {
  surface: "#11151d",
  inkPrimary: "#ffffff",
  inkSecondary: "#c3c2b7",
  inkMuted: "#898781",
  grid: "#222839",
  baseline: "#383e4a",
  /** Reference/nameplate lines: chrome, not an entity. */
  reference: "#898781",
  /** Eclipse shading over orbit charts. */
  eclipseFill: "rgba(122, 140, 180, 0.12)",
  /** Solar-particle-event shading over mission charts. */
  speFill: "rgba(213, 81, 129, 0.16)",
  /** Live playhead line. */
  playhead: "rgba(255, 255, 255, 0.35)",
} as const;
