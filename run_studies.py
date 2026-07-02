"""Run the full study suite and produce figures + a results summary.

Studies
  A  baseline 5-yr mission timeline (dawn-dusk SSO, 32x H100-class, 40 kW-IT)
  B  single-orbit thermal/power transient: DD-SSO vs ISS-like eclipse orbit
  C  radiator-area sweep -> delivered compute & PFLOP-yr/tonne knee
  D  junction-temperature setpoint sweep (radiator resized per setpoint)
  E  shielding-thickness sweep -> dose vs mass optimum
  F  orbit/architecture comparison bars
  G  Monte-Carlo uncertainty + sensitivity ranking
  H  loss waterfall for the baseline
"""
import copy
import time
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sdcsim import baseline_dd, iss_like, run_mission, summarize, size_design
from sdcsim.orbitloop import ThermalState, simulate_orbit
from sdcsim.montecarlo import run_monte_carlo
from sdcsim.environment import worst_eclipse_fraction

OUT = "/home/claude/figs"
import os
os.makedirs(OUT, exist_ok=True)
plt.rcParams.update({"figure.dpi": 130, "font.size": 9,
                     "axes.grid": True, "grid.alpha": 0.3})
LOG = []


def log(s=""):
    print(s)
    LOG.append(s)


# ----------------------------------------------------------------- A: baseline
t0 = time.time()
cfg0 = baseline_dd()
res0 = run_mission(cfg0)
log(summarize(res0)); log()
H = res0.hist

fig, ax = plt.subplots(3, 2, figsize=(10, 8), sharex=True)
t = H["t_yr"]
ax[0, 0].plot(t, H["f_mean"], color="C0")
ax[0, 0].set_ylabel("mean DVFS clock f")
ax[0, 0].set_ylim(0, 1.05)
ax[0, 1].plot(t, H["tj_mean"], label="Tj mean", color="C3")
ax[0, 1].plot(t, H["tj_max"], label="Tj orbit-max", color="C3", ls="--", lw=0.8)
ax[0, 1].axhline(cfg0.chip.tj_target_c, color="k", lw=0.6, ls=":")
ax[0, 1].set_ylabel("junction temp (C)"); ax[0, 1].legend(fontsize=7)
ax[1, 0].plot(t, H["n_alive"], color="C2")
ax[1, 0].set_ylabel("GPUs alive (expected)")
ax[1, 1].plot(t, H["tid_krad"], color="C4")
ax[1, 1].set_ylabel("TID behind shield (krad)")
ax2 = ax[1, 1].twinx(); ax2.plot(t, H["leak_mult"], color="C5", lw=0.8)
ax2.set_ylabel("leakage multiplier", color="C5"); ax2.grid(False)
ax[2, 0].plot(t, H["p_arr_kw"], label="array power avail", color="C1")
ax[2, 0].plot(t, H["load_kw"], label="design bus load", color="k", lw=0.7, ls="--")
ax[2, 0].set_ylabel("kW"); ax[2, 0].legend(fontsize=7)
ax[2, 0].set_xlabel("mission time (yr)")
ax[2, 1].plot(t, 100 * H["ovh"], color="C6")
ax[2, 1].set_ylabel("checkpoint tax (%)")
ax[2, 1].set_xlabel("mission time (yr)")
for a in ax.flat:
    a.margins(x=0.01)
fig.suptitle("A. Baseline 5-yr mission — 32x H100-class, 40 kW-IT, 550 km dawn-dusk SSO",
             fontsize=10)
fig.tight_layout()
fig.savefig(f"{OUT}/A_baseline_timeline.png"); plt.close(fig)
log(f"[A done {time.time()-t0:.1f}s]")

