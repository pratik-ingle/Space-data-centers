/**
 * Monte Carlo panel: run a seeded ensemble (parameter uncertainties sampled
 * per montecarlo.ts) in the analysis worker, then show the delivered-compute
 * distribution (histogram with p5/p50/p95) and a tornado of Spearman rank
 * correlations — which input uncertainty moves the outcome most.
 */
import { useState } from "react";
import { fmtFixed } from "../format";
import { useStudio } from "../store";
import { histogram } from "../telemetryData";

/** Sample median (each MC run can re-size the design, so derive from the
 *  ensemble's own arrays rather than dividing by the nominal mass). */
function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)] ?? NaN;
}

const BLUE = "#3987e5"; // distribution bars (sequential single hue)
const POS = "#3987e5"; // tornado polarity: correlates up
const NEG = "#e66767"; // tornado polarity: correlates down

function Histogram({
  values,
  p5,
  p50,
  p95,
}: {
  values: number[];
  p5: number;
  p50: number;
  p95: number;
}) {
  const H = 84;
  const W = 272;
  const h = histogram(values, 16);
  const lo = h.edges[0];
  const hi = h.edges[h.edges.length - 1];
  const x = (v: number): number => ((v - lo) / Math.max(hi - lo, 1e-12)) * W;
  const barW = W / h.counts.length;
  return (
    <svg
      viewBox={`0 0 ${W} ${H + 16}`}
      className="mc-hist"
      role="img"
      aria-label="delivered compute distribution"
    >
      {h.counts.map((c, i) => {
        const bh = h.maxCount ? (c / h.maxCount) * (H - 6) : 0;
        return (
          <rect
            key={i}
            x={i * barW + 1}
            y={H - bh}
            width={Math.max(barW - 2, 1)}
            height={bh}
            rx={1.5}
            fill={BLUE}
          >
            <title>
              {fmtFixed(h.edges[i], 1)}–{fmtFixed(h.edges[i + 1], 1)} PFLOP-yr: {c}
            </title>
          </rect>
        );
      })}
      {[
        [p5, "p5"],
        [p50, "p50"],
        [p95, "p95"],
      ].map(([v, label]) => (
        <g key={label as string}>
          <line
            x1={x(v as number)}
            x2={x(v as number)}
            y1={2}
            y2={H}
            stroke="#c3c2b7"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
          <text
            x={x(v as number)}
            y={H + 12}
            textAnchor="middle"
            className="mc-marker-label"
          >
            {label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Tornado({ sens }: { sens: Record<string, number> }) {
  const rows = Object.entries(sens).sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1]),
  );
  return (
    <div className="mc-tornado">
      {rows.map(([label, rho]) => (
        <div className="mc-trow" key={label} title={`Spearman ρ = ${rho.toFixed(3)}`}>
          <span className="mc-tlabel">{label}</span>
          <span className="mc-tbar">
            <i className="mc-tzero" />
            <i
              className="mc-tfill"
              style={{
                width: `${Math.min(Math.abs(rho), 1) * 50}%`,
                background: rho >= 0 ? POS : NEG,
                left: rho >= 0 ? "50%" : `${50 - Math.min(Math.abs(rho), 1) * 50}%`,
              }}
            />
          </span>
          <span className="mc-tval">{rho >= 0 ? "+" : "−"}{Math.abs(rho).toFixed(2)}</span>
        </div>
      ))}
      <div className="mc-tnote">
        Spearman ρ of each sampled uncertainty with delivered PFLOP-yr
      </div>
    </div>
  );
}

export function McPanel() {
  const mcRunning = useStudio((s) => s.mcRunning);
  const mcDone = useStudio((s) => s.mcDone);
  const mcTotal = useStudio((s) => s.mcTotal);
  const result = useStudio((s) => s.mcResult);
  const runs = useStudio((s) => s.cfg.mission.mc_runs);
  const seed = useStudio((s) => s.cfg.mission.seed);
  const runMc = useStudio((s) => s.runMc);
  const setParam = useStudio((s) => s.setParam);
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <section className="dp-section">
      <h3>Monte Carlo</h3>
      <div className="mc-controls">
        <button onClick={runMc} disabled={mcRunning}>
          {mcRunning ? `running ${mcDone}/${mcTotal}…` : `run ${runs} missions`}
        </button>
        <label className="mc-runs" title="Ensemble size (mission.mc_runs)">
          N
          <input
            type="text"
            inputMode="numeric"
            value={draft ?? String(runs)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== null) {
                const x = Number(draft);
                if (Number.isFinite(x)) {
                  setParam("mission.mc_runs", Math.max(10, Math.min(1000, Math.round(x))));
                }
                setDraft(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
      </div>
      {mcRunning ? (
        <div className="mc-progress">
          <i style={{ width: `${mcTotal ? (100 * mcDone) / mcTotal : 0}%` }} />
        </div>
      ) : null}
      {result ? (
        <div className="mc-results">
          <div className="mc-stats">
            <span>
              p5 <b>{fmtFixed(result.p5, 1)}</b>
            </span>
            <span>
              p50 <b>{fmtFixed(result.p50, 1)}</b>
            </span>
            <span>
              p95 <b>{fmtFixed(result.p95, 1)}</b>
            </span>
            <span className="mc-unit">PFLOP-yr delivered (seed {seed})</span>
          </div>
          <Histogram
            values={result.delivered}
            p5={result.p5}
            p50={result.p50}
            p95={result.p95}
          />
          <div className="mc-stats">
            <span>
              per tonne p50 <b>{fmtFixed(median(result.per_tonne), 1)}</b>
            </span>
            <span>
              survivors p50 <b>{fmtFixed(median(result.survivors), 0)}</b>
            </span>
          </div>
          <Tornado sens={result.sensitivity} />
        </div>
      ) : mcRunning ? null : (
        <div className="mc-hint">
          Samples dose/SEU/AFR/coating/array/TID-hardness uncertainties and the
          solar-cycle phase; each run is a full sampled mission from the fixed
          seed (bit-reproducible).
        </div>
      )}
    </section>
  );
}
