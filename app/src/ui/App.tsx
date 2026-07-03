/**
 * OrbitalDC Studio shell. Header: presets + design JSON export/import.
 * Left: schema-driven parameter panel. Center: 3D viewport, telemetry
 * strip, charts. Right: design analytics (mass budget, figure of merit
 * with A/B delta, warnings, event log). Bottom: transport bar.
 */
import { useEffect, useRef } from "react";
import { PRESETS } from "../core";
import { bootStudio, useStudio } from "./store";
import { ChartsPanel } from "./components/Charts";
import { DesignPanel } from "./components/DesignPanel";
import { ParamPanel } from "./components/ParamPanel";
import { Viewport } from "./components/Scene";
import { TelemetryStrip } from "./components/TelemetryStrip";
import { TimeControls } from "./components/TimeControls";

function Header() {
  const name = useStudio((s) => s.cfg.name);
  const presetId = useStudio((s) => s.presetId);
  const applyPreset = useStudio((s) => s.applyPreset);
  const resetCfg = useStudio((s) => s.resetCfg);
  const exportJson = useStudio((s) => s.exportJson);
  const importJson = useStudio((s) => s.importJson);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const doExport = (): void => {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || "design"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = (file: File): void => {
    file
      .text()
      .then((text) => {
        try {
          importJson(text);
        } catch (e) {
          window.alert(`Import failed:\n${e instanceof Error ? e.message : String(e)}`);
        }
      })
      .catch(() => window.alert("Could not read the file."));
  };

  const active = PRESETS.find((p) => p.id === presetId);

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-name">OrbitalDC Studio</span>
        <span className="brand-sub">{name}</span>
      </div>
      <select
        className="preset-select"
        value={presetId}
        title={active?.description ?? "Modified design (start from a preset)"}
        onChange={(e) => {
          if (e.target.value !== "custom") applyPreset(e.target.value);
        }}
      >
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id} title={p.description}>
            {p.label}
          </option>
        ))}
        <option value="custom" disabled>
          custom (edited)
        </option>
      </select>
      <div className="header-actions">
        <button className="ghost" onClick={doExport} title="Download this design as JSON">
          export
        </button>
        <button
          className="ghost"
          onClick={() => fileRef.current?.click()}
          title="Load a design JSON (validated against the parameter schema)"
        >
          import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) doImport(f);
            e.target.value = "";
          }}
        />
        <button className="ghost" onClick={resetCfg} title="Restore baseline design">
          reset
        </button>
      </div>
    </header>
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
          <Viewport />
          <TelemetryStrip />
          <ChartsPanel />
        </main>
        <DesignPanel />
      </div>
      <TimeControls />
    </div>
  );
}
