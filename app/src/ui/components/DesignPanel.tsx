/**
 * Design analytics panel: the live figure of merit with delta vs the pinned
 * baseline, the mass budget as a stacked bar (2px surface gaps per segment),
 * the loss waterfall from nameplate to delivered, sizing readouts, design
 * warnings, and the clickable event log (jump the timeline to any event).
 */
import { useEffect, useRef } from "react";
import { SECONDS_PER_YEAR } from "../../core/constants";
import type { MissionEvent } from "../../core/mission";
import { fmtFixed, fmtPct } from "../format";
import { useStudio } from "../store";
import { McPanel } from "./McPanel";

/** Fixed mass-item colors (categorical slots; identity never re-ranked). */
const MASS_COLORS: Record<string, string> = {
  "IT hardware": "#3987e5",
  "radiator+loop": "#199e70",
  "solar array": "#c98500",
  battery: "#008300",
  shielding: "#9085e9",
  "structure+mech": "#d55181",
  "bus (ADCS/comms/prop)": "#d95926",
};

function Headline() {
  const projection = useStudio((s) => s.projection);
  const projecting = useStudio((s) => s.projecting);
  const pinned = useStudio((s) => s.pinned);
  const pinning = useStudio((s) => s.pinning);
  const pinBaseline = useStudio((s) => s.pinBaseline);
  const unpin = useStudio((s) => s.unpin);

  const fom = projection?.per_tonne ?? null;
  const ref = pinned?.summary.per_tonne ?? null;
  const delta = fom !== null && ref !== null ? fom - ref : null;
  const deltaPct = delta !== null && ref ? (100 * delta) / ref : null;

  return (
    <section className="dp-headline">
      <div className={projecting ? "dp-fom dim" : "dp-fom"}>
        <span className="dp-fom-value">{fom === null ? "–" : fmtFixed(fom, 1)}</span>
        <span className="dp-fom-unit">PFLOP-yr / tonne</span>
        {delta !== null ? (
          <span
            className={delta >= 0 ? "dp-delta up" : "dp-delta down"}
            title={`vs pinned "${pinned?.name}" (${fmtFixed(ref, 1)})`}
          >
            {delta >= 0 ? "▲" : "▼"} {fmtFixed(Math.abs(delta), 1)} (
            {fmtFixed(Math.abs(deltaPct ?? 0), 1)}%)
          </span>
        ) : null}
      </div>
      <div className="dp-sub">
        {projection ? (
          <>
            delivered <b>{fmtFixed(projection.delivered_pflop_yr, 1)}</b> of{" "}
            {fmtFixed(projection.nameplate_pflop_yr, 0)} PFLOP-yr (
            {fmtPct(projection.utilization, 1)}) ·{" "}
            <b>{fmtFixed(projection.mass_total_kg, 0)}</b> kg
          </>
        ) : (
          "projecting…"
        )}
      </div>
      <div className="dp-pinrow">
        {pinned ? (
          <>
            <span className="dp-pinname" title={pinned.name}>
              baseline: {pinned.name} · {fmtFixed(pinned.summary.per_tonne, 1)}/t
            </span>
            <button className="ghost" onClick={unpin}>
              unpin
            </button>
          </>
        ) : (
          <button onClick={pinBaseline} disabled={pinning} title="Snapshot this design as the A/B baseline: its expected telemetry overlays the mission charts">
            {pinning ? "pinning…" : "pin as baseline"}
          </button>
        )}
      </div>
    </section>
  );
}

function MassBudget() {
  const design = useStudio((s) => s.design);
  const items = Object.entries(design.masses);
  const total = design.mass_total_kg;
  return (
    <section className="dp-section">
      <h3>Mass budget · kg</h3>
      <div className="massbar" role="img" aria-label="mass budget stacked bar">
        {items.map(([k, v]) => (
          <i
            key={k}
            title={`${k}: ${v.toFixed(0)} kg (${((100 * v) / total).toFixed(1)}%)`}
            style={{
              width: `${(100 * v) / total}%`,
              background: MASS_COLORS[k] ?? "#898781",
            }}
          />
        ))}
      </div>
      <div className="dp-rows">
        {items.map(([k, v]) => (
          <div className="dp-row" key={k}>
            <i className="swatch" style={{ background: MASS_COLORS[k] ?? "#898781" }} />
            <span className="dp-row-label">{k}</span>
            <span className="dp-row-val">
              {v.toFixed(0)} <em>({((100 * v) / total).toFixed(0)}%)</em>
            </span>
          </div>
        ))}
        <div className="dp-row dp-total">
          <i className="swatch" style={{ background: "transparent" }} />
          <span className="dp-row-label">total</span>
          <span className="dp-row-val">{total.toFixed(0)}</span>
        </div>
      </div>
    </section>
  );
}

