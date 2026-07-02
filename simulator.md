## Mission

Build **OrbitalDC Studio**: a browser-based, interactive 3D physics simulator of a space data center (a GPU compute cluster on a satellite bus). Its purpose is engineering design-space exploration: a user changes design parameters with sliders/numeric inputs and watches the physically-coupled consequences unfold over a 5-year mission — junction temperatures, throttling, battery cycling, radiation damage, node attrition, and ultimately **delivered PFLOP-years per tonne launched**, which is the single figure of merit everything rolls up to.

This is a serious engineering tool, not a game. Physical correctness beats visual polish. Every model must be a documented, defensible reduced-order model with the governing equation and its source in a code comment.

If a `sdcsim/` Python package exists in this repo, treat it as the authoritative physics reference: port its equations, parameter defaults, and sizing rules to the simulation core, and validate the port by reproducing its baseline result (≈147 of 160 PFLOP-yr delivered, ≈3,200 kg, ≈46 PFLOP-yr/tonne for the 550 km dawn-dusk SSO case) to within 2%.

## Tech stack and architecture

- **Vite + React + TypeScript**, Three.js (via react-three-fiber) for the 3D scene.
- **Physics core in pure TypeScript, zero DOM/Three.js imports**, running in a **Web Worker** so the UI holds 60 fps at any time-warp. Message-passing interface: worker consumes a parameter snapshot + time-step commands, emits typed telemetry frames.
- State: zustand (or similar minimal store). Charts: a lightweight canvas plotter or uPlot (avoid heavy chart libs).
- No backend, no database. Everything client-side; designs export/import as JSON.
- Deterministic: a seeded RNG (e.g. mulberry32) for all stochastic processes so runs are reproducible.

## Physics specification

Implement these coupled subsystems. The coupling map is the heart of the simulator:

```
workload → chip power (dynamic + T-dependent leakage) → heat → coolant loop →
radiator (εσT⁴ out; solar/albedo/Earth-IR in) → junction temperature →
DVFS throttle controller → effective FLOPS
        overlays: TID → leakage growth + mortality; SEU → checkpoint tax;
        solar particle events; coating darkening; array degradation;
        thermal-cycling fatigue; random failures; battery fade
```

**1. Orbital mechanics.** Circular orbit propagation (Keplerian period from μ⊕), sun vector from a simple solar ephemeris, beta angle β(t) (seasonal model per orbit class: dawn-dusk SSO ≈ 78°±13°; mid-inclination precessing model for ISS-like), eclipse entry/exit from the cylindrical Earth-shadow condition, eclipse fraction fe(h, β). Optional stretch: J2 nodal precession driving β directly.

**2. Chip / compute.** Per-GPU power P = P_dyn0·f·V(f)² + P_leak0·V·leak_mult·2^((Tj−60)/25) with V(f) = 0.55 + 0.45f; junction temp from stack-up Tj = T_coolant + Rθ,jc·P_gpu (solve the leakage↔Tj fixed point); proportional DVFS controller holding Tj at a setpoint with slew limits; effective FLOPS = n_alive · PFLOPS_nominal · f · (1 − checkpoint_overhead).

**3. Thermal.** Two-node network minimum (coolant loop node, radiator node) integrated with exponential/unconditionally-stable updates (the radiator node is stiff — do NOT use naive explicit Euler on εσT⁴). Radiator rejects εσT⁴ per m² effective area and absorbs environmental fluxes q = ε·F_ir·q_EarthIR + α(t)·(F_alb·a·S + F_sun·S) when illuminated, with view factors depending on orbit/attitude preset. Coating absorptance drifts: α(t) = α_BOL + Δα·(1 − e^(−t/τ)).

