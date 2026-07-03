/**
 * OrbitalDC Studio shell. Layout: header (projection headline), left
 * parameter panel, main telemetry column, transport bar. The 3D viewport
 * slots into the main column in M3; design analytics expand in M4.
 */
import { useEffect } from "react";
import { fmtFixed } from "./format";
import { bootStudio, useStudio } from "./store";
import { ChartsPanel } from "./components/Charts";
import { ParamPanel } from "./components/ParamPanel";
import { Viewport } from "./components/Scene";
import { TelemetryStrip } from "./components/TelemetryStrip";
import { TimeControls } from "./components/TimeControls";

function Header() {
  const projection = useStudio((s) => s.projection);
  const projecting = useStudio((s) => s.projecting);
  const name = useStudio((s) => s.cfg.name);
  const massKg = useStudio((s) => s.design.mass_total_kg);
  const resetCfg = useStudio((s) => s.resetCfg);

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-name">OrbitalDC Studio</span>
        <span className="brand-sub">{name}</span>
      </div>
      <div className={projecting ? "headline dim" : "headline"}>
        <span className="headline-item">
          <b>{fmtFixed(massKg, 0)}</b> kg
        </span>
        <span className="headline-item">
          <b>{projection ? fmtFixed(projection.delivered_pflop_yr, 1) : "–"}</b>{" "}
          PFLOP-yr
        </span>
        <span className="headline-item headline-fom" title="The figure of merit">
          <b>{projection ? fmtFixed(projection.per_tonne, 1) : "–"}</b>{" "}
          PFLOP-yr/t
        </span>
      </div>
      <button className="ghost" onClick={resetCfg} title="Restore baseline design">
        reset
      </button>
    </header>
  );
}

function WarningsBar() {
  const warnings = useStudio((s) => s.warnings);
  if (!warnings.length) return null;
  return (
    <div className="warnings">
      {warnings.map((w, i) => (
        <span key={i} className={`chip chip-${w.severity}`}>
          {w.severity === "crit" ? "⛔" : w.severity === "warn" ? "⚠" : "ⓘ"}{" "}
          {w.message}
        </span>
      ))}
    </div>
  );
}

export function App() {
  useEffect(() => {
    bootStudio();
  }, []);

  return (
    <div className="app">
      <Header />
      <div className="body">
        <aside className="sidebar">
          <ParamPanel />
        </aside>
        <main className="main">
          <WarningsBar />
          <Viewport />
          <TelemetryStrip />
          <ChartsPanel />
        </main>
      </div>
      <TimeControls />
    </div>
  );
}
