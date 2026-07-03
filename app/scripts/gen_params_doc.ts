/**
 * Generates PARAMS.md (repo root) from the single zod parameter schema +
 * PARAM_META — the same objects the UI builds its controls from — so the
 * documented defaults/ranges/units can never drift from the code.
 * Run: npm run docs:params
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { baselineDd, getParam, PARAM_META } from "../src/core/params";
import type { ParamGroup, ParamMeta } from "../src/core/params";

const GROUPS: ParamGroup[] = [
  "Orbit",
  "Compute",
  "Thermal",
  "Power",
  "Radiation",
  "Reliability",
  "Mission",
];

const cfg = baselineDd();

function fmt(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(2).replace("e+", "e");
  return String(Number(v.toPrecision(6)));
}

function row(m: ParamMeta): string {
  const def = fmt(getParam(cfg, m.path));
  const range = `${fmt(m.min)} … ${fmt(m.max)}${m.log ? " (log)" : ""}`;
  const flags = [
    m.advanced ? "advanced" : "",
    m.int ? "int" : "",
    m.profiles ? `profile: ${m.profiles.join("/")}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return `| \`${m.path}\` | ${m.label} | ${def} | ${range} | ${m.unit ?? "–"} | ${flags || "–"} | ${m.tooltip} |`;
}

const lines: string[] = [
  "# Parameter reference",
  "",
  "**Auto-generated from `app/src/core/params.ts` (`npm run docs:params`) — do not edit by hand.**",
  "The UI builds its controls from the same schema, so this table is exact.",
  "All defaults are the 550 km dawn-dusk SSO baseline; every default is an",
  "order-of-magnitude engineering estimate calibrated to public sources — see",
  "MODEL.md for what real data each subsystem needs to become mission-grade.",
  "",
];

for (const g of GROUPS) {
  const rows = PARAM_META.filter((m) => m.group === g);
  lines.push(`## ${g}`, "");
  lines.push(
    "| path | label | default | range | unit | flags | physical meaning |",
    "|---|---|---|---|---|---|---|",
  );
  for (const m of rows) lines.push(row(m));
  lines.push("");
}

// Schema fields without sliders (enums/modes) — enumerate so nothing hides.
const metaPaths = new Set(PARAM_META.map((m) => m.path));
const extra: string[] = [];
for (const [group, obj] of Object.entries(cfg)) {
  if (typeof obj !== "object" || obj === null) continue;
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const path = `${group}.${key}`;
    if (!metaPaths.has(path)) {
      extra.push(`| \`${path}\` | ${JSON.stringify(val)} |`);
    }
  }
}
lines.push(
  "## Fields without sliders (modes, RNG, run controls)",
  "",
  "| path | default |",
  "|---|---|",
  ...extra,
  "",
);

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "PARAMS.md");
writeFileSync(out, lines.join("\n"));
console.log(`wrote ${out} (${PARAM_META.length} sliders, ${extra.length} extra fields)`);
