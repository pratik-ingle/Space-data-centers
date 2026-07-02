"""Mission simulator: multi-rate epoch loop.

Fast loop (orbitloop) resolves one steady-periodic orbit per ~2-week epoch;
slow states (TID, coating alpha, array degradation, battery fade, node
attrition) update per epoch. Deterministic mode propagates expected values;
stochastic mode (Monte Carlo) samples Poisson/binomial events.
"""
import math
import numpy as np
from dataclasses import dataclass, field
from .constants import SECONDS_PER_YEAR, SECONDS_PER_DAY, S_SOLAR, K_B_EV, C_TO_K
from .environment import beta_deg, eclipse_fraction, solar_activity
from .design import size_design, eta_cell
from .radiation import (dose_rate_krad_per_yr, spe_rate_per_yr,
                        unc_error_rate_per_gpu_day, checkpoint_overhead)
from .orbitloop import ThermalState, simulate_orbit


@dataclass
class MissionResult:
    cfg: object = None
    design: object = None
    hist: dict = field(default_factory=dict)
    delivered_pflop_yr: float = 0.0
    nameplate_pflop_yr: float = 0.0
    losses: dict = field(default_factory=dict)

    @property
    def per_tonne(self):
        return self.delivered_pflop_yr / (self.design.mass_total_kg / 1000.0)

    @property
    def utilization(self):
        return self.delivered_pflop_yr / self.nameplate_pflop_yr


def _arrhenius(rel, tj_c):
    t = tj_c + C_TO_K
    tr = rel.tj_ref_c + C_TO_K
    return math.exp(rel.ea_ev / K_B_EV * (1.0 / tr - 1.0 / t))


