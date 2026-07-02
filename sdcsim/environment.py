"""Orbit + space-environment boundary conditions (the driving layer).

Circular-orbit analytical models: beta-angle seasonal profiles, eclipse
fraction from cylindrical-shadow geometry, 11-year solar activity index.
"""
import math
from .constants import R_EARTH_KM, MU_EARTH, SECONDS_PER_YEAR, SECONDS_PER_DAY


def orbit_period_s(alt_km: float) -> float:
    a = R_EARTH_KM + alt_km
    return 2.0 * math.pi * math.sqrt(a ** 3 / MU_EARTH)


def beta_deg(t_s: float, o) -> float:
    t_yr = t_s / SECONDS_PER_YEAR
    if o.profile == "dd_sso":
        return o.beta_mean_deg + o.beta_amp_deg * math.cos(2.0 * math.pi * t_yr)
    if o.profile == "mid_incl":
        t_d = t_s / SECONDS_PER_DAY
        return (o.mi_a1_deg * math.sin(2.0 * math.pi * t_d / o.mi_precession_days)
                + o.mi_a2_deg * math.sin(2.0 * math.pi * t_yr))
    raise ValueError(f"unknown orbit profile {o.profile}")


def eclipse_fraction(alt_km: float, beta: float) -> float:
    """Fraction of a circular orbit in umbra (cylindrical shadow model)."""
    cb = math.cos(math.radians(beta))
    if cb <= 1e-9:
        return 0.0
    h, r = alt_km, R_EARTH_KM
    x = math.sqrt(h * h + 2.0 * r * h) / ((r + h) * cb)
    if x >= 1.0:
        return 0.0
    return math.acos(x) / math.pi


def solar_activity(t_s: float, phase0: float = 0.0) -> float:
    """Smoothed 11-year solar-cycle activity index in [0, 1]."""
    return 0.5 * (1.0 + math.sin(2.0 * math.pi * t_s / (11.0 * SECONDS_PER_YEAR) + phase0))


def worst_eclipse_fraction(o, horizon_yr: float = 1.0, n: int = 1600) -> float:
    worst = 0.0
    for i in range(n):
        t = i * horizon_yr * SECONDS_PER_YEAR / n
        worst = max(worst, eclipse_fraction(o.alt_km, beta_deg(t, o)))
    return worst
