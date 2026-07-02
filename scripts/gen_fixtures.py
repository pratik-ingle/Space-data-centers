#!/usr/bin/env python3
"""Generate golden JSON fixtures from the authoritative sdcsim Python package.

The TypeScript port (app/src/core) is validated against these fixtures by
vitest. Unit-level functions must match to ~1e-9 relative; mission-level
summaries to well under the 2% acceptance bound (the only intended numeric
divergence is the Earth radius used for orbit geometry: sdcsim uses the mean
radius 6371 km while the port uses the WGS-84 equatorial radius 6378.137 km to
satisfy the spec's 5,739 s orbital-period acceptance test).

Run from repo root:  python3 scripts/gen_fixtures.py
Writes:              app/src/test/fixtures/*.json
"""
import copy
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sdcsim import baseline_dd, iss_like, size_design, run_mission
from sdcsim.environment import (orbit_period_s, beta_deg, eclipse_fraction,
                                solar_activity, worst_eclipse_fraction)
from sdcsim.radiation import (dose_rate_krad_per_yr, spe_rate_per_yr,
                              unc_error_rate_per_gpu_day, checkpoint_overhead)
from sdcsim.design import gpu_power_w, other_power_w, q_abs_w_m2, eta_cell
from sdcsim.orbitloop import ThermalState, simulate_orbit
from sdcsim.mission import _arrhenius

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "app", "src", "test", "fixtures")
os.makedirs(OUT, exist_ok=True)


def dump(name, obj):
    path = os.path.join(OUT, name + ".json")
    with open(path, "w") as f:
        json.dump(obj, f, indent=1)
    print(f"wrote {path}")


# ---------------------------------------------------------------- unit grids
cfg = baseline_dd()
units = {}

units["orbit_period_s"] = [
    {"alt_km": a, "value": orbit_period_s(a)} for a in [300, 420, 550, 800, 1200]
]
units["eclipse_fraction"] = [
    {"alt_km": h, "beta_deg": b, "value": eclipse_fraction(h, b)}
    for h in [300, 420, 550, 800, 1200]
    for b in [0, 15, 30, 45, 60, 65, 70, 75, 90]
]
units["beta_dd_sso"] = [
    {"t_yr": t, "value": beta_deg(t * 365.25 * 86400.0, cfg.orbit)}
    for t in [0.0, 0.1, 0.25, 0.5, 0.75, 1.0, 2.3]
]
iss = iss_like(1.0)
units["beta_mid_incl"] = [
    {"t_yr": t, "value": beta_deg(t * 365.25 * 86400.0, iss.orbit)}
    for t in [0.0, 0.03, 0.08, 0.1, 0.25, 0.5, 0.77, 1.0, 3.14]
]
units["solar_activity"] = [
    {"t_yr": t, "phase0": p, "value": solar_activity(t * 365.25 * 86400.0, p)}
    for t in [0.0, 1.0, 2.75, 5.5, 8.25, 11.0]
    for p in [0.0, math.pi / 2.0]
]
units["worst_fe"] = [
    {"case": "dd_sso_550", "value": worst_eclipse_fraction(cfg.orbit)},
    {"case": "mid_incl_420", "value": worst_eclipse_fraction(iss.orbit)},
]
units["dose_rate"] = [
    {"shield_mm_eff": s, "alt_km": h, "profile": pr, "s_act": sa,
     "value": dose_rate_krad_per_yr(s, h, pr, sa)}
    for s in [0.2, 0.5, 1.0, 1.8, 3.8, 6.0, 10.0]
    for h in [420, 550, 800]
    for pr in ["dd_sso", "mid_incl"]
    for sa in [0.0, 0.5, 1.0]
]
units["spe_rate"] = [{"s_act": s, "value": spe_rate_per_yr(s)}
                     for s in [0.0, 0.25, 0.5, 0.75, 1.0]]
