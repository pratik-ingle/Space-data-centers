"""Inner loop: coupled orbit-transient of the thermal <-> chip <-> power system.

Two thermal nodes (coolant loop, radiator) integrated with exponential
(unconditionally stable) updates; junction quasi-static on top; a proportional
DVFS controller holds Tj at the throttle setpoint; a supply-dispatch step caps
frequency when array+battery power is insufficient. This is the tight feedback
loop of the coupling map — everything slower feeds in as boundary conditions.
"""
import math
from .constants import SIGMA, C_TO_K
from .design import gpu_power_w, other_power_w, q_abs_w_m2


class ThermalState:
    __slots__ = ("t_cool_k", "t_rad_k", "f", "soc_wh", "p_gpu_last")

    def __init__(self, cfg, dz):
        self.t_cool_k = 300.0
        self.t_rad_k = 285.0
        self.f = 0.8
        self.soc_wh = dz.batt_cap_wh
        self.p_gpu_last = cfg.chip.tdp_w * 0.8


def _tj_c(chip, t_cool_k, f, leak_mult):
    """Fixed-point junction temp (leakage depends on Tj which depends on power)."""
    tj = t_cool_k - C_TO_K + 40.0
    for _ in range(3):
        pg = gpu_power_w(chip, f, tj, leak_mult)
        tj = (t_cool_k - C_TO_K) + chip.r_j_cw * pg
    return tj, pg


