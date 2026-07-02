/**
 * CLI-style baseline run (M1 deliverable): runs the reference 550 km
 * dawn-dusk SSO mission and dumps a summary + full epoch history JSON.
 *
 *   npm run baseline            (from app/)
 */
import { writeFileSync } from "node:fs";
import { runMission, summarize } from "../src/core/mission";
import { designWarnings } from "../src/core/design";
import { baselineDd } from "../src/core/params";

const cfg = baselineDd();
const t0 = performance.now();
const res = runMission(cfg);
const dtMs = performance.now() - t0;

console.log(summarize(res));
console.log(`\n(${res.hist.length} epochs in ${dtMs.toFixed(0)} ms)`);
const warnings = designWarnings(cfg, res.design);
if (warnings.length) {
  console.log("design warnings:");
  for (const w of warnings) console.log(`  [${w.severity}] ${w.message}`);
}

const out = {
  config: cfg,
  design: res.design,
  summary: res.summary,
  events: res.events,
  hist: res.hist,
};
writeFileSync("baseline_mission.json", JSON.stringify(out, null, 1));
console.log("\nwrote baseline_mission.json");
