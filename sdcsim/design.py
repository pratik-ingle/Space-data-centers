"""Design-point sizing and mass budget.

Given a Config, size the radiator (from Tj setpoint via the thermal stack-up),
solar array (EOL, with battery-recharge factor), battery (worst eclipse), and
produce the launch-mass budget. All sizing rules are simple and explicit so
sweeps over setpoints propagate consistently into mass.
"""
import math
from dataclasses import dataclass, field
from .constants import SIGMA, S_SOLAR, ALBEDO, Q_EARTH_IR, C_TO_K
from .environment import orbit_period_s, worst_eclipse_fraction


def gpu_power_w(chip, f: float, tj_c: float, leak_mult: float = 1.0) -> float:
    v = chip.v_floor + (1.0 - chip.v_floor) * f
    p_dyn = chip.p_dyn0_w * f * v * v
    p_leak = (chip.p_leak0_w * v * leak_mult
              * 2.0 ** ((tj_c - chip.t_leak_ref_c) / chip.leak_doubling_c))
    return p_dyn + p_leak


def other_power_w(chip, f: float) -> float:
    p0 = chip.other_frac * chip.tdp_w
    return p0 * (chip.other_idle_frac + (1.0 - chip.other_idle_frac) * f)


def it_power_w(chip, f: float, tj_c: float, leak_mult: float, n_alive: float) -> float:
    return n_alive * (gpu_power_w(chip, f, tj_c, leak_mult) + other_power_w(chip, f))


def q_abs_w_m2(th, alpha: float, illuminated: bool) -> float:
    """Environmental flux absorbed per m^2 of effective radiator area."""
    q = th.rad_eps * th.f_ir * Q_EARTH_IR
    if illuminated:
        q += alpha * th.f_alb * ALBEDO * S_SOLAR
        q += alpha * th.f_sun * S_SOLAR
    return q


def eta_cell(eps_p, t_c: float) -> float:
    return eps_p.eta0 * (1.0 + eps_p.temp_coeff_rel_per_k * (t_c - 28.0))


@dataclass
class Design:
    q_design_w: float = 0.0
    load_design_w: float = 0.0       # electrical bus load at full power
    a_rad_eff: float = 0.0           # effective radiating area, m^2
    a_rad_phys: float = 0.0
    ua_w_k: float = 0.0
    t_rad_design_k: float = 0.0
    arr_area_m2: float = 0.0
    arr_p_bol_w: float = 0.0
    batt_cap_wh: float = 0.0
    idle_w: float = 0.0
    worst_fe: float = 0.0
    period_s: float = 0.0
    masses: dict = field(default_factory=dict)
    mass_total_kg: float = 0.0


def size_design(cfg) -> Design:
    ch, th, ep, rd, ms = cfg.chip, cfg.thermal, cfg.eps, cfg.rad, cfg.mass
    d = Design()
    d.period_s = orbit_period_s(cfg.orbit.alt_km)
    d.worst_fe = worst_eclipse_fraction(cfg.orbit)

    # --- full-power design heat/electric loads at Tj target
    p_gpu = gpu_power_w(ch, 1.0, ch.tj_target_c, 1.0)
    p_it = ch.n_gpu * (p_gpu + other_power_w(ch, 1.0))
    p_pump = th.pump_frac * p_it
    d.load_design_w = p_it + p_pump + ep.aux_w
    d.q_design_w = p_it + p_pump + 0.6 * ep.aux_w      # heat into coolant loop
    d.idle_w = ch.idle_frac_of_design * p_it + p_pump * 0.3 + ep.aux_w

    # --- radiator sized from the thermal stack-up at Tj target
    t_rad_c = ch.tj_target_c - ch.r_j_cw * p_gpu - th.dt_loop_design_k
    d.t_rad_design_k = t_rad_c + C_TO_K
    alpha_mid = th.rad_alpha_bol + 0.6 * th.rad_alpha_drift
    net_w_m2 = (th.rad_eps * SIGMA * d.t_rad_design_k ** 4
                - q_abs_w_m2(th, alpha_mid, True))
    if net_w_m2 <= 30.0:
        net_w_m2 = 30.0
    d.a_rad_eff = th.area_margin * d.q_design_w / net_w_m2 * th.rad_area_scale
    d.a_rad_phys = d.a_rad_eff / th.rad_sides_eff
    d.ua_w_k = d.q_design_w / th.dt_loop_design_k

    # --- battery sized for worst eclipse at batt_sizing_frac of bus load;
    #     both energy (DoD) and power (max C-rate) must be met
    e_ecl_wh = (d.load_design_w * ep.batt_sizing_frac
                * d.worst_fe * d.period_s / 3600.0)
    cap_energy = e_ecl_wh / max(ep.batt_dod * ep.batt_eta_dis, 1e-6)
    cap_power = (d.load_design_w * ep.batt_sizing_frac / ep.batt_c_dis
                 if d.worst_fe > 0.0 else 0.0)
    d.batt_cap_wh = max(cap_energy, cap_power)

    # --- solar array sized EOL incl. eclipse-recharge factor
    fe = d.worst_fe
    p_recharge = 0.0
    if fe > 0.0:
        p_recharge = (d.load_design_w * ep.batt_sizing_frac * fe
                      / ((1.0 - fe) * ep.batt_eta_chg * ep.batt_eta_dis))
    p_needed = (d.load_design_w + p_recharge) / ep.pmad_eff
    eta_eol = (eta_cell(ep, ep.t_cell_sun_c)
               * math.exp(-ep.arr_degr_per_yr * cfg.mission.years))
    d.arr_area_m2 = ep.arr_margin * p_needed / (S_SOLAR * eta_eol * ep.cos_pointing)
    d.arr_p_bol_w = (d.arr_area_m2 * S_SOLAR * eta_cell(ep, ep.t_cell_sun_c)
                     * ep.cos_pointing)

    # --- mass budget
    m = {}
    m["IT hardware"] = ms.it_kg_per_gpu * ch.n_gpu
    m["radiator+loop"] = th.rad_kg_m2 * d.a_rad_phys
    m["solar array"] = (d.arr_p_bol_w / 1000.0) / ep.arr_kw_per_kg
    m["battery"] = d.batt_cap_wh / ep.batt_wh_per_kg
    box_m2 = rd.box_m2_per_kw_it * (p_it / 1000.0)
    m["shielding"] = 2700.0 * (rd.shield_mm / 1000.0) * box_m2
    subtotal = sum(m.values())
    m["structure+mech"] = ms.struct_frac * subtotal
    m["bus (ADCS/comms/prop)"] = ms.fixed_bus_kg + ms.fixed_frac * (subtotal + ms.struct_frac * subtotal)
    d.masses = m
    d.mass_total_kg = sum(m.values())
    return d
