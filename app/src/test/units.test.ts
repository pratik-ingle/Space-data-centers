/**
 * Unit-level parity with the Python reference (fixtures from
 * scripts/gen_fixtures.py). Functions that don't involve the Earth radius
 * must match to ~1e-11 relative; orbit geometry (period, eclipse fraction)
 * is allowed the documented mean-vs-equatorial radius difference (<0.3%).
 */
import { describe, it } from "vitest";
import {
  betaDeg,
  eclipseFraction,
  orbitPeriodS,
  solarActivity,
  worstEclipseFraction,
} from "../core/environment";
import {
  etaCell,
  gpuPowerW,
  otherPowerW,
  qAbsWM2,
} from "../core/design";
import { arrhenius } from "../core/mission";
import {
  checkpointOverhead,
  doseRateKradPerYr,
  speRatePerYr,
  uncErrorRatePerGpuDay,
} from "../core/radiation";
import { SECONDS_PER_YEAR } from "../core/constants";
import { baselineDd, issLike } from "../core/params";
import type { OrbitProfileT } from "../core/params";
import { expectClose, loadFixture } from "./helpers";

interface Units {
  orbit_period_s: { alt_km: number; value: number }[];
  eclipse_fraction: { alt_km: number; beta_deg: number; value: number }[];
  beta_dd_sso: { t_yr: number; value: number }[];
  beta_mid_incl: { t_yr: number; value: number }[];
  solar_activity: { t_yr: number; phase0: number; value: number }[];
  worst_fe: { case: string; value: number }[];
  dose_rate: {
    shield_mm_eff: number;
    alt_km: number;
    profile: string;
    s_act: number;
    value: number;
  }[];
  spe_rate: { s_act: number; value: number }[];
  unc_error_rate: { shield_mm_eff: number; mult: number; value: number }[];
  checkpoint_overhead: {
    delta_s: number;
    restart_s: number;
    mtbf_s: number;
    value: number;
  }[];
  gpu_power_w: { f: number; tj_c: number; leak_mult: number; value: number }[];
  other_power_w: { f: number; value: number }[];
  q_abs_w_m2: {
    alpha: number;
    illuminated: boolean;
    value: number;
    case?: string;
  }[];
  eta_cell: { t_c: number; value: number }[];
  arrhenius: { tj_c: number; value: number }[];
}

const U = loadFixture<Units>("units");
const cfg = baselineDd();
const iss = issLike(1.0);

describe("unit parity with sdcsim", () => {
  it("orbit period (equatorial-radius note: <0.3% vs reference)", () => {
    for (const c of U.orbit_period_s) {
      expectClose(orbitPeriodS(c.alt_km), c.value, 3e-3, 0, `alt=${c.alt_km}`);
    }
  });

  it("eclipse fraction (<0.002 abs vs reference)", () => {
    for (const c of U.eclipse_fraction) {
      expectClose(
        eclipseFraction(c.alt_km, c.beta_deg),
        c.value,
        0,
        2e-3,
        `h=${c.alt_km} beta=${c.beta_deg}`,
      );
    }
  });

  it("beta profiles (exact)", () => {
    for (const c of U.beta_dd_sso) {
      expectClose(
        betaDeg(c.t_yr * SECONDS_PER_YEAR, cfg.orbit),
        c.value,
        1e-12,
        1e-12,
        `dd t=${c.t_yr}`,
      );
    }
    for (const c of U.beta_mid_incl) {
      expectClose(
        betaDeg(c.t_yr * SECONDS_PER_YEAR, iss.orbit),
        c.value,
        1e-12,
        1e-12,
        `mi t=${c.t_yr}`,
      );
    }
  });

  it("solar activity (exact)", () => {
    for (const c of U.solar_activity) {
      expectClose(
        solarActivity(c.t_yr * SECONDS_PER_YEAR, c.phase0),
        c.value,
        1e-12,
        1e-12,
      );
    }
  });

  it("worst eclipse fraction (<0.002 abs)", () => {
    const byCase: Record<string, number> = {
      dd_sso_550: worstEclipseFraction(cfg.orbit),
      mid_incl_420: worstEclipseFraction(iss.orbit),
    };
    for (const c of U.worst_fe) {
      expectClose(byCase[c.case], c.value, 0, 2e-3, c.case);
    }
  });

  it("dose rate (exact)", () => {
    for (const c of U.dose_rate) {
      expectClose(
        doseRateKradPerYr(
          c.shield_mm_eff,
          c.alt_km,
          c.profile as OrbitProfileT,
          c.s_act,
        ),
        c.value,
        1e-11,
        0,
        `d=${c.shield_mm_eff} h=${c.alt_km} ${c.profile} s=${c.s_act}`,
      );
    }
  });

  it("SPE rate / uncorrectable error rate (exact)", () => {
    for (const c of U.spe_rate) {
      expectClose(speRatePerYr(c.s_act), c.value, 1e-12, 0);
    }
    for (const c of U.unc_error_rate) {
      expectClose(
        uncErrorRatePerGpuDay(cfg.rad, c.shield_mm_eff, c.mult),
        c.value,
        1e-11,
        0,
      );
    }
  });

  it("Daly checkpoint overhead (exact)", () => {
    for (const c of U.checkpoint_overhead) {
      expectClose(
        checkpointOverhead(c.delta_s, c.restart_s, c.mtbf_s),
        c.value,
        1e-12,
        0,
      );
    }
  });

  it("chip power model (exact)", () => {
    for (const c of U.gpu_power_w) {
      expectClose(
        gpuPowerW(cfg.chip, c.f, c.tj_c, c.leak_mult),
        c.value,
        1e-11,
        0,
        `f=${c.f} tj=${c.tj_c}`,
      );
    }
    for (const c of U.other_power_w) {
      expectClose(otherPowerW(cfg.chip, c.f), c.value, 1e-12, 0);
    }
  });

  it("radiator environmental flux + cell efficiency (exact)", () => {
    for (const c of U.q_abs_w_m2) {
      const th = c.case === "iss_vf" ? iss.thermal : cfg.thermal;
      expectClose(qAbsWM2(th, c.alpha, c.illuminated), c.value, 1e-12, 0);
    }
    for (const c of U.eta_cell) {
      expectClose(etaCell(cfg.eps, c.t_c), c.value, 1e-12, 0);
    }
  });

  it("Arrhenius factor (exact)", () => {
    for (const c of U.arrhenius) {
      expectClose(arrhenius(cfg.rel, c.tj_c), c.value, 1e-11, 0);
    }
  });
});