**4. Electrical power.** Array power = S·A·η(T_cell)·cosθ·η_PMAD·e^(−k_degr·t), zero in eclipse. Battery with energy state, DoD limit, charge/discharge C-rate caps, round-trip efficiencies, and cycle fade. Load dispatch each step: if array+battery cannot carry the load, bisect the DVFS frequency down to the supportable level; below f_min, drop to idle/safe mode. **Battery sizing must satisfy both the energy constraint (worst eclipse / DoD) and the power constraint (load / max C-rate)** — energy-only sizing is a known trap that silently throttles every eclipse.

**5. Radiation.** TID accumulation behind shielding via a dose-depth power law (calibrate to ≈6 krad/yr behind 1 mm Al at 550 km SSO, ∝ thickness^−1.3 plus a hard floor), modulated by the 11-year solar cycle; leakage multiplier grows with TID; part mortality as a Weibull in accumulated dose. SEU rate per bit-day → uncorrectable error rate → optimal checkpoint interval and overhead via the **Daly model** (τ* = √(2δM); overhead ≈ δ/τ + τ/2M + R/M). Solar particle events as a Poisson process (rate tied to solar activity): during an event, SEU ×~30 and a prompt dose pulse. Destructive latch-up as a small constant hazard.

**6. Reliability & attrition.** Per-GPU hazard = random base rate with Arrhenius acceleration exp(Ea/k·(1/T_ref − 1/Tj)) on the thermally-driven fraction + SEL + MMOD + thermal-cycling fatigue via Coffin–Manson (Nf = Nf_ref·(ΔTj/ΔT_ref)^−m, one cycle per orbit, ΔTj measured from the orbit transient) + the TID Weibull. Support both expected-value propagation (smooth curves) and sampled binomial deaths (Monte Carlo mode).

**7. Sizing & mass budget (closes the design loop).** From the setpoints, size: radiator area from the Tj stack-up (Tj_target − Rθ·P − ΔT_loop → T_rad → net W/m²) with margin; battery (energy AND C-rate); array at EOL including the eclipse-recharge factor; shielding mass from wall thickness × enclosure area; plus IT hardware, structure fraction, fixed bus. Every slider change re-sizes and re-masses the design so **PFLOP-yr/tonne responds live**.

**8. Optional stretch (only after acceptance tests pass):** atmospheric drag + station-keeping propellant vs altitude; comms/downlink duty model; constellation of N identical satellites.

## Multi-rate time integration

- Fast loop: dt = 10–60 s through the orbit (thermal transients, DVFS, battery dispatch).
- Slow loop: degradation epoch every ~2 weeks of sim time (TID, α drift, array fade, attrition, checkpoint-overhead recompute) — the fast loop only needs one steady-periodic orbit per epoch, so a 5-year mission stays interactive.
- Time-warp control from 1× to ~1,000,000× real time; the 3D scene animates the orbit while the physics fast-forwards through epochs.

## Interactive parameters (sliders + numeric entry, grouped, with units, ranges, defaults, and a one-line tooltip explaining the physical trade)

- **Orbit:** altitude 300–1200 km; orbit class preset (dawn-dusk SSO / ISS-like 51.6° / custom β profile).
- **Compute:** GPU count 8–512; TDP 300–1000 W; Tj setpoint 45–95 °C; f_min.
- **Thermal:** radiator area scale 0.5–2×; specific mass 4–16 kg/m²; ε, α_BOL, α drift; view-factor preset; loop ΔT.
- **Power:** cell efficiency 0.25–0.34; array degradation %/yr; battery DoD 0.2–0.6; C-rate caps; battery sizing fraction 0–1 (deliberately allows the bad battery-lean design so its fatigue failure mode is discoverable).
- **Radiation:** shield wall 0.5–10 mm Al-eq; TID hardness (Weibull char dose 5–80 krad); SEU rate scale; solar-cycle phase.
- **Reliability:** base AFR; Ea; Coffin–Manson exponent; checkpoint write/restart times.
- **Mission:** duration 1–10 yr; deterministic vs Monte Carlo (N runs) toggle; RNG seed.

## UI specification

