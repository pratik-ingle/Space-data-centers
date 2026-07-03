# MODEL.md — the physics inside OrbitalDC Studio

Every visible number in the app comes out of the reduced-order models in
`app/src/core/` (a line-for-line TypeScript port of the `sdcsim/` Python
reference, validated against it to golden fixtures). This document states, per
subsystem: the **governing equations as implemented**, **what is reduced-order
about them**, and **what real data would replace the assumption** for a
mission-grade answer. Defaults and ranges for every knob are in
[PARAMS.md](PARAMS.md) (auto-generated from the schema).

The single figure of merit everything rolls up to is **delivered PFLOP-years
per tonne launched**. The coupling map:

```
workload → chip power (dynamic + T-dependent leakage) → heat → coolant loop →
radiator (εσT⁴ out; solar/albedo/Earth-IR in) → junction temperature →
DVFS throttle controller → effective FLOPS
        overlays: TID → leakage growth + mortality; SEU → checkpoint tax;
        solar particle events; coating darkening; array degradation;
        thermal-cycling fatigue; random failures; battery fade
```

Baseline reproduction (acceptance-tested): 550 km dawn-dusk SSO, 32× H100-class
GPUs, 5 yr → **147.0 PFLOP-yr delivered, 3,219 kg, 45.7 PFLOP-yr/tonne**,
matching the Python reference to well within the 2 % spec bound.

---

## 1. Orbital environment (`environment.ts`)

**Equations.**
- Circular Keplerian period: `T = 2π√(a³/μ⊕)`, `a = R⊕ + h`
  (μ⊕ = 398 600.4418 km³/s², R⊕ = 6378.137 km WGS-84 equatorial — chosen so the
  spec's pinned 5,739 s at 550 km holds; the Python reference's 6371 km mean
  radius shifts mission outputs ≪1 %).
- Beta angle (sun elevation from the orbit plane):
  - dawn-dusk SSO / custom: `β(t) = β_mean + β_amp·cos(2πt/yr)`
  - mid-inclination (ISS-like): `β(t) = a₁·sin(2πt/T_prec) + a₂·sin(2πt/yr)`
    — nodal precession beating against the seasonal term.
- Eclipse fraction, cylindrical umbra:
  `fe = acos(√(h² + 2R⊕h) / ((R⊕+h)·cos β)) / π`, 0 when the argument ≥ 1;
  eclipse-free above `β* = acos(√(2R⊕h + h²)/(R⊕+h))` (≈ 67–70° in LEO).
- The fast loop centres the shadow at half-period:
  entry `0.5(1−fe)·T`, exit `fe·T` later.
- Solar activity index: `s(t) = ½(1 + sin(2πt/11 yr + φ₀)) ∈ [0,1]`.

**Reduced-order.** Circular orbit only; β is a closed-form profile rather than
propagated elements (no direct J2; the mid-inclination profile *emulates*
precession); cylindrical shadow (no penumbra, no oblateness); solar cycle is a
smooth sinusoid.

**Calibration path.** Real ephemeris/SGP4 propagation with J2 for β(t) history;
mission-specific eclipse tables; observed F10.7/sunspot series instead of the
sinusoid.

## 2. Chip / compute (`design.ts`, `orbitloop.ts`)

**Equations.**
- Per-GPU electrical power at clock fraction `f` and junction temp `Tj`:
  `P = P_dyn0·f·V(f)² + P_leak0·V·m_leak·2^((Tj−60 °C)/25 K)`, with the DVFS
  voltage law `V(f) = 0.55 + 0.45·f`. Dynamic term is classic αCV²f;
  leakage is sub-threshold exponential-in-T (doubling per 25 K), multiplied by
  the TID leakage factor `m_leak = 1 + k_TID·D` (§5). Defaults are constructed
  so `P(f=1, Tj=85 °C) = TDP` exactly; the TDP slider rescales
  `P_dyn0`/`P_leak0` proportionally.
- Non-GPU IT (host/NIC/memory): `P_other = other_frac·TDP·(idle_share + (1−idle_share)·f)`.
- Quasi-static junction: fixed point of `Tj = T_cool + Rθ,jc·P_gpu(Tj)`
  (3 iterations — leakage↔Tj converges fast at these gains).
