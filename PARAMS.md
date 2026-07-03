# Parameter reference

**Auto-generated from `app/src/core/params.ts` (`npm run docs:params`) — do not edit by hand.**
The UI builds its controls from the same schema, so this table is exact.
All defaults are the 550 km dawn-dusk SSO baseline; every default is an
order-of-magnitude engineering estimate calibrated to public sources — see
MODEL.md for what real data each subsystem needs to become mission-grade.

## Orbit

| path | label | default | range | unit | flags | physical meaning |
|---|---|---|---|---|---|---|
| `orbit.alt_km` | Altitude | 550 | 300 … 1200 | km | – | Higher: longer orbit, less eclipse and drag, but steeply more trapped radiation dose. |
| `orbit.beta_mean_deg` | Mean beta angle | 78 | 0 … 90 | deg | profile: custom | Sun elevation from the orbit plane; above ~67 deg (at 550 km) eclipses vanish. |
| `orbit.beta_amp_deg` | Seasonal beta swing | 13 | 0 … 45 | deg | profile: custom | Annual oscillation amplitude of beta around its mean. |
| `orbit.mi_a1_deg` | MI precession amp | 42 | 0 … 70 | deg | advanced, profile: mid_incl | Nodal-precession beta amplitude of the mid-inclination model. |
| `orbit.mi_a2_deg` | MI seasonal amp | 22 | 0 … 45 | deg | advanced, profile: mid_incl | Seasonal beta amplitude of the mid-inclination model. |
| `orbit.mi_precession_days` | MI precession period | 60 | 20 … 365 | d | advanced, profile: mid_incl | Nodal precession period (ISS-like ~60 d). |

## Compute

| path | label | default | range | unit | flags | physical meaning |
|---|---|---|---|---|---|---|
| `chip.n_gpu` | GPU count | 32 | 8 … 512 (log) | – | int | Cluster size: every subsystem (radiator, array, battery, shield box) re-sizes with it. |
| `chip.tdp_w` | GPU TDP | 700 | 300 … 1000 | W | – | Nameplate per-GPU power; dynamic and leakage shares scale with it (advanced overrides). |
| `chip.pflops_nominal` | PFLOPS per GPU | 1 | 0.5 … 4 | PFLOPS | – | Dense BF16 throughput at full clock (H100-class ~1.0). |
| `chip.tj_target_c` | Tj setpoint | 85 | 45 … 95 | degC | – | Run hot: smaller radiator (T^4) but more leakage and Arrhenius-accelerated failures. |
| `chip.f_min` | Min DVFS clock | 0.4 | 0.2 … 0.8 | – | – | Lowest throttle state; below it the cluster drops to idle/safe mode instead. |
| `chip.p_dyn0_w` | Dynamic power @f=1 | 460 | 100 … 1500 | W | advanced | P_dyn = P_dyn0 * f * V(f)^2; auto-scales when TDP slider moves. |
| `chip.p_leak0_w` | Leakage @V=1,60C | 120 | 10 … 600 | W | advanced | Leakage doubles every 25 K above 60 degC and grows with TID; auto-scales with TDP. |
| `chip.leak_doubling_c` | Leakage doubling | 25 | 10 … 50 | K | advanced | Temperature rise that doubles subthreshold leakage. |
| `chip.v_floor` | DVFS voltage floor | 0.55 | 0.4 … 0.8 | – | advanced | V(f) = floor + (1-floor)*f; sets how much power DVFS can shed. |
| `chip.r_j_cw` | Rth junction-coolant | 0.03 | 0.01 … 0.1 | K/W | advanced | Cold-plate stack resistance per GPU: Tj = T_coolant + Rth*P. |
| `chip.tj_max_c` | Tj hard limit | 92 | 50 … 110 | degC | advanced | Emergency frequency cut above this junction temperature. |
| `chip.other_frac` | Non-GPU IT power | 0.45 | 0 … 1 | x TDP | advanced | CPU/NIC/memory host power as a fraction of GPU TDP. |
| `chip.other_idle_frac` | Non-GPU idle share | 0.5 | 0 … 1 | – | advanced | Load-independent share of the non-GPU power. |
| `chip.idle_frac_of_design` | Idle IT power | 0.1 | 0.02 … 0.3 | x design | advanced | IT power in idle/safe mode as a fraction of design IT power. |

## Thermal