units["unc_error_rate"] = [
    {"shield_mm_eff": s, "mult": m,
     "value": unc_error_rate_per_gpu_day(cfg.rad, s, m)}
    for s in [0.5, 1.0, 2.0, 3.8, 8.0] for m in [1.0, 30.0]
]
units["checkpoint_overhead"] = [
    {"delta_s": d, "restart_s": r, "mtbf_s": m,
     "value": checkpoint_overhead(d, r, m)}
    for (d, r, m) in [(45, 300, 3600), (45, 300, 86400), (45, 300, 1e6),
                      (45, 300, 1e8), (45, 300, 100.0), (10, 60, 5e5),
                      (120, 900, 2e6)]
]
units["gpu_power_w"] = [
    {"f": f, "tj_c": tj, "leak_mult": lm,
     "value": gpu_power_w(cfg.chip, f, tj, lm)}
    for f in [0.4, 0.6, 0.8, 1.0]
    for tj in [35, 60, 85, 92]
    for lm in [1.0, 1.3]
]
units["other_power_w"] = [{"f": f, "value": other_power_w(cfg.chip, f)}
                          for f in [0.4, 0.7, 1.0]]
units["q_abs_w_m2"] = [
    {"alpha": a, "illuminated": il,
     "value": q_abs_w_m2(cfg.thermal, a, il)}
    for a in [0.09, 0.15, 0.19] for il in [True, False]
] + [
    {"alpha": a, "illuminated": True, "case": "iss_vf",
     "value": q_abs_w_m2(iss.thermal, a, True)}
    for a in [0.09, 0.19]
]
units["eta_cell"] = [{"t_c": t, "value": eta_cell(cfg.eps, t)}
                     for t in [-20, 28, 65, 100]]
units["arrhenius"] = [{"tj_c": t, "value": _arrhenius(cfg.rel, t)}
                      for t in [50, 60, 70, 80, 90, 95]]
dump("units", units)


# ------------------------------------------------------------------- sizing
def design_dict(c):
    d = size_design(c)
    return {
        "q_design_w": d.q_design_w, "load_design_w": d.load_design_w,
        "a_rad_eff": d.a_rad_eff, "a_rad_phys": d.a_rad_phys,
        "ua_w_k": d.ua_w_k, "t_rad_design_k": d.t_rad_design_k,
        "arr_area_m2": d.arr_area_m2, "arr_p_bol_w": d.arr_p_bol_w,
        "batt_cap_wh": d.batt_cap_wh, "idle_w": d.idle_w,
        "worst_fe": d.worst_fe, "period_s": d.period_s,
        "masses": d.masses, "mass_total_kg": d.mass_total_kg,
    }


def variant(mutator, name):
    c = baseline_dd()
    mutator(c)
    c.name = name
    return c


def v_rad07(c): c.thermal.rad_area_scale = 0.7
def v_tj65(c): c.chip.tj_target_c = 65.0; c.chip.tj_max_c = 72.0
def v_shield15(c): c.rad.shield_mm = 1.5
def v_alt800(c): c.orbit.alt_km = 800.0
def v_n128(c): c.chip.n_gpu = 128
def v_dod55(c): c.eps.batt_dod = 0.55; c.eps.batt_c_dis = 2.0


sizing_cases = [
    ("baseline_dd", baseline_dd()),
    ("iss_full", iss_like(1.0)),
    ("iss_lean", iss_like(0.35)),
    ("rad07", variant(v_rad07, "rad07")),
    ("tj65", variant(v_tj65, "tj65")),
    ("shield15", variant(v_shield15, "shield15")),
    ("alt800", variant(v_alt800, "alt800")),
    ("n128", variant(v_n128, "n128")),
    ("dod55", variant(v_dod55, "dod55")),
]
dump("sizing", {name: design_dict(c) for name, c in sizing_cases})


# ---------------------------------------------------------------- orbitloop
def orbit_case(c, env_over, n_orbits=3.0, label=""):
    dz = size_design(c)
    st = ThermalState(c, dz)
    env = {"fe": dz.worst_fe, "p_arr_w": dz.arr_p_bol_w * c.eps.pmad_eff,
           "alpha": c.thermal.rad_alpha_bol + 0.05, "leak_mult": 1.05,
           "n_alive": float(c.chip.n_gpu), "tj_target_c": c.chip.tj_target_c}
    env.update(env_over)
    tr = {}
    m = simulate_orbit(c, dz, env, st, n_orbits=n_orbits, trace=tr)
    return {"label": label, "env": env, "metrics": m,
            "state_end": {"t_cool_k": st.t_cool_k, "t_rad_k": st.t_rad_k,
                          "f": st.f, "soc_wh": st.soc_wh},
            "trace": {k: list(v) for k, v in tr.items()}}