- DVFS throttle: proportional controller on the Tj error with gain
  0.006/K per 30 s step (scaled by dt), slew-limited (+0.03/−0.05 per step),
  clamped to `[f_min, 1]`; an emergency −0.1 cut fires above the Tj hard limit.
- Effective compute: `n_alive · PFLOPS_nominal · f · (1 − checkpoint_overhead)`.

**Reduced-order.** One representative GPU (no per-die spread), quasi-static
junction (no die thermal mass), a single voltage-frequency line, and a purely
proportional controller (real governors are hysteretic state machines).

**Calibration path.** Measured P(f, V, T) surfaces for the actual SKU;
transient die thermal model (Cauer network) from vendor data; the real
governor's transfer function; per-workload FLOPS/W scaling.

## 3. Thermal (`orbitloop.ts`, `design.ts`)

**Equations.** Two-node network — coolant (loop + coldplates) and radiator:
- Coolant node: `C_cool·dT_cool/dt = Q_IT − UA·(T_cool − T_rad)` integrated
  with the exact exponential update toward its instantaneous equilibrium.
- Radiator node (stiff): `C_rad·dT/dt = UA·(T_cool − T) + q_abs·A_eff − εσT⁴·A_eff`.
  Each step linearizes the T⁴ sink about the current temperature
  (`g = 4εσT³A`, a Newton step for the equilibrium) and relaxes exponentially
  with `τ = C/(UA+g)` — unconditionally stable, **never** naive explicit Euler
  (validation test: an isolated node settles onto `T = (q/εσ)^¼` to < 0.1 K).
- Absorbed environment per m² of effective area:
  `q_abs = ε·F_ir·q_EarthIR + α(t)·(F_alb·a·S + F_sun·S)` when illuminated,
  IR term only in eclipse. View factors `F_ir/F_alb/F_sun` are static presets
  per orbit/attitude class (anti-sun edge-on for dawn-dusk; warmer set for the
  ISS-like preset).
- Coating darkening: `α(t) = α_BOL + Δα·(1 − e^(−t/τ_α))` (UV/AO/contamination).
- Radiator heat capacity `C_rad = kg/m²·A_phys·c_p`; loop conductance
  `UA = Q_design/ΔT_loop`.

**Reduced-order.** Two lumped nodes stand in for a pumped loop + deployable
panel network; view factors are constants per attitude preset rather than
ray-traced per orientation; single-phase loop (no two-phase/heat-pipe physics);
coating drift is a single exponential.

**Calibration path.** TVAC test of the coldplate/loop/radiator stack; regress
the two-node ROM against a SINDA/ESATAN model; ray-traced radiative view
factors per attitude profile; coating α(t) from flight-returned samples
(e.g. LDEF/MISSE-class data).

## 4. Electrical power (`orbitloop.ts`, `design.ts`)

**Equations.**
- Array output while illuminated:
  `P_arr = S·A_arr·η(T_cell)·cosθ_point·η_PMAD·e^(−k_degr·t)`, zero in eclipse,
  with `η(T) = η₀·(1 + c_T·(T_cell − 28 °C))` (c_T < 0).
- Battery energy state per step with charge/discharge efficiencies; discharge
  power capped by both the C-rate (`C_dis·capacity`) and the energy accessible
  in one step; charge capped at `C_chg·capacity`.
- Dispatch each step: if `P_load > P_arr + P_dis,max`, bisect the DVFS
  frequency (22 iterations) down to the supportable level; if even `f_min`
  cannot be carried, drop to idle/safe mode (idle bus load, pumps at 30 %,
  controller restarts from `f_min`).
