# sdcsim — a reduced-order multiphysics simulator for orbital data centers

Pure-Python (numpy + matplotlib) simulator implementing the core coupling loop
of a space data center:

```
workload -> chip power (dyn + T-dependent leakage) -> heat -> coolant loop ->
radiator (T^4 to space, env fluxes in) -> junction temp -> DVFS throttle ->
effective FLOPS
```

with slow overlays for radiation (TID -> leakage & Weibull mortality; SEE ->
checkpoint tax; SPE storms), coating alpha drift, solar-array degradation,
thermal-cycling fatigue (Coffin–Manson), random hard failures (Arrhenius), and
MMOD — all driven by orbit geometry (beta angle, eclipse), and the 11-year
solar cycle.

## Architecture (multi-rate, per checklist Section 10)

| layer | timescale | method |
|---|---|---|
| orbit transient loop (`orbitloop.py`) | 30 s steps, ~95 min orbit | 2-node thermal network (coolant, radiator) with exponential unconditionally-stable updates; quasi-static junction (fixed-point in leakage); proportional DVFS controller; battery dispatch with bisection power cap |
| degradation epochs (`mission.py`) | ~2 weeks | TID, alpha drift, array fade, attrition hazards, checkpoint overhead (Daly optimal-interval model), SPE Poisson events |
| uncertainty (`montecarlo.py`) | mission ensemble | lognormal/uniform multipliers on dose, SEU, AFR, TID hardness, coating & array degradation + random solar phase; Spearman sensitivity |

Design sizing (`design.py`) closes the loop from setpoints to launch mass:
radiator area from the Tj stack-up (Tj − Rθ·P − ΔT_loop → T_rad → net W/m²),
battery from worst eclipse (energy *and* C-rate constraints), array sized EOL
with eclipse-recharge factor, then a full mass budget so every setpoint sweep
propagates into PFLOP-yr **per tonne** — the real figure of merit.

## Quick start

```bash
pip install numpy matplotlib
python run_studies.py         # all studies, figures -> figs/
```

```python
from sdcsim import baseline_dd, run_mission, summarize
print(summarize(run_mission(baseline_dd())))
```

Baseline: 32× H100-class GPUs (40 kW-IT), 550 km dawn-dusk SSO, 5-yr mission.
`iss_like()` gives a 51.6°/420 km comparison; `batt_sizing_frac` sets how much
of the bus load the battery carries in eclipse.

## Studies produced

- **A** baseline 5-yr timeline (clock, Tj, attrition, TID/leakage, power, checkpoint tax)
- **B** single-orbit transients: DD-SSO vs eclipse orbit vs battery-lean (idle & cold-soak)
- **C** radiator-area sweep → mass-efficiency knee
- **D** Tj setpoint sweep at two radiator specific masses (T⁴ vs Arrhenius trade)
- **E** shielding sweep (TID mortality vs launch mass)
- **F** orbit/energy-storage architecture bars
- **G** 200-run Monte Carlo + sensitivity ranking
- **H** loss waterfall (throttle / attrition / checkpoint tax)

## Model boundaries & calibration needs (be honest about these)

Every default in `params.py` is order-of-magnitude, calibrated to public
sources; the *structure* is the point. To make numbers mission-grade, replace:

1. **Dose & SEE rates** (`radiation.py` power-law) with SPENVIS/OMERE +
   GEANT4/MULASSIS transport for the actual orbit and enclosure geometry, and
   with proton/heavy-ion beam-test cross-sections for the actual GPU + HBM
   (HBM is the soft spot — checklist Section 2).
2. **TID-to-failure Weibull** (char 26 krad, shape 3.2) with measured COTS GPU
   TID data; publicly reported failures range ~5–50 krad, hence the wide MC prior.
3. **Thermal network** anchored to TVAC test of the coldplate/loop/radiator
   stack; the 2-node ROM should be regressed against a SINDA/ESATAN model.
4. **View factors** (`f_ir`, `f_alb`, `f_sun`) from ray-traced radiative
   geometry per attitude profile; here they are static presets per orbit class.
5. **Reliability priors** (AFR 2 %/yr, Ea 0.7 eV, Coffin–Manson constants,
   SEL rate) against fleet telemetry / vendor FIT data.
6. Not modeled at this tier: ADCS/pointing dynamics, drag & station-keeping
   propellant, comms/downlink capacity, plasma charging, launch loads,
   distributed multi-satellite networking. Add as slow boundary conditions or
   separate budgets before trusting constellation-scale conclusions.

## File map

```
sdcsim/constants.py    physical constants
sdcsim/params.py       all knobs + baseline configs
sdcsim/environment.py  orbit period, beta angle, eclipse fraction, solar cycle
sdcsim/radiation.py    dose rate, SPE rate, uncorrectable-error rate, Daly overhead
sdcsim/design.py       power model, sizing rules, mass budget
sdcsim/orbitloop.py    fast coupled thermal<->power<->DVFS loop
sdcsim/mission.py      epoch loop, degradation, attrition, loss accounting
sdcsim/montecarlo.py   uncertainty ensemble + sensitivity
run_studies.py         study suite A–H
```
