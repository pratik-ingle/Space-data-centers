"""Parameter definitions and baseline configurations.

Every number here is a knob. Defaults are order-of-magnitude calibrated to
public sources (SPENVIS-class LEO environment outputs, H100-class GPU specs,
published spacecraft subsystem specific masses). See README for calibration
notes and which parameters most need replacing with measured data.
"""
from dataclasses import dataclass, field


@dataclass
class OrbitParams:
    alt_km: float = 550.0
    profile: str = "dd_sso"        # 'dd_sso' (dawn-dusk sun-sync) | 'mid_incl' (ISS-like)
    # dawn-dusk seasonal beta model: beta = mean + amp*cos(2*pi*t/yr)
    beta_mean_deg: float = 78.0
    beta_amp_deg: float = 13.0
    # mid-inclination beta model: beta = a1*sin(2pi t/T_prec) + a2*sin(2pi t/yr)
    mi_a1_deg: float = 42.0
    mi_a2_deg: float = 22.0
    mi_precession_days: float = 60.0


@dataclass
class ChipParams:
    n_gpu: int = 32
    tdp_w: float = 700.0            # nameplate per GPU
    pflops_nominal: float = 1.0     # dense BF16 PFLOPS per GPU at f=1 (H100-class ~0.99)
    p_dyn0_w: float = 460.0         # dynamic power at f=1, V=1
    p_leak0_w: float = 120.0        # leakage at V=1, Tj=60C, no TID
    t_leak_ref_c: float = 60.0
    leak_doubling_c: float = 25.0   # leakage doubles per this many K
    v_floor: float = 0.55           # V(f) = v_floor + (1-v_floor)*f  (DVFS voltage law)
    f_min: float = 0.40             # lowest DVFS state
    r_j_cw: float = 0.030           # K/W junction -> coolant, per GPU (cold plate)
    tj_target_c: float = 85.0       # throttle setpoint
    tj_max_c: float = 92.0          # hard limit
    other_frac: float = 0.45        # non-GPU IT power (CPU/NIC/mem host) as frac of GPU TDP
    other_idle_frac: float = 0.50   # load-independent share of 'other'
    idle_frac_of_design: float = 0.10  # IT power in idle/safe mode as frac of design IT


@dataclass
class ThermalParams:
    # radiator optical properties
    rad_eps: float = 0.86
    rad_alpha_bol: float = 0.09     # OSR-class BOL solar absorptance
    rad_alpha_drift: float = 0.10   # asymptotic increase from UV/AO/contamination
    rad_alpha_tau_yr: float = 3.0
    rad_sides_eff: float = 1.85     # double-sided deployable, effective side count
    rad_kg_m2: float = 6.0          # deployable radiator + embedded loop, per physical m^2
    rad_cp_j_kgk: float = 900.0
    # radiator environment view factors (per m^2 of *effective* area)
    f_ir: float = 0.12              # to Earth IR   (anti-sun edge-on default, dd_sso)
    f_alb: float = 0.06             # to sunlit Earth (albedo)
    f_sun: float = 0.02             # residual direct-sun leakage while illuminated
    # loop
    dt_loop_design_k: float = 12.0  # coolant-to-radiator design delta-T at full load
    c_cool_j_k: float = 8.0e4       # lumped coolant+coldplate heat capacity
    pump_frac: float = 0.04         # pump power as fraction of IT power
    # sizing controls
    area_margin: float = 1.10
    rad_area_scale: float = 1.0     # study knob: multiply sized area


@dataclass
class EPSParams:
    eta0: float = 0.30              # 3J GaAs at 28C
    temp_coeff_rel_per_k: float = -0.0018
    t_cell_sun_c: float = 65.0
    cos_pointing: float = 0.98
    pmad_eff: float = 0.93
    arr_degr_per_yr: float = 0.025  # radiation+UV+cycling, LEO polar-ish
    arr_kw_per_kg: float = 0.12     # ~120 W/kg wing-level
    arr_margin: float = 1.08
    aux_w: float = 2300.0           # avionics + comms, constant
    # battery
    batt_dod: float = 0.35
    batt_wh_per_kg: float = 130.0
    batt_eta_chg: float = 0.95
    batt_eta_dis: float = 0.97
    batt_sizing_frac: float = 1.0   # fraction of full bus load the battery must carry in eclipse
    batt_c_dis: float = 1.0         # max discharge rate, C
    batt_c_chg: float = 0.5
    batt_fade_ref: float = 4.0e-5   # capacity fade per cycle at DoD=0.4 (~20% at 5000 cyc)


