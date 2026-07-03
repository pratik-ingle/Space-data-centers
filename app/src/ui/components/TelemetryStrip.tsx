/**
 * Live readouts sampled from the current orbital phase (fast quantities)
 * and the current epoch row (slow quantities). Everything here is worker
 * telemetry — nothing is computed in the UI.
 */
import { fmtFixed, fmtPct } from "../format";
import { useStudio } from "../store";

function Cell({
  label,
  value,
  unit,
  title,
}: {
  label: string;
  value: string;
  unit?: string;
  title?: string;
}) {
  return (
    <div className="stat" title={title}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit ? <span className="stat-unit"> {unit}</span> : null}
      </div>
    </div>
  );
}

export function TelemetryStrip() {
  const tick = useStudio((s) => s.tick);
  const rows = useStudio((s) => s.rows);
  const nGpu = useStudio((s) => s.cfg.chip.n_gpu);
  const row = rows.length ? rows[rows.length - 1] : null;
  const sm = tick.sample;

  return (
    <div className="telemetry-strip">
      <Cell
        label="Tj"
        value={sm ? fmtFixed(sm.tj_c, 1) : "–"}
        unit="°C"
        title="Junction temperature at the live orbital phase"
      />
      <Cell
        label="Tj max/orbit"
        value={row ? fmtFixed(row.tj_max, 1) : "–"}
        unit="°C"
        title="Peak junction temperature over the current epoch's orbit"
      />
      <Cell
        label="radiator"
        value={sm ? fmtFixed(sm.t_rad_c, 1) : "–"}
        unit="°C"
      />
      <Cell
        label="DVFS f"
        value={sm ? fmtPct(sm.f) : "–"}
        title="Clock fraction commanded by the throttle controller"
      />
      <Cell label="SoC" value={sm ? fmtPct(sm.soc_frac) : "–"} />
      <Cell
        label="array"
        value={sm ? fmtFixed(sm.p_arr_w / 1e3, 1) : "–"}
        unit="kW"
      />
      <Cell
        label="load"
        value={sm ? fmtFixed(sm.p_load_w / 1e3, 1) : "–"}
        unit="kW"
      />
      <Cell
        label="GPUs alive"
        value={row ? `${fmtFixed(row.n_alive, 1)}/${nGpu}` : "–"}
      />
      <Cell
        label="TID"
        value={row ? fmtFixed(row.tid_krad, 1) : "–"}
        unit="krad"
        title="Accumulated ionizing dose behind the shield"
      />
      <Cell
        label="ckpt tax"
        value={row ? fmtPct(row.ovh, 2) : "–"}
        title="Daly checkpoint + restart overhead"
      />
      <Cell
        label="effective"
        value={sm ? fmtFixed(sm.eff_pflops, 1) : "–"}
        unit="PFLOPS"
        title="n_alive · PFLOPS · f · (1 − tax) at the live phase"
      />
    </div>
  );
}