# ------------------------------------------------- B: orbit transient DD vs ISS
t0 = time.time()
fig, ax = plt.subplots(2, 3, figsize=(12.5, 6), sharex="col")
for col, (cfg, label) in enumerate([(baseline_dd(), "dawn-dusk SSO (550 km)"),
                                    (iss_like(1.0), "51.6 deg / 420 km, full battery"),
                                    (iss_like(0.35), "51.6 deg / 420 km, battery 35%")]):
    dz = size_design(cfg)
    st = ThermalState(cfg, dz)
    fe = worst_eclipse_fraction(cfg.orbit)
    env = {"fe": fe, "p_arr_w": dz.arr_p_bol_w * cfg.eps.pmad_eff,
           "alpha": cfg.thermal.rad_alpha_bol + 0.05,
           "leak_mult": 1.05, "n_alive": float(cfg.chip.n_gpu),
           "tj_target_c": cfg.chip.tj_target_c}
    tr = {}
    m = simulate_orbit(cfg, dz, env, st, n_orbits=5.0, trace=tr)
    tm = np.array(tr["t_min"]); ill = np.array(tr["illum"])
    for a in (ax[0, col], ax[1, col]):
        a.fill_between(tm, 0, 1, where=ill < 0.5, color="0.85",
                       transform=a.get_xaxis_transform(), lw=0)
    ax[0, col].plot(tm, tr["tj"], color="C3", label="Tj")
    ax[0, col].plot(tm, tr["t_cool_c"], color="C0", label="coolant")
    ax[0, col].plot(tm, tr["t_rad_c"], color="C2", label="radiator")
    ax[0, col].set_title(f"{label}\nworst eclipse fe={fe:.2f}, "
                         f"dTj/orbit={m['dtj_cycle']:.1f} K", fontsize=8.5)
    ax[0, col].legend(fontsize=7, loc="lower left")
    ax[1, col].plot(tm, tr["f"], color="C0", label="clock f")
    ax[1, col].plot(tm, tr["soc_frac"], color="C1", label="battery SoC")
    ax[1, col].set_ylim(-0.02, 1.05); ax[1, col].set_xlabel("time in orbit (min)")
    ax[1, col].legend(fontsize=7, loc="lower left")
ax[0, 0].set_ylabel("temperature (C)")
ax[1, 0].set_ylabel("fraction")
fig.suptitle("B. Single-orbit transients at worst-case eclipse (shaded = shadow)",
             fontsize=10)
fig.tight_layout()
fig.savefig(f"{OUT}/B_orbit_transient.png"); plt.close(fig)
log(f"[B done {time.time()-t0:.1f}s]")

# --------------------------------------------------------- C: radiator sweep
t0 = time.time()
scales = np.array([0.55, 0.65, 0.75, 0.85, 0.95, 1.0, 1.1, 1.25, 1.4, 1.6])
dels, pts, fmeans = [], [], []
for s in scales:
    c = baseline_dd(); c.thermal.rad_area_scale = float(s)
    r = run_mission(c)
    dels.append(r.delivered_pflop_yr); pts.append(r.per_tonne)
    fmeans.append(r.hist["f_mean"].mean())
fig, ax1 = plt.subplots(figsize=(6.4, 4.2))
ax1.plot(scales, dels, "o-", color="C0")
ax1.set_xlabel("radiator area / thermally-sized area")
ax1.set_ylabel("delivered compute (PFLOP-yr)", color="C0")
ax1.axhline(res0.nameplate_pflop_yr, color="k", lw=0.6, ls=":")
ax1.text(scales[0], res0.nameplate_pflop_yr, " nameplate", fontsize=7, va="bottom")
ax2 = ax1.twinx()
ax2.plot(scales, pts, "s--", color="C1")
ax2.set_ylabel("PFLOP-yr per tonne launched", color="C1"); ax2.grid(False)
k = int(np.argmax(pts))
ax2.annotate(f"mass-efficiency knee\n({scales[k]:.2f}x, {pts[k]:.1f}/t)",
             (scales[k], pts[k]), textcoords="offset points", xytext=(10, -28),
             fontsize=7, arrowprops=dict(arrowstyle="->", lw=0.7))
ax1.set_title("C. Radiator sizing: undersize throttles, oversize wastes mass",
              fontsize=9)
fig.tight_layout()
fig.savefig(f"{OUT}/C_radiator_sweep.png"); plt.close(fig)
log(f"[C done {time.time()-t0:.1f}s]  knee at {scales[k]:.2f}x -> {pts[k]:.1f} PFLOP-yr/t")

# ------------------------------------------------------ D: Tj setpoint sweep
t0 = time.time()
tjs = np.arange(47, 91, 3)
series = {}
for rkg, lab, col in [(6.0, "lightweight radiator (6 kg/m2)", "C1"),
                      (14.0, "heavy radiator (14 kg/m2)", "C4")]:
    pts_, arad_, alive_ = [], [], []
    for tj in tjs:
        c = baseline_dd()
        c.thermal.rad_kg_m2 = rkg
        c.chip.tj_target_c = float(tj); c.chip.tj_max_c = float(tj) + 7.0
        r = run_mission(c)
        pts_.append(r.per_tonne); arad_.append(r.design.a_rad_phys)
        alive_.append(r.hist["n_alive"][-1])
    series[rkg] = (lab, col, pts_, arad_, alive_)
