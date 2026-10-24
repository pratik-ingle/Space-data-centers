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

const REPO_URL = "https://github.com/pratik-ingle/Space-data-centers";

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
        <a
          className="header-link"
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          title="Source code, model docs and the Python reference on GitHub"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
          GitHub
        </a>
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