def run_mission(cfg, rng=None, stochastic=False) -> MissionResult:
    ch, th, ep, rd, rel, mi = (cfg.chip, cfg.thermal, cfg.eps,
                               cfg.rad, cfg.rel, cfg.mission)
    dz = size_design(cfg)
    st = ThermalState(cfg, dz)
    if stochastic and rng is None:
        rng = np.random.default_rng()

    n_ep = int(round(mi.years * mi.epochs_per_year))
    dt_yr = 1.0 / mi.epochs_per_year
    dt_s = dt_yr * SECONDS_PER_YEAR

    tid_krad = 0.0
    n_alive = float(ch.n_gpu)
    shield_eff = rd.shield_mm + rd.shield_intrinsic_mm

    keys = ["t_yr", "beta", "fe", "s_act", "f_mean", "tj_mean", "tj_max",
            "dtj_cycle", "t_rad_c", "n_alive", "tid_krad", "leak_mult",
            "alpha", "arr_factor", "p_arr_kw", "load_kw", "ovh", "eff_pflops",
            "dod", "frac_power_limited", "frac_thermal_limited", "frac_idle"]
    H = {k: np.zeros(n_ep) for k in keys}

    # loss-accounting integrals (PFLOP-yr)
    i_full = i_thr = i_att = i_ovh = 0.0
    delivered = 0.0

    for e in range(n_ep):
        t_mid = (e + 0.5) * dt_s
        t_yr = t_mid / SECONDS_PER_YEAR
        beta = beta_deg(t_mid, cfg.orbit)
        fe = eclipse_fraction(cfg.orbit.alt_km, beta)
        s_act = solar_activity(t_mid, mi.solar_phase0)

        # --- slow degradation states
        alpha = th.rad_alpha_bol + th.rad_alpha_drift * (1.0 - math.exp(-t_yr / th.rad_alpha_tau_yr))
        arr_factor = math.exp(-ep.arr_degr_per_yr * t_yr)
        leak_mult = 1.0 + rd.leak_per_krad * tid_krad
        p_arr_w = (S_SOLAR * dz.arr_area_m2 * eta_cell(ep, ep.t_cell_sun_c)
                   * ep.cos_pointing * ep.pmad_eff * arr_factor)

        env = {"fe": fe, "p_arr_w": p_arr_w, "alpha": alpha,
               "leak_mult": leak_mult, "n_alive": n_alive,
               "tj_target_c": ch.tj_target_c}
        m = simulate_orbit(cfg, dz, env, st, n_orbits=(4.0 if e == 0 else 1.5))

        # --- SPE exposure this epoch
        lam_spe = spe_rate_per_yr(s_act)
        if stochastic:
            k_spe = rng.poisson(lam_spe * dt_yr)
        else:
            k_spe = lam_spe * dt_yr
        spe_frac = min(1.0, k_spe * rd.spe_dur_days * SECONDS_PER_DAY / dt_s)

        # --- TID accumulation (incl. SPE dose pulses)
        rate = dose_rate_krad_per_yr(shield_eff, cfg.orbit.alt_km,
                                     cfg.orbit.profile, s_act, rd.dose_scale)
        tid_new = tid_krad + rate * dt_yr
        tid_new += k_spe * rd.spe_dose_krad_1mm * math.exp(-(shield_eff - 1.0) / 1.2) * rd.dose_scale
        # --- checkpoint overhead (quiet / storm weighted)
        lam_hard_yr = (rel.afr_scale * rel.afr_base_per_yr
                       * ((1 - rel.thermal_frac) + rel.thermal_frac * _arrhenius(rel, m["tj_mean"]))
                       + rel.sel_per_gpu_yr * (0.5 + s_act) + rel.mmod_per_gpu_yr)

        def ovh_at(mult):
            r_unc = unc_error_rate_per_gpu_day(rd, shield_eff, mult) * n_alive / SECONDS_PER_DAY
            r_hard = lam_hard_yr * n_alive / SECONDS_PER_YEAR
            mtbf = 1.0 / max(r_unc + r_hard, 1e-12)
            return checkpoint_overhead(rel.ckpt_write_s, rel.restart_s, mtbf)

        ovh = (1.0 - spe_frac) * ovh_at(1.0) + spe_frac * ovh_at(rd.spe_seu_mult)

        # --- attrition hazards
        lam = lam_hard_yr
        if m["dtj_cycle"] > rel.cyc_dt_min_k:
            nf = rel.cyc_nf_ref * (m["dtj_cycle"] / rel.cyc_dt_ref_k) ** (-rel.cyc_exp)
            lam += (SECONDS_PER_YEAR / dz.period_s) / nf
        surv_rand = math.exp(-lam * dt_yr)
        s_tid_old = math.exp(-(tid_krad / rd.tid_char_krad) ** rd.tid_shape)
        s_tid_new = math.exp(-(tid_new / rd.tid_char_krad) ** rd.tid_shape)
        surv = surv_rand * (s_tid_new / max(s_tid_old, 1e-12))
        if stochastic:
            n_int = int(round(n_alive))
            deaths = rng.binomial(n_int, 1.0 - min(surv, 1.0)) if n_int > 0 else 0
            n_alive = max(0.0, n_alive - deaths)
        else:
            n_alive *= surv
        tid_krad = tid_new

        # --- compute delivered this epoch
        eff_pflops = n_alive * ch.pflops_nominal * m["f_mean"] * (1.0 - ovh)
        delivered += eff_pflops * dt_yr
        i_full += ch.n_gpu * ch.pflops_nominal * dt_yr
        i_thr += ch.n_gpu * ch.pflops_nominal * m["f_mean"] * dt_yr
        i_att += n_alive * ch.pflops_nominal * m["f_mean"] * dt_yr
        i_ovh += eff_pflops * dt_yr

        row = dict(t_yr=t_yr, beta=beta, fe=fe, s_act=s_act,
                   f_mean=m["f_mean"], tj_mean=m["tj_mean"], tj_max=m["tj_max"],
                   dtj_cycle=m["dtj_cycle"], t_rad_c=m["t_rad_mean_c"],
                   n_alive=n_alive, tid_krad=tid_krad, leak_mult=leak_mult,
                   alpha=alpha, arr_factor=arr_factor,
                   p_arr_kw=p_arr_w / 1e3, load_kw=dz.load_design_w / 1e3,
                   ovh=ovh, eff_pflops=eff_pflops, dod=m["dod"],
                   frac_power_limited=m["frac_power_limited"],
                   frac_thermal_limited=m["frac_thermal_limited"],
                   frac_idle=m["frac_idle"])
        for k, v in row.items():
            H[k][e] = v

    res = MissionResult(cfg=cfg, design=dz, hist=H)
    res.delivered_pflop_yr = delivered
    res.nameplate_pflop_yr = ch.n_gpu * ch.pflops_nominal * mi.years
    res.losses = {
        "throttle (thermal+power)": i_full - i_thr,
        "node attrition": i_thr - i_att,
        "checkpoint/restart tax": i_att - i_ovh,
    }
    return res


def summarize(res: MissionResult) -> str:
    d, c = res.design, res.cfg
    lines = [
        f"== {c.name} ==",
        f"nameplate: {res.nameplate_pflop_yr:.1f} PFLOP-yr | delivered: "
        f"{res.delivered_pflop_yr:.1f} PFLOP-yr ({100*res.utilization:.1f}%)",
        f"mass: {d.mass_total_kg:,.0f} kg -> {res.per_tonne:.1f} PFLOP-yr/tonne",
        f"radiator: {d.a_rad_phys:.1f} m2 phys ({d.a_rad_eff:.1f} m2 eff), "
        f"array: {d.arr_area_m2:.1f} m2 / {d.arr_p_bol_w/1e3:.1f} kW BOL, "
        f"battery: {d.batt_cap_wh/1e3:.1f} kWh",
        f"worst eclipse fraction: {d.worst_fe:.3f}",
        "losses (PFLOP-yr): " + ", ".join(f"{k}: {v:.1f}" for k, v in res.losses.items()),
        "mass budget: " + ", ".join(f"{k}: {v:,.0f}" for k, v in d.masses.items()),
    ]
    return "\n".join(lines)