| path | label | default | range | unit | flags | physical meaning |
|---|---|---|---|---|---|---|
| `thermal.rad_area_scale` | Radiator area scale | 1 | 0.5 … 2 | x sized | – | Multiplies the thermally-sized area: undersize throttles, oversize hauls dead mass. |
| `thermal.rad_kg_m2` | Radiator specific mass | 6 | 4 … 16 | kg/m2 | – | Deployable radiator + embedded loop areal density; drives the run-hot-vs-cool optimum. |
| `thermal.rad_eps` | Emissivity | 0.86 | 0.7 … 0.95 | – | – | IR emissivity: rejection scales as eps*sigma*T^4. |
| `thermal.rad_alpha_bol` | Absorptance (BOL) | 0.09 | 0.05 … 0.3 | – | – | Solar absorptance of fresh coating (OSR ~0.09, white paint ~0.2). |
| `thermal.rad_alpha_drift` | Absorptance drift | 0.1 | 0 … 0.3 | – | – | Asymptotic UV/AO/contamination darkening: alpha(t) = BOL + drift*(1-e^(-t/tau)). |
| `thermal.dt_loop_design_k` | Loop delta-T | 12 | 5 … 25 | K | – | Coolant-to-radiator design temperature drop: tighter needs more pumping/area. |
| `thermal.rad_alpha_tau_yr` | Alpha drift tau | 3 | 0.5 … 10 | yr | advanced | E-folding time of coating darkening. |
| `thermal.rad_sides_eff` | Effective sides | 1.85 | 1 … 2 | – | advanced | Double-sided deployable radiator effectiveness (2 = ideal). |
| `thermal.rad_cp_j_kgk` | Radiator cp | 900 | 300 … 2000 | J/kg-K | advanced | Specific heat of the radiator mass (thermal inertia). |
| `thermal.f_ir` | View factor: Earth IR | 0.12 | 0 … 1 | – | advanced | Effective view to warm Earth; attitude preset sets this (anti-sun edge-on ~0.12). |
| `thermal.f_alb` | View factor: albedo | 0.06 | 0 … 1 | – | advanced | Effective view to sunlit Earth. |
| `thermal.f_sun` | View factor: sun | 0.02 | 0 … 0.5 | – | advanced | Residual direct solar leakage onto the radiator while lit. |
| `thermal.c_cool_j_k` | Coolant capacity | 80000 | 10000 … 5.00e5 (log) | J/K | advanced | Lumped coolant + coldplate heat capacity (loop thermal inertia). |
| `thermal.pump_frac` | Pump power | 0.04 | 0 … 0.12 | x IT | advanced | Coolant pump power as a fraction of IT power. |
| `thermal.area_margin` | Sizing margin | 1.1 | 1 … 1.4 | – | advanced | Radiator area margin applied at the design point. |

## Power