fig, ax1 = plt.subplots(figsize=(6.8, 4.2))
for rkg, (lab, col, pts_, _, _) in series.items():
    ax1.plot(tjs, pts_, "o-", color=col, label=lab, ms=3.5)
    j = int(np.argmax(pts_))
    ax1.annotate(f"opt ~{tjs[j]} C", (tjs[j], pts_[j]),
                 textcoords="offset points", xytext=(-6, 7), fontsize=7, color=col)
ax1.set_xlabel("junction-temperature setpoint (C)")
ax1.set_ylabel("PFLOP-yr per tonne")
ax1.legend(fontsize=7, loc="center right")
ax2 = ax1.twinx(); ax2.grid(False)
ax2.plot(tjs, series[6.0][3], "s--", color="C2", lw=0.8, ms=3,
         label="radiator area (m2)")
ax2.set_ylabel("radiator area (m2)", color="C2")
ax1.set_title("D. Run hot (small radiator, T^4) vs run cool (reliability, leakage)\n"
              "optimum shifts hot as radiator specific mass rises", fontsize=9)
fig.tight_layout()
fig.savefig(f"{OUT}/D_tj_setpoint.png"); plt.close(fig)
jl = int(np.argmax(series[6.0][2])); jh = int(np.argmax(series[14.0][2]))
log(f"[D done {time.time()-t0:.1f}s]  Tj optimum ~{tjs[jl]} C @6kg/m2, "
    f"~{tjs[jh]} C @14kg/m2 (shallow trade)")

# --------------------------------------------------------- E: shielding sweep
t0 = time.time()
shs = np.array([0.8, 1.5, 2.0, 3.0, 4.0, 5.0, 7.0])
e_del, e_pt, e_surv, e_mass = [], [], [], []
for s in shs:
    c = baseline_dd(); c.rad.shield_mm = float(s)
    r = run_mission(c)
    e_del.append(r.delivered_pflop_yr); e_pt.append(r.per_tonne)
    e_surv.append(r.hist["n_alive"][-1]); e_mass.append(r.design.masses["shielding"])
fig, ax1 = plt.subplots(figsize=(6.4, 4.2))
ax1.plot(shs, e_pt, "o-", color="C1")
ax1.set_xlabel("enclosure shielding, Al-equivalent (mm)")
ax1.set_ylabel("PFLOP-yr per tonne", color="C1")
ax2 = ax1.twinx(); ax2.grid(False)
ax2.plot(shs, e_surv, "^--", color="C3", label="GPUs alive at EOL")
ax2.plot(shs, np.array(e_mass) / 10.0, "s--", color="C7", label="shield mass (x10 kg)")
ax2.set_ylabel("survivors  /  shield mass"); ax2.legend(fontsize=7)
j = int(np.argmax(e_pt))
ax1.annotate(f"optimum ~{shs[j]:.1f} mm wall\n(+{cfg0.rad.shield_intrinsic_mm:.1f} mm intrinsic)",
             (shs[j], e_pt[j]),
             textcoords="offset points", xytext=(8, -22), fontsize=8,
             arrowprops=dict(arrowstyle="->", lw=0.7))
ax1.set_title("E. Shielding: thin = TID death, thick = dead launch mass", fontsize=9)
fig.tight_layout()
fig.savefig(f"{OUT}/E_shield_sweep.png"); plt.close(fig)
log(f"[E done {time.time()-t0:.1f}s]  shield optimum ~{shs[j]:.1f} mm")

# ------------------------------------------------------ F: orbit comparison
t0 = time.time()
cases = [("dawn-dusk SSO\n550 km", baseline_dd()),
         ("51.6deg 420 km\nfull battery", iss_like(1.0)),
         ("51.6deg 420 km\nbattery 35% (idle in eclipse)", iss_like(0.35))]
labels, f_del, f_pt, f_mass = [], [], [], []
for name, c in cases:
    r = run_mission(c)
    labels.append(name); f_del.append(r.delivered_pflop_yr)
    f_pt.append(r.per_tonne); f_mass.append(r.design.mass_total_kg / 1000.0)
    log(f"  {name.replace(chr(10), ' | ')}: {r.delivered_pflop_yr:.1f} PFLOP-yr, "
        f"{r.design.mass_total_kg:,.0f} kg, {r.per_tonne:.1f} /t")
