/**
 * Design-sizing parity with the Python reference. Fields untouched by the
 * Earth-radius choice must match to 1e-9 relative; battery/array masses and
 * anything downstream of worst_fe/period get 0.5% (documented divergence).
 */
import { describe, it } from "vitest";
import { sizeDesign } from "../core/design";
import { expectClose, FIXTURE_CONFIGS, loadFixture } from "./helpers";

interface SizingFix {
  q_design_w: number;
  load_design_w: number;
  a_rad_eff: number;
  a_rad_phys: number;
  ua_w_k: number;
  t_rad_design_k: number;
  arr_area_m2: number;
  arr_p_bol_w: number;
  batt_cap_wh: number;
  idle_w: number;
  worst_fe: number;
  period_s: number;
  masses: Record<string, number>;
  mass_total_kg: number;
}

const S = loadFixture<Record<string, SizingFix>>("sizing");

// Independent of the Earth radius -> exact parity expected.
const EXACT_FIELDS = [
  "q_design_w",
  "load_design_w",
  "a_rad_eff",
  "a_rad_phys",
  "ua_w_k",
  "t_rad_design_k",
  "idle_w",
] as const;
const EXACT_MASSES = ["IT hardware", "radiator+loop", "shielding"];

describe("design sizing parity", () => {
  for (const [name, fix] of Object.entries(S)) {
    it(name, () => {
      const cfg = FIXTURE_CONFIGS[name]();
      const d = sizeDesign(cfg);
      for (const f of EXACT_FIELDS) {
        expectClose(d[f], fix[f], 1e-9, 1e-9, `${name}.${f}`);
      }
      for (const m of EXACT_MASSES) {
        expectClose(d.masses[m], fix.masses[m], 1e-9, 1e-9, `${name} mass ${m}`);
      }
      // Radius-sensitive (worst_fe, period enter battery & array sizing):
      expectClose(d.period_s, fix.period_s, 5e-3, 0, `${name}.period_s`);
      expectClose(d.worst_fe, fix.worst_fe, 0, 2e-3, `${name}.worst_fe`);
      for (const f of ["arr_area_m2", "arr_p_bol_w", "batt_cap_wh"] as const) {
        expectClose(d[f], fix[f], 5e-3, 1e-9, `${name}.${f}`);
      }
      for (const [m, v] of Object.entries(fix.masses)) {
        expectClose(d.masses[m], v, 5e-3, 1e-9, `${name} mass ${m}`);
      }
      expectClose(d.mass_total_kg, fix.mass_total_kg, 5e-3, 0, `${name}.total`);
    });
  }
});
