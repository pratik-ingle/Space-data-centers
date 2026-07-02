"""Radiation environment and its compute-level consequences.

Parametric fits with SPENVIS-class shapes: TID rate vs Al-equivalent shield
depth (power law + GCR floor), SEU-driven uncorrectable error rates, solar
particle event statistics, and the Daly checkpoint-overhead model that turns
error rates into lost compute.
"""
import math


def dose_rate_krad_per_yr(shield_mm_eff: float, alt_km: float, profile: str,
                          s_act: float, scale: float = 1.0) -> float:
    """TID rate in silicon behind an Al-equivalent slab [krad(Si)/yr].

    Shape: trapped-particle power law + GCR/secondary floor. Anchored to
    ~6 krad/yr behind 1 mm at 550 km SSO. Trapped protons at LEO anticorrelate
    with solar activity (atmosphere swells at solar max, sweeping the belts).
    Replace with a SPENVIS/OMERE dose-depth table for a real design point.
    """
    a_trapped = 6.0 * math.exp((alt_km - 550.0) / 250.0)
    incl = 1.0 if profile == "dd_sso" else 0.85
    solar = 1.15 - 0.30 * s_act
    d = max(shield_mm_eff, 0.2)
    return scale * incl * (a_trapped * solar * d ** (-1.3) + 0.35)


def spe_rate_per_yr(s_act: float) -> float:
    """Poisson rate of significant solar particle events."""
    return 0.4 + 4.6 * s_act


def unc_error_rate_per_gpu_day(rad, shield_mm_eff: float, spe_mult: float = 1.0) -> float:
    """Uncorrectable (post-ECC) memory error rate per GPU per day."""
    base = rad.seu_per_bit_day * (0.7 + 0.3 * math.exp(-shield_mm_eff / 2.0))
    return rad.seu_scale * base * rad.mem_bits_per_gpu * rad.unc_fraction * spe_mult


def checkpoint_overhead(delta_s: float, restart_s: float, mtbf_s: float) -> float:
    """First-order Daly model: fraction of wall-clock lost to checkpoint +
    rollback + restart at the optimal checkpoint interval."""
    if mtbf_s <= 4.0 * delta_s:
        return 0.95
    tau = math.sqrt(2.0 * delta_s * mtbf_s)
    ov = delta_s / tau + tau / (2.0 * mtbf_s) + restart_s / mtbf_s
    return min(0.95, ov)