| path | label | default | range | unit | flags | physical meaning |
|---|---|---|---|---|---|---|
| `eps.eta0` | Cell efficiency | 0.3 | 0.25 … 0.34 | – | – | Triple-junction GaAs at 28 degC; derated with temperature. |
| `eps.arr_degr_per_yr` | Array degradation | 0.025 | 0.005 … 0.06 | /yr | – | Radiation + UV + thermal cycling power fade; array is sized at end of life. |
| `eps.batt_dod` | Battery DoD limit | 0.35 | 0.2 … 0.6 | – | – | Deeper discharge: lighter battery but faster cycle fade per orbit. |
| `eps.batt_c_dis` | Max discharge rate | 1 | 0.5 … 3 | C | – | Power constraint on sizing: battery must push the eclipse load at this C-rate. |
| `eps.batt_c_chg` | Max charge rate | 0.5 | 0.2 … 2 | C | – | Caps eclipse-exit recharge; too low and SoC never recovers. |
| `eps.batt_sizing_frac` | Battery sizing fraction | 1 | 0 … 1 | – | – | Fraction of the bus load the battery carries in eclipse. Lean designs idle in shadow and thermally cycle to death — deliberately allowed. |
| `eps.temp_coeff_rel_per_k` | Cell temp coeff | -0.0018 | -0.005 … 0 | /K | advanced | Relative efficiency loss per kelvin above 28 degC. |
| `eps.t_cell_sun_c` | Cell temp in sun | 65 | 20 … 110 | degC | advanced | Operating temperature of illuminated cells. |
| `eps.cos_pointing` | Pointing cosine | 0.98 | 0.7 … 1 | – | advanced | Mean cosine loss from array pointing error. |
| `eps.pmad_eff` | PMAD efficiency | 0.93 | 0.8 … 0.98 | – | advanced | Power management and distribution chain efficiency. |
| `eps.arr_kw_per_kg` | Array specific power | 0.12 | 0.05 … 0.3 | kW/kg | advanced | Wing-level specific power (~120 W/kg current flexible arrays). |
| `eps.arr_margin` | Array margin | 1.08 | 1 … 1.3 | – | advanced | Sizing margin on the EOL array. |
| `eps.aux_w` | Aux bus load | 2300 | 500 … 10000 | W | advanced | Avionics + comms constant load. |
| `eps.batt_wh_per_kg` | Battery energy density | 130 | 80 … 300 | Wh/kg | advanced | Pack-level specific energy (Li-ion ~130 Wh/kg space-rated). |
| `eps.batt_eta_chg` | Charge efficiency | 0.95 | 0.85 … 1 | – | advanced | Energy retained per Wh pushed into the cells. |
| `eps.batt_eta_dis` | Discharge efficiency | 0.97 | 0.85 … 1 | – | advanced | Energy delivered per Wh drawn from the cells. |
| `eps.batt_fade_ref` | Cycle fade @DoD 0.4 | 4.00e-5 | 0 … 2.00e-4 | /cycle | advanced | Capacity fade per cycle at 40% DoD (~20% at 5000 cycles); scales as (DoD/0.4)^exp. |
| `eps.batt_fade_dod_exp` | Fade DoD exponent | 2 | 1 … 3 | – | advanced | DoD sensitivity of cycle fade (Li-ion ~2). |

## Radiation

| path | label | default | range | unit | flags | physical meaning |
|---|---|---|---|---|---|---|
| `rad.shield_mm` | Shield wall | 3 | 0.5 … 10 | mm Al | – | Enclosure wall: thin = TID death, thick = dead launch mass. Optimum ~1.5 mm at 550 km. |
| `rad.tid_char_krad` | TID hardness (char.) | 26 | 5 … 80 | krad | – | Weibull characteristic dose-to-failure of COTS GPU+HBM (published failures 5-50 krad). |
| `rad.seu_scale` | SEU rate scale | 1 | 0.1 … 10 (log) | x | – | Multiplier on the upset rate; feeds the Daly checkpoint tax via cluster MTBF. |
| `mission.solar_phase0` | Solar-cycle phase | 0 | 0 … 6.283 | rad | – | Where in the 11-yr cycle the mission starts; pi/2 = launch at solar max (more SPEs, less trapped dose). |
| `rad.shield_intrinsic_mm` | Intrinsic shielding | 0.8 | 0 … 3 | mm Al | advanced | Board/package/self-shielding on top of the enclosure wall. |
| `rad.dose_scale` | Dose rate scale | 1 | 0.2 … 5 (log) | x | advanced | Uncertainty multiplier on the TID environment. |
| `rad.tid_shape` | TID Weibull shape | 3.2 | 1.5 … 6 | – | advanced | Spread of part dose-to-failure (higher = sharper cliff). |
| `rad.leak_per_krad` | Leakage per krad | 0.012 | 0 … 0.05 | /krad | advanced | Fractional leakage-power growth per krad of TID. |
| `rad.seu_per_bit_day` | SEU per bit-day | 5.00e-12 | 1.00e-13 … 1.00e-10 (log) | – | advanced | Quiet-sun LEO upset rate behind nominal shielding. |
| `rad.mem_bits_per_gpu` | Memory bits per GPU | 6.90e11 | 1.00e11 … 5.00e12 (log) | bit | advanced | HBM + SRAM capacity exposed to upsets (80 GB ~ 6.9e11). |
| `rad.unc_fraction` | Uncorrectable frac | 0.01 | 0.001 … 0.1 (log) | – | advanced | Post-ECC fraction of upsets that kill the job. |
| `rad.spe_dur_days` | SPE duration | 2.5 | 0.5 … 7 | d | advanced | Mean duration of a solar particle event. |
| `rad.spe_seu_mult` | SPE SEU multiplier | 30 | 5 … 100 | x | advanced | Upset-rate multiplier during a storm. |
| `rad.spe_dose_krad_1mm` | SPE dose pulse | 0.3 | 0 … 1 | krad@1mm | advanced | Prompt dose per event behind 1 mm Al. |
| `rad.box_m2_per_kw_it` | Enclosure area | 1 | 0.3 … 3 | m2/kW | advanced | Shielded box surface area per kW of IT (sets shield mass). |