- Battery sizing satisfies **both** constraints (the spec's called-out trap):
  energy `E ≥ P_bus·frac·fe·T / (DoD·η_dis)` **and** power
  `capacity ≥ P_bus·frac / C_dis`.
- Array sized at end-of-life including the eclipse-recharge factor
  `P_recharge = P_bus·frac·fe / ((1−fe)·η_chg·η_dis)`, with margin.
- Cycle fade (documented extension beyond the reference, which defines the
  knob but never applies it): per eclipse cycle
  `Δcap = fade_ref·(DoD/0.4)^p`; set `batt_fade_ref = 0` for bit-exact parity.

**Reduced-order.** Energy-bucket battery (no voltage/SoC curve, no thermal
model of the pack); PMAD is a single efficiency; array pointing is a mean
cosine; degradation a single exponential.

**Calibration path.** Cell IV curves vs temperature and fluence (LILT data if
relevant); pack-level cycler data for fade vs DoD/temperature; PMAD chain
efficiency budget; array degradation from equivalent-fluence analysis
(EQFLUX/SPENVIS) for the actual cell stack and orbit.

## 5. Radiation (`radiation.ts`, `mission.ts`)

**Equations.**
- TID rate behind an Al-equivalent slab (SPENVIS-shape parametric fit):
  `Ḋ = scale·incl·(A·(1.15 − 0.3·s)·d^−1.3 + 0.35) krad/yr`, with
  `A = 6·e^((h−550 km)/250 km)` anchored to ≈ 6 krad/yr behind 1 mm Al at
  550 km SSO; trapped protons **anticorrelate** with solar activity (the swollen
  atmosphere sweeps the inner belt at solar max); depth floored at 0.2 mm;
  0.85 inclination factor for the mid-inclination class; a 0.35 krad/yr
  GCR/secondary floor no shielding removes. Effective depth = wall + intrinsic
  (board/package self-shielding).
- Leakage growth: `m_leak = 1 + leak_per_krad·D` (feeds §2).
- Part mortality: Weibull in accumulated dose, survival
  `S(D) = exp(−(D/D_char)^k)`; each epoch applies the conditional ratio
  `S(D_new)/S(D_old)`.
- SEU → job-killing errors: per-GPU rate
  `r_unc = SEU/bit-day · bits · unc_fraction · shield(d) · scale`, with
  `shield(d) = 0.7 + 0.3·e^(−d/2 mm)` (high-energy component barely attenuates).
- Checkpoint tax (Daly 2006, first-order): cluster MTBF `M = 1/(r_unc·n + r_hard·n)`;
  optimal interval `τ* = √(2δM)`; overhead `≈ δ/τ* + τ*/2M + R/M`, ceiling 0.95.
  (Validation test: the numerical minimum of overhead(τ) sits at τ*.)
- Solar particle events: Poisson with rate `0.4 + 4.6·s` per year. During an
  event (mean 2.5 d): SEU ×30 and a prompt dose pulse
  `0.3 krad @1 mm · e^(−(d−1)/1.2 mm)`. Expected-value mode folds storms into
  the epoch mean; sampled mode draws them discretely.
- Destructive latch-up: constant hazard `SEL/GPU-yr · (0.5 + s)`.

**Reduced-order.** Omnidirectional power-law dose-depth instead of transport
through real geometry; one Weibull for a heterogeneous BOM; SEU treated as
memory-dominated with a single post-ECC fraction; SPE fluence collapsed to one
multiplier + dose pulse.

**Calibration path.** SPENVIS/OMERE environment + GEANT4/MULASSIS (or
NOVICE/FASTRAD) transport through the actual enclosure CAD for dose-depth;
proton/heavy-ion **beam tests** of the actual GPU + HBM for SEU/SEL/TID
cross-sections (HBM is the soft spot; published COTS GPU failures span
~5–50 krad, hence the wide Weibull prior and MC spread); CREME96-class SPE
spectra for storm multipliers.

## 6. Reliability & attrition (`mission.ts`)

**Equations.** Per-GPU hazard per epoch:
```
λ = AFR_base·scale·(1 − w_th + w_th·e^{(Ea/k)(1/T_ref − 1/Tj)})   thermally-accelerated random
  + SEL·(0.5 + s)                                                  latch-up (§5)
  + MMOD                                                           micrometeoroid/debris
  + (T_yr/T_orbit)/Nf,   Nf = Nf_ref·(ΔTj/30 K)^−m   if ΔTj > threshold
```
Coffin–Manson fatigue counts **one cycle per orbit** with ΔTj measured from
the resolved orbit transient — the battery-lean preset exists precisely to
show this: nodes that idle every eclipse cold-soak ~tens of K and fatigue out.
Survival multiplies the TID Weibull conditional ratio (§5). At 0.7 eV the
Arrhenius factor doubles roughly every 10 K near 80 °C (validation test 6).

Expected-value mode propagates fractional `n_alive` smoothly; sampled mode
draws binomial deaths per epoch from the seeded RNG. Fixed seed ⇒
bit-reproducible (validation test 8).

**Reduced-order.** Independent identical units (no correlated/board-level
failures, no repair/sparing); MMOD as a constant rate rather than
flux–area–shielding (no ORDEM/MASTER geometry); fatigue from a single ΔTj per
orbit.

**Calibration path.** Fleet AFR telemetry vs junction temperature (the only
trustworthy source for AFR_base and Ea); vendor FIT data; solder/TIM fatigue
coupon tests for Nf_ref and exponent; ORDEM/MASTER + BLE curves for MMOD.

## 7. Sizing & the mass budget (`design.ts`) — closes the design loop

From the setpoints, in order: radiator area from the Tj stack-up
(`T_rad = Tj_target − Rθ,jc·P_gpu − ΔT_loop`, reject `εσT⁴ − q_abs` net W/m²
at mid-life α, with margin; a 30 W/m² floor triggers a **design warning**
instead of a silent clamp); battery (energy AND C-rate, §4); array at EOL with
the recharge factor; shield mass = wall × enclosure area (m²/kW_IT); IT mass
per GPU; structure as a fraction of the subsystem sum; fixed bus + scaling
share. Every slider change re-sizes and re-masses instantly on the UI thread,
so PFLOP-yr/tonne responds live; unphysical combinations surface as warnings.

## 8. Multi-rate integration (`mission.ts`, `orbitloop.ts`)

- **Fast loop**: dt = 30 s (10–60 s knob) through the orbit — thermal
  transients, DVFS, dispatch. The radiator/coolant updates are exponential
  (§3), so the loop is stable at any dt.
- **Steady-periodic approximation**: each ~2-week epoch resolves 1.5 orbits
  (4 on the first, for warm start) and takes metrics from the final full
  orbit — the state is carried between epochs, so slow drifts propagate.
- **Slow loop**: per epoch — TID, α drift, array fade, battery fade,
  attrition, checkpoint overhead, SPE exposure.
- **Energy closure**: over the accounted orbit,
  `∫(array − load − losses)dt = ΔSoC + clamp` to < 1 % (validation test 3).
- The live worker paces epochs against the wall clock at the commanded warp
  (1×–10⁶×) and samples the epoch's orbit at the live phase — the display
  never shows anything the model didn't compute.

## 9. Uncertainty (`montecarlo.ts`)

Sampled multipliers (expectation 1 unless noted): dose ×lognormal(σ=0.5),
SEU ×logn(0.6), hard AFR ×logn(0.35), coating drift ×U(0.7,1.5), array
degradation ×logn(0.3), TID hardness ×logn(0.25), solar phase ~U(0,2π).
Each run is a full sampled mission; one seeded mulberry32 stream drives both
draws and missions (bit-reproducible). Outputs: delivered/per-tonne/survivor
distributions with p5/p50/p95 and Spearman rank correlations (the tornado).

## 10. Validation

`npm test` (74 tests): the nine simulator.md acceptance tests (period,
eclipse fraction & β*, Stefan-Boltzmann equilibrium, energy closure, Daly
optimum, DVFS no-limit-cycle, nameplate identity, MC reproducibility,
sdcsim baseline within 2 %), golden-fixture parity against the Python
reference (pinned fast-loop cases at ~1e-9; baseline mission at a 0.5 %
tripwire), and UI-layer suites (slider math, chart marshaling, scene-vs-
physics shadow consistency to 2e-3, histogram/join utilities, JSON round
trip). `node scripts/smoke.mjs` drives the built app in Chrome end-to-end.

## 11. Not modeled (know the boundary)

Atmospheric drag & station-keeping propellant, ADCS/pointing dynamics,
comms/downlink capacity and its power, plasma charging/ESD, launch loads,
thermal gradients within panels, orbital debris *generation*, constellation
networking, and ground segment. Add as slow boundary conditions or separate
budgets before trusting conclusions that depend on them.
