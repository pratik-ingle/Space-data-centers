/**
 * Design-point sizing and mass budget (port of sdcsim/design.py).
 *
 * Given a Config, size the radiator (from the Tj setpoint via the thermal
 * stack-up), solar array (EOL, with battery-recharge factor), battery (worst
 * eclipse, energy AND C-rate constraints), and produce the launch-mass
 * budget. All sizing rules are simple and explicit so sweeps over setpoints
 * propagate consistently into mass — this is what closes the design loop and
 * makes PFLOP-yr/tonne respond live to every slider.
 */
import {
  AL_DENSITY_KG_M3,
  ALBEDO,
  AUX_HEAT_FRAC,
  CELL_T_REF_C,
  C_TO_K,
  IDLE_PUMP_FRAC,
  NET_REJECTION_FLOOR_W_M2,
  Q_EARTH_IR,
  SIGMA,
  SIZING_ALPHA_DRIFT_FRAC,
  S_SOLAR,
} from "./constants";
import { orbitPeriodS, worstEclipseFraction } from "./environment";
import type { ChipP, Config, EpsP, ThermalP } from "./params";

/**
 * Per-GPU electrical power [W]:
 *   P = P_dyn0 * f * V(f)^2  +  P_leak0 * V * leak_mult * 2^((Tj-60)/25)
 * with the DVFS voltage law V(f) = v_floor + (1 - v_floor) * f.
 * Dynamic term: classic alpha*C*V^2*f scaling. Leakage: subthreshold
 * exponential-in-T (doubles per leak_doubling_c), grows with TID.
 */
export function gpuPowerW(
  chip: ChipP,
  f: number,
  tjC: number,
  leakMult = 1,
): number {
  const v = chip.v_floor + (1 - chip.v_floor) * f;
  const pDyn = chip.p_dyn0_w * f * v * v;
  const pLeak =
    chip.p_leak0_w *
    v *
    leakMult *
    2 ** ((tjC - chip.t_leak_ref_c) / chip.leak_doubling_c);
  return pDyn + pLeak;
}

/** Non-GPU IT power (CPU/NIC/memory host) [W]: partly load-independent. */
export function otherPowerW(chip: ChipP, f: number): number {
  const p0 = chip.other_frac * chip.tdp_w;
  return p0 * (chip.other_idle_frac + (1 - chip.other_idle_frac) * f);
}

/** Total IT power for n_alive nodes at clock f [W]. */
export function itPowerW(
  chip: ChipP,
  f: number,
  tjC: number,
  leakMult: number,
  nAlive: number,
): number {
  return nAlive * (gpuPowerW(chip, f, tjC, leakMult) + otherPowerW(chip, f));
}

/**
 * Environmental flux absorbed per m^2 of effective radiator area [W/m^2]:
 *   q = eps*F_ir*q_EarthIR + alpha*(F_alb*a*S + F_sun*S) when illuminated.
 * View factors are static presets per orbit/attitude class (see MODEL.md).
 */
export function qAbsWM2(th: ThermalP, alpha: number, illuminated: boolean): number {
  let q = th.rad_eps * th.f_ir * Q_EARTH_IR;
  if (illuminated) {
    q += alpha * th.f_alb * ALBEDO * S_SOLAR;
    q += alpha * th.f_sun * S_SOLAR;
  }
  return q;
}

/** Solar-cell efficiency at temperature tC [-]: linear derating from 28 degC. */
export function etaCell(eps: EpsP, tC: number): number {
  return eps.eta0 * (1 + eps.temp_coeff_rel_per_k * (tC - CELL_T_REF_C));
}

/** Mass-budget line items [kg], keys identical to the Python reference. */
export type MassBudget = Record<string, number>;

export interface Design {
  /** Heat into the coolant loop at the design point [W]. */
  q_design_w: number;
  /** Electrical bus load at full power [W]. */
  load_design_w: number;
  /** Effective radiating area (both sides weighted) [m^2]. */
  a_rad_eff: number;
  /** Physical radiator panel area [m^2]. */
  a_rad_phys: number;
  /** Coolant->radiator loop conductance [W/K]. */
  ua_w_k: number;
  /** Radiator temperature at the design point [K]. */
  t_rad_design_k: number;
  /** Solar array area [m^2]. */
  arr_area_m2: number;
  /** Array power at beginning of life [W]. */
  arr_p_bol_w: number;
  /** Battery nameplate capacity [Wh]. */
  batt_cap_wh: number;
  /** Idle/safe-mode bus load [W]. */
  idle_w: number;
  /** Worst eclipse fraction over the year [-]. */
  worst_fe: number;
  /** Orbit period [s]. */
  period_s: number;
  masses: MassBudget;
  mass_total_kg: number;
}