def simulate_orbit(cfg, dz, env, st, n_orbits=1.5, dt=None, trace=None):
    """Advance the thermal/power state through n_orbits; return metrics from the
    final full orbit (steady-periodic approximation with warm start).

    env keys: fe, p_arr_w, alpha, leak_mult, n_alive, tj_target_c
    If `trace` is a dict, per-step series from the last full orbit are appended
    to lists under keys: t_min, tj, t_rad_c, t_cool_c, f, soc_frac, illum.
    """
    ch, th, ep = cfg.chip, cfg.thermal, cfg.eps
    if dt is None:
        dt = cfg.mission.dt_orbit_s
    period = dz.period_s
    fe = env["fe"]
    ecl_a = 0.5 * (1.0 - fe) * period
    ecl_b = ecl_a + fe * period
    n_steps = int(round(n_orbits * period / dt))
    last_orbit_start = (n_orbits - 1.0) * period

    cap = dz.batt_cap_wh
    dis_max_c = ep.batt_c_dis * cap          # W at 1C
    chg_max_c = ep.batt_c_chg * cap
    tj_target = env["tj_target_c"]
    n_alive = env["n_alive"]
    leak_mult = env["leak_mult"]
    c_rad = max(th.rad_kg_m2 * dz.a_rad_phys * th.rad_cp_j_kgk, 1e3)
    a_eff = dz.a_rad_eff
    kp = 0.006 * (dt / 30.0)

    # accumulators over the last full orbit
    s_f = s_tj = s_trad = 0.0
    tj_max = -1e9
    tj_min = 1e9
    soc_min = cap if cap > 0 else 0.0
    n_pow_lim = n_th_lim = n_idle = n_last = 0

    for i in range(n_steps):
        t = i * dt
        tau = t % period
        illum = not (ecl_a <= tau < ecl_b)
        p_arr = env["p_arr_w"] if illum else 0.0

        # --- DVFS thermal controller
        tj_est, pg_est = _tj_c(ch, st.t_cool_k, st.f, leak_mult)
        err = tj_est - tj_target
        f = st.f - kp * err
        f = min(1.0, max(ch.f_min, f))
        f = min(st.f + 0.03, max(st.f - 0.05, f))
        thermal_limited = err > 0.5 and f < 0.999

        # --- supply dispatch (power cap)
        dis_energy_w = st.soc_wh * 3600.0 / dt * 0.98 if cap > 0 else 0.0
        dis_avail = min(dis_max_c, dis_energy_w)
        supply = p_arr + dis_avail

        def load_at(fq):
            tjq, _ = _tj_c(ch, st.t_cool_k, fq, leak_mult)
            p_it = n_alive * (gpu_power_w(ch, fq, tjq, leak_mult) + other_power_w(ch, fq))
            return p_it * (1.0 + th.pump_frac) + ep.aux_w, p_it

        p_load, p_it = load_at(f)
        power_limited = False
        idle = False
        if p_load > supply:
            lo_load, _ = load_at(ch.f_min)
            if lo_load > supply:
                idle = True
                f = ch.f_min          # controller restart point after eclipse
                p_load = dz.idle_w
                p_it = ch.idle_frac_of_design * n_alive / ch.n_gpu * dz.q_design_w * 0.8
                p_it = min(p_it, p_load)
            else:
                power_limited = True
                lo, hi = ch.f_min, f
                for _ in range(22):
                    mid = 0.5 * (lo + hi)
                    pl, _ = load_at(mid)
                    if pl > supply:
                        hi = mid
                    else:
                        lo = mid
                f = lo
                p_load, p_it = load_at(f)

        # --- battery energy balance
        if cap > 0:
            if p_arr >= p_load:
                room_w = (cap - st.soc_wh) * 3600.0 / dt
                chg = min(p_arr - p_load, chg_max_c, room_w)
                st.soc_wh += chg * ep.batt_eta_chg * dt / 3600.0
            else:
                deficit = min(p_load - p_arr, dis_avail)
                st.soc_wh -= deficit / ep.batt_eta_dis * dt / 3600.0
            st.soc_wh = min(max(st.soc_wh, 0.0), cap)

        # --- thermal network update
        q_cool = (p_it * (1.0 + th.pump_frac) + 0.6 * ep.aux_w) if not idle else dz.idle_w * 0.9
        q_abs = q_abs_w_m2(th, env["alpha"], illum) * a_eff

        # coolant node relaxes toward radiator + Q/UA
        t_cool_eq = st.t_rad_k + q_cool / dz.ua_w_k
        tau_c = th.c_cool_j_k / dz.ua_w_k
        st.t_cool_k = t_cool_eq + (st.t_cool_k - t_cool_eq) * math.exp(-dt / tau_c)

        # radiator node: UA in, sigma*T^4 out (linearized), env flux in
        g_rad = 4.0 * th.rad_eps * SIGMA * st.t_rad_k ** 3 * a_eff
        num = (dz.ua_w_k * (st.t_cool_k - st.t_rad_k) + q_abs
               - th.rad_eps * SIGMA * st.t_rad_k ** 4 * a_eff)
        t_rad_eq = st.t_rad_k + num / (dz.ua_w_k + g_rad)
        tau_r = c_rad / (dz.ua_w_k + g_rad)
        st.t_rad_k = t_rad_eq + (st.t_rad_k - t_rad_eq) * math.exp(-dt / tau_r)

        st.f = f
        tj_now, pg_now = _tj_c(ch, st.t_cool_k, f if not idle else ch.f_min, leak_mult)
        st.p_gpu_last = pg_now if not idle else 0.2 * ch.tdp_w

        # hard-limit safeguard
        if tj_now > ch.tj_max_c and not idle:
            st.f = max(ch.f_min, st.f - 0.10)

        if t >= last_orbit_start:
            n_last += 1
            f_eff = 0.0 if idle else f
            if trace is not None:
                trace.setdefault("t_min", []).append((t - last_orbit_start) / 60.0)
                trace.setdefault("tj", []).append(tj_now)
                trace.setdefault("t_rad_c", []).append(st.t_rad_k - C_TO_K)
                trace.setdefault("t_cool_c", []).append(st.t_cool_k - C_TO_K)
                trace.setdefault("f", []).append(f_eff)
                trace.setdefault("soc_frac", []).append(st.soc_wh / cap if cap > 0 else 1.0)
                trace.setdefault("illum", []).append(1.0 if illum else 0.0)
            s_f += f_eff
            s_tj += tj_now
            s_trad += st.t_rad_k
            tj_max = max(tj_max, tj_now)
            tj_min = min(tj_min, tj_now)
            if cap > 0:
                soc_min = min(soc_min, st.soc_wh)
            n_pow_lim += 1 if power_limited else 0
            n_th_lim += 1 if thermal_limited else 0
            n_idle += 1 if idle else 0

    n_last = max(n_last, 1)
    return {
        "f_mean": s_f / n_last,
        "tj_mean": s_tj / n_last,
        "tj_max": tj_max,
        "dtj_cycle": tj_max - tj_min,
        "t_rad_mean_c": s_trad / n_last - C_TO_K,
        "dod": (cap - soc_min) / cap if cap > 0 else 0.0,
        "frac_power_limited": n_pow_lim / n_last,
        "frac_thermal_limited": n_th_lim / n_last,
        "frac_idle": n_idle / n_last,
    }