@dataclass
class RadParams:
    shield_mm: float = 3.0          # enclosure wall, Al-equivalent
    shield_intrinsic_mm: float = 0.8  # board/package/self-shielding on top of wall
    dose_scale: float = 1.0
    tid_char_krad: float = 26.0     # Weibull characteristic TID-to-failure (COTS GPU+HBM)
    tid_shape: float = 3.2
    leak_per_krad: float = 0.012    # fractional leakage increase per krad
    seu_per_bit_day: float = 5.0e-12  # LEO quiet-sun, behind nominal shielding
    mem_bits_per_gpu: float = 6.9e11  # 80 GB HBM + SRAM
    unc_fraction: float = 0.01      # uncorrectable (post-ECC) fraction of upsets
    seu_scale: float = 1.0
    spe_dur_days: float = 2.5
    spe_seu_mult: float = 30.0
    spe_dose_krad_1mm: float = 0.30  # dose pulse per event behind 1 mm
    box_m2_per_kw_it: float = 1.0   # shielded enclosure surface area scaling


@dataclass
class ReliabilityParams:
    afr_base_per_yr: float = 0.02   # random hard-failure rate per GPU at Tj_ref
    tj_ref_c: float = 80.0
    thermal_frac: float = 0.6       # share of failures that are temperature-accelerated
    ea_ev: float = 0.7              # Arrhenius activation energy
    sel_per_gpu_yr: float = 0.003   # destructive latchup (with protection circuits)
    mmod_per_gpu_yr: float = 1.2e-3 # module-kill impact hazard mapped per GPU
    cyc_nf_ref: float = 1.2e5       # Coffin-Manson: cycles to fail at dT_ref
    cyc_dt_ref_k: float = 30.0
    cyc_exp: float = 2.35
    cyc_dt_min_k: float = 6.0
    afr_scale: float = 1.0
    # checkpoint / restart model (Daly)
    ckpt_write_s: float = 45.0
    restart_s: float = 300.0


@dataclass
class MassParams:
    it_kg_per_gpu: float = 28.0     # server + enclosure + local loop share
    struct_frac: float = 0.28       # primary structure + deployment mechs, of subsystem sum
    fixed_bus_kg: float = 400.0     # ADCS, propulsion, comms terminals, harness base
    fixed_frac: float = 0.03


@dataclass
class MissionParams:
    years: float = 5.0
    epochs_per_year: int = 26
    solar_phase0: float = 0.0       # radians; 11-yr cycle phase at t=0
    dt_orbit_s: float = 30.0


@dataclass
class Config:
    orbit: OrbitParams = field(default_factory=OrbitParams)
    chip: ChipParams = field(default_factory=ChipParams)
    thermal: ThermalParams = field(default_factory=ThermalParams)
    eps: EPSParams = field(default_factory=EPSParams)
    rad: RadParams = field(default_factory=RadParams)
    rel: ReliabilityParams = field(default_factory=ReliabilityParams)
    mass: MassParams = field(default_factory=MassParams)
    mission: MissionParams = field(default_factory=MissionParams)
    name: str = "baseline_dd_sso"


def baseline_dd() -> Config:
    """40 kW-IT cluster, 550 km dawn-dusk SSO, anti-sun double-sided radiator."""
    return Config()


def iss_like(batt_sizing_frac: float = 1.0) -> Config:
    """Same cluster in a 51.6 deg, 420 km orbit: heavy eclipses, worse radiator view."""
    c = Config(name=f"iss_like_batt{batt_sizing_frac:.2f}")
    c.orbit = OrbitParams(alt_km=420.0, profile="mid_incl")
    # radiator can no longer stay anti-sun/edge-on all orbit
    c.thermal.f_ir = 0.30
    c.thermal.f_alb = 0.12
    c.thermal.f_sun = 0.06
    c.eps.batt_sizing_frac = batt_sizing_frac
    c.rad.shield_mm = 3.0
    return c