- **3D viewport:** Earth (day/night terminator consistent with the sun vector), orbit trace, spacecraft whose radiator panels and solar wings are **scaled to the actual sized areas** (so oversizing is visible), radiator faces color-mapped by temperature, eclipse shading of the scene, sun direction indicator, β-angle readout.
- **Telemetry strip (live, scrolling):** Tj mean/max, radiator temp, DVFS f, battery SoC, array power vs load, GPUs alive, accumulated TID, checkpoint tax, instantaneous effective PFLOPS. Time axis switchable between orbit-scale and mission-scale.
- **Design panel:** live mass budget (stacked bar), delivered PFLOP-yr projection, PFLOP-yr/tonne headline number with delta-vs-baseline indicator.
- **Event log:** SPE storms, node deaths, safe-mode entries, throttle episodes — clickable to jump the timeline.
- **A/B compare:** pin a design as baseline, overlay a second design's telemetry and outcome.
- **Scenario presets:** (a) 550 km dawn-dusk SSO baseline, (b) ISS-like full battery, (c) ISS-like battery-lean (demonstrates the thermal-cycling fatigue death spiral), (d) solar-storm stress test.
- Time controls: play/pause/step, warp slider, "run to end of mission".

## Validation — write these as automated tests before building UI (vitest)

1. Orbital period at 550 km = 5,739 s ± 1 s; eclipse fraction at h=550 km, β=0 ≈ 0.376 and → 0 above β* = acos(√(2Rh+h²)/(R+h)).
2. Isolated radiator node with constant heat input settles to the analytic Stefan-Boltzmann equilibrium T = (q/(εσ))^0.25 within 0.1 K.
3. Energy conservation: over one steady-periodic orbit, ∫(array − load − losses)dt matches battery ΔSoC to <1%.
4. Daly overhead minimum sits at τ* = √(2δM) numerically.
5. DVFS controller: step the environment flux and confirm Tj returns to setpoint without limit-cycling; f never exceeds bounds.
6. Arrhenius factor at Ea=0.7 eV doubles roughly every ~10 K near 80 °C.
7. With attrition disabled and no eclipse, delivered compute = nameplate exactly.
8. Monte Carlo with fixed seed is bit-reproducible; expected-value mode ≈ MC mean within noise.
9. If `sdcsim/` exists: baseline mission outputs match it within 2%.

## Milestones — commit and demo after each; do not start the next until tests pass

1. **M1 Physics core (no UI):** worker-ready TS modules + all validation tests green; CLI-style run dumps a baseline mission JSON.
2. **M2 Telemetry UI:** parameter panel + live plots driven by the worker; no 3D yet.
3. **M3 3D scene:** Earth/orbit/spacecraft with sized geometry, eclipse, temperature coloring.
4. **M4 Design analytics:** mass budget, per-tonne headline, A/B compare, presets, event log, JSON export/import.
5. **M5 Monte Carlo + polish:** MC mode with histogram + tornado sensitivity chart, README with model documentation and every default's source/assumption.

## Code quality requirements

- Physics functions pure and unit-tested; every equation has a comment naming the law/model and units of every quantity (SI internally; display units at the UI boundary only).
- One `params.ts` schema (zod) defining every parameter with min/max/default/unit/tooltip — the UI generates controls from this schema, so physics and UI can never disagree.
- A `MODEL.md` documenting each subsystem's governing equations, what is reduced-order about it, and what real data would be needed to calibrate it (dose transport, TVAC, beam tests, fleet AFR telemetry).
- No physics in React components. No `any`. No magic numbers outside `params.ts`/`constants.ts`.

## What NOT to do

- Do not fake coupling with scripted animations — every visible effect must come out of the integrated equations.
- Do not use explicit Euler on the radiator node or a single global dt for everything.
- Do not silently clamp unphysical parameter combinations; surface a warning in the design panel instead.
- Do not add orbital-mechanics fidelity (full ephemerides, J2/J4, drag) before M5 — it is not on the critical path to the figure of merit.