## Reliability

| path | label | default | range | unit | flags | physical meaning |
|---|---|---|---|---|---|---|
| `rel.afr_base_per_yr` | Base AFR | 0.02 | 0.005 … 0.1 | /yr | – | Random hard-failure rate per GPU at the reference junction temp. |
| `rel.ea_ev` | Arrhenius Ea | 0.7 | 0.3 … 1.1 | eV | – | Activation energy of the thermally-driven failure fraction (~2x per 10 K at 0.7 eV). |
| `rel.cyc_exp` | Coffin-Manson exp. | 2.35 | 1.5 … 4 | – | – | Fatigue exponent: cycles-to-fail = Nf_ref*(dTj/30K)^-m, one cycle per orbit. |
| `rel.ckpt_write_s` | Checkpoint write | 45 | 5 … 300 | s | – | Time to write a checkpoint; optimal interval tau* = sqrt(2*delta*MTBF) (Daly). |
| `rel.restart_s` | Restart time | 300 | 30 … 1200 | s | – | Reboot + reload + rollback time after an uncorrectable error. |
| `rel.tj_ref_c` | AFR reference Tj | 80 | 60 … 100 | degC | advanced | Junction temperature at which the base AFR is quoted. |
| `rel.thermal_frac` | Thermal failure share | 0.6 | 0 … 1 | – | advanced | Share of hard failures that Arrhenius-accelerate with Tj. |
| `rel.sel_per_gpu_yr` | SEL rate | 0.003 | 0 … 0.02 | /GPU-yr | advanced | Destructive latch-up hazard (with protection circuits). |
| `rel.mmod_per_gpu_yr` | MMOD rate | 0.0012 | 0 … 0.01 | /GPU-yr | advanced | Micrometeoroid/debris module-kill hazard mapped per GPU. |
| `rel.cyc_nf_ref` | Fatigue Nf @30K | 1.20e5 | 10000 … 1.00e6 (log) | cycles | advanced | Coffin-Manson cycles-to-fail at the 30 K reference swing. |
| `rel.cyc_dt_ref_k` | Fatigue ref swing | 30 | 15 … 60 | K | advanced | Reference per-orbit Tj swing for the fatigue law. |
| `rel.cyc_dt_min_k` | Fatigue threshold | 6 | 2 … 20 | K | advanced | Per-orbit swings below this cause no fatigue damage. |
| `rel.afr_scale` | AFR scale | 1 | 0.2 … 5 (log) | x | advanced | Uncertainty multiplier on the hard-failure rate. |

## Mission

| path | label | default | range | unit | flags | physical meaning |
|---|---|---|---|---|---|---|
| `mission.years` | Mission duration | 5 | 1 … 10 | yr | – | Design life: arrays sized EOL, attrition and dose integrate over it. |
| `mass.it_kg_per_gpu` | IT mass per GPU | 28 | 10 … 60 | kg | advanced | Server + enclosure + local loop share per GPU. |
| `mass.struct_frac` | Structure fraction | 0.28 | 0.15 … 0.45 | – | advanced | Primary structure + deployment mechanisms, of subsystem sum. |
| `mass.fixed_bus_kg` | Fixed bus mass | 400 | 100 … 1500 | kg | advanced | ADCS, propulsion, comms terminals, harness base. |
| `mass.fixed_frac` | Bus scaling frac | 0.03 | 0 … 0.1 | – | advanced | Bus mass share that scales with spacecraft size. |
| `mission.epochs_per_year` | Epochs per year | 26 | 12 … 52 | /yr | advanced, int | Degradation-epoch cadence (~2 weeks default). |
| `mission.dt_orbit_s` | Fast-loop step | 30 | 10 … 60 | s | advanced | Time step of the orbit transient loop. |

## Fields without sliders (modes, RNG, run controls)

| path | default |
|---|---|
| `orbit.profile` | "dd_sso" |
| `chip.t_leak_ref_c` | 60 |
| `mission.stochastic` | false |
| `mission.seed` | 7 |
| `mission.mc_runs` | 200 |