orbitloop = {
    "baseline_dd": orbit_case(baseline_dd(), {}, label="baseline, worst fe"),
    "iss_full": orbit_case(iss_like(1.0), {}, label="iss full battery"),
    "iss_lean": orbit_case(iss_like(0.35), {}, label="iss battery-lean (idle path)"),
    "rad07_hot": orbit_case(variant(v_rad07, "rad07"), {"leak_mult": 1.2},
                            label="undersized radiator, thermal throttle"),
    "no_eclipse": orbit_case(baseline_dd(), {"fe": 0.0}, label="no eclipse"),
}
dump("orbitloop", orbitloop)


# ------------------------------------------- orbitloop, pinned design values
# The sized Design differs microscopically between Python and TS because the
# port uses the WGS-84 equatorial Earth radius (spec acceptance test pins the
# orbital period at 5,739 s) while sdcsim uses the 6371 km mean radius. To
# validate the fast loop itself at ~1e-9, pin every Design field the loop
# reads to exact round numbers on both sides.
PINNED = {"period_s": 5700.0, "batt_cap_wh": 36000.0, "a_rad_eff": 75.0,
          "a_rad_phys": 40.0, "ua_w_k": 2900.0, "idle_w": 6000.0,
          "q_design_w": 35000.0}


def pinned_case(c, dz_over, env_over, n_orbits=3.0, label=""):
    dz = size_design(c)
    for k, v in {**PINNED, **dz_over}.items():
        setattr(dz, k, v)
    st = ThermalState(c, dz)
    env = {"fe": 0.125, "p_arr_w": 51000.0, "alpha": 0.14, "leak_mult": 1.05,
           "n_alive": float(c.chip.n_gpu), "tj_target_c": c.chip.tj_target_c}
    env.update(env_over)
    tr = {}
    m = simulate_orbit(c, dz, env, st, n_orbits=n_orbits, trace=tr)
    return {"label": label, "env": env, "dz": {**PINNED, **dz_over},
            "metrics": m,
            "state_end": {"t_cool_k": st.t_cool_k, "t_rad_k": st.t_rad_k,
                          "f": st.f, "soc_wh": st.soc_wh},
            "trace": {k: list(v) for k, v in tr.items()}}


orbitloop_pinned = {
    "baseline": pinned_case(baseline_dd(), {}, {}, label="nominal, mild eclipse"),
    "eclipse": pinned_case(iss_like(1.0), {}, {"fe": 0.35},
                           label="deep eclipse, iss view factors"),
    "lean": pinned_case(iss_like(0.35), {"batt_cap_wh": 8000.0},
                        {"fe": 0.35, "p_arr_w": 45000.0},
                        label="small battery -> idle path"),
    "no_eclipse": pinned_case(baseline_dd(), {}, {"fe": 0.0}, label="no eclipse"),
    "throttle": pinned_case(baseline_dd(),
                            {"a_rad_eff": 45.0, "a_rad_phys": 24.0},
                            {"leak_mult": 1.3},
                            label="undersized radiator -> thermal limit"),
}
dump("orbitloop_pinned", orbitloop_pinned)


# ------------------------------------------------------------------ mission
def mission_dict(c):
    r = run_mission(c)
    return {
        "delivered_pflop_yr": r.delivered_pflop_yr,
        "nameplate_pflop_yr": r.nameplate_pflop_yr,
        "per_tonne": r.per_tonne,
        "utilization": r.utilization,
        "mass_total_kg": r.design.mass_total_kg,
        "losses": r.losses,
        "hist": {k: [float(x) for x in v] for k, v in r.hist.items()},
    }


missions = {}
for name, c in [("baseline_dd", baseline_dd()),
                ("iss_full", iss_like(1.0)),
                ("iss_lean", iss_like(0.35)),
                ("rad07", variant(v_rad07, "rad07")),
                ("shield08", variant(lambda c: setattr(c.rad, "shield_mm", 0.8), "shield08"))]:
    missions[name] = mission_dict(c)
dump("missions", missions)

print("\nbaseline check: delivered=%.3f PFLOP-yr, mass=%.1f kg, per_tonne=%.3f"
      % (missions["baseline_dd"]["delivered_pflop_yr"],
         missions["baseline_dd"]["mass_total_kg"],
         missions["baseline_dd"]["per_tonne"]))