export interface DesignWarning {
  severity: "info" | "warn" | "crit";
  message: string;
}

/** Size every subsystem from the setpoints; see module doc. */
export function sizeDesign(cfg: Config): Design {
  const ch = cfg.chip;
  const th = cfg.thermal;
  const ep = cfg.eps;
  const rd = cfg.rad;
  const ms = cfg.mass;

  const period_s = orbitPeriodS(cfg.orbit.alt_km);
  const worst_fe = worstEclipseFraction(cfg.orbit);

  // --- full-power design heat/electric loads at the Tj target
  const pGpu = gpuPowerW(ch, 1, ch.tj_target_c, 1);
  const pIt = ch.n_gpu * (pGpu + otherPowerW(ch, 1));
  const pPump = th.pump_frac * pIt;
  const load_design_w = pIt + pPump + ep.aux_w;
  const q_design_w = pIt + pPump + AUX_HEAT_FRAC * ep.aux_w; // heat into loop
  const idle_w = ch.idle_frac_of_design * pIt + pPump * IDLE_PUMP_FRAC + ep.aux_w;

  // --- radiator sized from the thermal stack-up at the Tj target:
  //     T_rad = Tj - Rth,jc*P_gpu - dT_loop, reject eps*sigma*T^4 net of
  //     mid-life environmental absorption, with margin.
  const tRadC = ch.tj_target_c - ch.r_j_cw * pGpu - th.dt_loop_design_k;
  const t_rad_design_k = tRadC + C_TO_K;
  const alphaMid = th.rad_alpha_bol + SIZING_ALPHA_DRIFT_FRAC * th.rad_alpha_drift;
  let netWm2 =
    th.rad_eps * SIGMA * t_rad_design_k ** 4 - qAbsWM2(th, alphaMid, true);
  if (netWm2 <= NET_REJECTION_FLOOR_W_M2) netWm2 = NET_REJECTION_FLOOR_W_M2;
  const a_rad_eff = (th.area_margin * q_design_w * th.rad_area_scale) / netWm2;
  const a_rad_phys = a_rad_eff / th.rad_sides_eff;
  const ua_w_k = q_design_w / th.dt_loop_design_k;

  // --- battery sized for the worst eclipse at batt_sizing_frac of bus load;
  //     BOTH the energy constraint (DoD) and the power constraint (max
  //     C-rate) must be met — energy-only sizing silently throttles every
  //     eclipse (simulator.md calls this trap out explicitly).
  const eEclWh = (load_design_w * ep.batt_sizing_frac * worst_fe * period_s) / 3600;
  const capEnergy = eEclWh / Math.max(ep.batt_dod * ep.batt_eta_dis, 1e-6);
  const capPower =
    worst_fe > 0 ? (load_design_w * ep.batt_sizing_frac) / ep.batt_c_dis : 0;
  const batt_cap_wh = Math.max(capEnergy, capPower);

  // --- solar array sized at EOL including the eclipse-recharge factor
  const fe = worst_fe;
  let pRecharge = 0;
  if (fe > 0) {
    pRecharge =
      (load_design_w * ep.batt_sizing_frac * fe) /
      ((1 - fe) * ep.batt_eta_chg * ep.batt_eta_dis);
  }
  const pNeeded = (load_design_w + pRecharge) / ep.pmad_eff;
  const etaEol =
    etaCell(ep, ep.t_cell_sun_c) * Math.exp(-ep.arr_degr_per_yr * cfg.mission.years);
  const arr_area_m2 =
    (ep.arr_margin * pNeeded) / (S_SOLAR * etaEol * ep.cos_pointing);
  const arr_p_bol_w =
    arr_area_m2 * S_SOLAR * etaCell(ep, ep.t_cell_sun_c) * ep.cos_pointing;

  // --- mass budget (keys match the Python reference exactly)
  const m: MassBudget = {};
  m["IT hardware"] = ms.it_kg_per_gpu * ch.n_gpu;
  m["radiator+loop"] = th.rad_kg_m2 * a_rad_phys;
  m["solar array"] = arr_p_bol_w / 1000 / ep.arr_kw_per_kg;
  m["battery"] = batt_cap_wh / ep.batt_wh_per_kg;
  const boxM2 = rd.box_m2_per_kw_it * (pIt / 1000);
  m["shielding"] = AL_DENSITY_KG_M3 * (rd.shield_mm / 1000) * boxM2;
  const subtotal = Object.values(m).reduce((s, v) => s + v, 0);
  m["structure+mech"] = ms.struct_frac * subtotal;
  m["bus (ADCS/comms/prop)"] =
    ms.fixed_bus_kg + ms.fixed_frac * (subtotal + ms.struct_frac * subtotal);
  const mass_total_kg = Object.values(m).reduce((s, v) => s + v, 0);

  return {
    q_design_w,
    load_design_w,
    a_rad_eff,
    a_rad_phys,
    ua_w_k,
    t_rad_design_k,
    arr_area_m2,
    arr_p_bol_w,
    batt_cap_wh,
    idle_w,
    worst_fe,
    period_s,
    masses: m,
    mass_total_kg,
  };
}