function Losses() {
  const projection = useStudio((s) => s.projection);
  if (!projection) return null;
  const entries = Object.entries(projection.losses);
  const nameplate = projection.nameplate_pflop_yr;
  return (
    <section className="dp-section">
      <h3>Losses · PFLOP-yr</h3>
      <div className="dp-rows">
        {entries.map(([k, v]) => (
          <div className="dp-row" key={k}>
            <span className="dp-row-label">{k}</span>
            <span className="dp-row-val">−{fmtFixed(v, 1)}</span>
            <i
              className="lossbar"
              style={{ width: `${Math.min(100, (100 * v) / nameplate)}%` }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function Sizing() {
  const design = useStudio((s) => s.design);
  return (
    <section className="dp-section">
      <h3>Sized subsystems</h3>
      <div className="dp-grid">
        <span>radiator</span>
        <b>
          {fmtFixed(design.a_rad_phys, 1)} m² <em>({fmtFixed(design.a_rad_eff, 1)} eff</em>)
        </b>
        <span>array</span>
        <b>
          {fmtFixed(design.arr_area_m2, 1)} m² · {fmtFixed(design.arr_p_bol_w / 1e3, 1)} kW BOL
        </b>
        <span>battery</span>
        <b>{fmtFixed(design.batt_cap_wh / 1e3, 1)} kWh</b>
        <span>bus load</span>
        <b>{fmtFixed(design.load_design_w / 1e3, 1)} kW</b>
        <span>worst eclipse</span>
        <b>{fmtPct(design.worst_fe, 1)}</b>
        <span>period</span>
        <b>{fmtFixed(design.period_s / 60, 1)} min</b>
      </div>
    </section>
  );
}

function Warnings() {
  const warnings = useStudio((s) => s.warnings);
  if (!warnings.length) return null;
  return (
    <section className="dp-section">
      <h3>Design warnings</h3>
      <div className="dp-warnings">
        {warnings.map((w, i) => (
          <div key={i} className={`chip chip-${w.severity}`}>
            {w.severity === "crit" ? "⛔" : w.severity === "warn" ? "⚠" : "ⓘ"}{" "}
            {w.message}
          </div>
        ))}
      </div>
    </section>
  );
}

const SEV_ICON: Record<MissionEvent["severity"], string> = {
  info: "ⓘ",
  warn: "⚠",
  crit: "⛔",
};

function EventLog() {
  const events = useStudio((s) => s.events);
  const seek = useStudio((s) => s.seek);
  const listRef = useRef<HTMLDivElement | null>(null);

  // keep the newest event in view while the mission streams
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <section className="dp-section dp-events">
      <h3>Event log ({events.length})</h3>
      <div className="eventlist" ref={listRef}>
        {events.length === 0 ? (
          <div className="event-empty">no events yet — run the mission</div>
        ) : (
          events.map((e, i) => (
            <button
              key={i}
              className={`event event-${e.severity}`}
              title="Jump the timeline to this event"
              onClick={() => seek(e.t_yr * SECONDS_PER_YEAR)}
            >
              <span className="event-t">{fmtFixed(e.t_yr, 2)}y</span>
              <span className="event-icon">{SEV_ICON[e.severity]}</span>
              <span className="event-label">{e.label}</span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

export function DesignPanel() {
  return (
    <aside className="design-panel">
      <Headline />
      <MassBudget />
      <Losses />
      <Sizing />
      <Warnings />
      <McPanel />
      <EventLog />
    </aside>
  );
}