x = np.arange(3)
fig, ax = plt.subplots(1, 3, figsize=(10, 3.6))
for a, v, ttl, col in [(ax[0], f_del, "delivered PFLOP-yr", "C0"),
                       (ax[1], f_mass, "launch mass (t)", "C7"),
                       (ax[2], f_pt, "PFLOP-yr per tonne", "C1")]:
    a.bar(x, v, color=col, width=0.6)
    a.set_xticks(x); a.set_xticklabels(labels, fontsize=7)
    a.set_title(ttl, fontsize=9)
    for xi, vi in zip(x, v):
        a.text(xi, vi, f"{vi:.1f}", ha="center", va="bottom", fontsize=8)
fig.suptitle("F. Orbit & energy-storage architecture comparison", fontsize=10)
fig.tight_layout()
fig.savefig(f"{OUT}/F_orbit_comparison.png"); plt.close(fig)
log(f"[F done {time.time()-t0:.1f}s]")

# ------------------------------------------------------------ G: Monte Carlo
t0 = time.time()
mc = run_monte_carlo(baseline_dd(), n_runs=200, seed=11)
fig, ax = plt.subplots(1, 2, figsize=(10, 3.8))
ax[0].hist(mc["delivered"], bins=28, color="C0", alpha=0.85)
for p, ls in [("p5", "--"), ("p50", "-"), ("p95", "--")]:
    ax[0].axvline(mc[p], color="k", lw=0.8, ls=ls)
ax[0].axvline(res0.nameplate_pflop_yr, color="C3", lw=0.8, ls=":")
ax[0].text(res0.nameplate_pflop_yr, ax[0].get_ylim()[1] * 0.95, "nameplate ",
           ha="right", fontsize=7, color="C3")
ax[0].set_xlabel("delivered compute (PFLOP-yr)"); ax[0].set_ylabel("runs")
ax[0].set_title(f"200 stochastic missions: p5={mc['p5']:.0f} | p50={mc['p50']:.0f} "
                f"| p95={mc['p95']:.0f}", fontsize=9)
sens = dict(sorted(mc["sensitivity"].items(), key=lambda kv: abs(kv[1])))
ax[1].barh(list(sens.keys()), list(sens.values()),
           color=["C3" if v < 0 else "C2" for v in sens.values()])
ax[1].axvline(0, color="k", lw=0.6)
ax[1].set_xlabel("rank correlation with delivered compute")
ax[1].set_title("what uncertainty hurts most", fontsize=9)
fig.suptitle("G. Uncertainty quantification over environment & model parameters",
             fontsize=10)
fig.tight_layout()
fig.savefig(f"{OUT}/G_montecarlo.png"); plt.close(fig)
log(f"[G done {time.time()-t0:.1f}s]  p5/p50/p95 = "
    f"{mc['p5']:.0f}/{mc['p50']:.0f}/{mc['p95']:.0f} PFLOP-yr")
for k, v in sorted(mc["sensitivity"].items(), key=lambda kv: -abs(kv[1])):
    log(f"    sensitivity {k:>16s}: {v:+.2f}")

# ------------------------------------------------------------- H: waterfall
t0 = time.time()
steps = [("nameplate", res0.nameplate_pflop_yr)]
run = res0.nameplate_pflop_yr
for k, v in res0.losses.items():
    steps.append((k, -v)); run -= v
steps.append(("delivered", res0.delivered_pflop_yr))
fig, ax = plt.subplots(figsize=(7.2, 4))
cum = 0.0
for i, (name, v) in enumerate(steps):
    if i == 0 or i == len(steps) - 1:
        ax.bar(i, v, color="C0", width=0.62)
        ax.text(i, v, f"{v:.1f}", ha="center", va="bottom", fontsize=8)
        cum = v if i == 0 else cum
    else:
        ax.bar(i, v, bottom=cum, color="C3", width=0.62)
        ax.text(i, cum + v / 2, f"{v:.1f}", ha="center", va="center",
                fontsize=8, color="w")
        cum += v
ax.set_xticks(range(len(steps)))
ax.set_xticklabels([s[0].replace(" (", "\n(") for s in steps], fontsize=7)
ax.set_ylabel("PFLOP-yr over 5-yr mission")
ax.set_title("H. Where the compute goes — baseline loss waterfall", fontsize=9)
fig.tight_layout()
fig.savefig(f"{OUT}/H_loss_waterfall.png"); plt.close(fig)
log(f"[H done {time.time()-t0:.1f}s]")

with open(f"{OUT}/results_summary.txt", "w") as f:
    f.write("\n".join(LOG) + "\n")
log("\nAll studies complete.")
