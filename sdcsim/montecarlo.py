"""Monte-Carlo wrapper: environment & model-parameter uncertainty.

Samples multiplicative uncertainties on the least-well-known inputs (dose rate,
SEE rate, hard-failure rate, coating drift, array degradation, TID hardness)
plus a random solar-cycle phase, runs the stochastic mission for each draw, and
reports the delivered-compute distribution and a rank-correlation sensitivity.
"""
import copy
import math
import numpy as np
from .mission import run_mission


SAMPLED = [
    # (label, kind, param)   lognormal sigma or uniform (lo, hi)
    ("dose rate x",        "logn", 0.50),
    ("SEU rate x",         "logn", 0.60),
    ("hard AFR x",         "logn", 0.35),
    ("coating drift x",    "unif", (0.7, 1.5)),
    ("array degr x",       "logn", 0.30),
    ("TID hardness x",     "logn", 0.25),
    ("solar phase",        "unif", (0.0, 2.0 * math.pi)),
]


def _apply(cfg, x):
    c = copy.deepcopy(cfg)
    c.rad.dose_scale *= x[0]
    c.rad.seu_scale *= x[1]
    c.rel.afr_scale *= x[2]
    c.thermal.rad_alpha_drift *= x[3]
    c.eps.arr_degr_per_yr *= x[4]
    c.rad.tid_char_krad *= x[5]
    c.mission.solar_phase0 = x[6]
    return c


def _rankz(v):
    r = np.argsort(np.argsort(v)).astype(float)
    r = (r - r.mean()) / max(r.std(), 1e-12)
    return r


def run_monte_carlo(cfg, n_runs=200, seed=7, dt_orbit_s=None):
    rng = np.random.default_rng(seed)
    X = np.zeros((n_runs, len(SAMPLED)))
    for j, (_, kind, p) in enumerate(SAMPLED):
        if kind == "logn":
            X[:, j] = rng.lognormal(mean=-0.5 * p * p, sigma=p, size=n_runs)
        else:
            X[:, j] = rng.uniform(p[0], p[1], size=n_runs)

    delivered = np.zeros(n_runs)
    per_tonne = np.zeros(n_runs)
    survivors = np.zeros(n_runs)
    for i in range(n_runs):
        c = _apply(cfg, X[i])
        if dt_orbit_s is not None:
            c.mission.dt_orbit_s = dt_orbit_s
        res = run_mission(c, rng=rng, stochastic=True)
        delivered[i] = res.delivered_pflop_yr
        per_tonne[i] = res.per_tonne
        survivors[i] = res.hist["n_alive"][-1]

    # Spearman rank correlation of each input with delivered compute
    zy = _rankz(delivered)
    sens = {}
    for j, (label, _, _) in enumerate(SAMPLED):
        sens[label] = float(np.mean(_rankz(X[:, j]) * zy))

    return {
        "X": X, "delivered": delivered, "per_tonne": per_tonne,
        "survivors": survivors, "sensitivity": sens,
        "p5": float(np.percentile(delivered, 5)),
        "p50": float(np.percentile(delivered, 50)),
        "p95": float(np.percentile(delivered, 95)),
    }