/**
 * Surface unphysical or trap parameter combinations instead of silently
 * clamping them (simulator.md "what NOT to do").
 */
export function designWarnings(cfg: Config, d: Design): DesignWarning[] {
  const w: DesignWarning[] = [];
  const th = cfg.thermal;
  const ch = cfg.chip;
  const ep = cfg.eps;

  const alphaMid = th.rad_alpha_bol + SIZING_ALPHA_DRIFT_FRAC * th.rad_alpha_drift;
  const netWm2 =
    th.rad_eps * SIGMA * d.t_rad_design_k ** 4 - qAbsWM2(th, alphaMid, true);
  if (netWm2 <= NET_REJECTION_FLOOR_W_M2) {
    w.push({
      severity: "crit",
      message:
        `Radiator cannot reach equilibrium at this Tj setpoint/coating ` +
        `(net rejection ${netWm2.toFixed(0)} W/m2 <= ${NET_REJECTION_FLOOR_W_M2} floor); ` +
        `sized area is floored and the loop will throttle hard.`,
    });
  }
  if (ch.tj_target_c >= ch.tj_max_c) {
    w.push({
      severity: "crit",
      message: `Tj setpoint (${ch.tj_target_c} degC) is at/above the hard limit (${ch.tj_max_c} degC): the emergency cut fights the controller.`,
    });
  }
  if (d.worst_fe > 0 && ep.batt_sizing_frac < 0.999) {
    w.push({
      severity: "warn",
      message:
        `Battery carries only ${(ep.batt_sizing_frac * 100).toFixed(0)}% of the bus load in eclipse: ` +
        `nodes will idle in shadow and thermal-cycle (Coffin-Manson fatigue).`,
    });
  }
  if (d.worst_fe > 0) {
    const capEnergy =
      (d.load_design_w * ep.batt_sizing_frac * d.worst_fe * d.period_s) /
      3600 /
      Math.max(ep.batt_dod * ep.batt_eta_dis, 1e-6);
    if (d.batt_cap_wh > capEnergy * 1.001) {
      w.push({
        severity: "info",
        message:
          "Battery is C-rate (power) sized, not energy sized: discharge-rate cap is the binding constraint.",
      });
    }
    if (d.idle_w > d.batt_cap_wh * ep.batt_c_dis && ep.batt_sizing_frac < 0.2) {
      w.push({
        severity: "warn",
        message:
          "Even the idle load exceeds the battery's discharge capability: expect deep cold-soak every eclipse.",
      });
    }
  }
  const doseYr = cfg.rad.shield_mm + cfg.rad.shield_intrinsic_mm;
  if (doseYr < 1 && cfg.orbit.alt_km > 700) {
    w.push({
      severity: "warn",
      message:
        "Under 1 mm effective shielding above 700 km: TID mortality will dominate attrition.",
    });
  }
  if (ch.f_min > 0.9) {
    w.push({
      severity: "warn",
      message:
        "f_min near 1 leaves DVFS no authority: the only response to deficits is idle/safe mode.",
    });
  }
  return w;
}
