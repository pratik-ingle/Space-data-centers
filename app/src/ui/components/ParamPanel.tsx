/**
 * Parameter panel, generated entirely from PARAM_META (the single zod-backed
 * schema) so UI and physics can never disagree. Each field: label + unit +
 * numeric entry + slider + one-line physical-trade tooltip. Advanced fields
 * collapse per group; fields tagged with orbit profiles show only for the
 * active profile.
 */
import { useState } from "react";
import { PARAM_META, getParam } from "../../core";
import type { OrbitProfileT, ParamGroup, ParamMeta } from "../../core";
import { clamp, roundDust, stepDecimals } from "../format";
import { posToVal, valToPos, SLIDER_STEPS } from "../sliderMath";
import { useStudio } from "../store";

const GROUP_ORDER: ParamGroup[] = [
  "Orbit",
  "Compute",
  "Thermal",
  "Power",
  "Radiation",
  "Reliability",
  "Mission",
];

const PROFILE_LABELS: Record<OrbitProfileT, string> = {
  dd_sso: "Dawn-dusk SSO",
  mid_incl: "ISS-like 51.6°",
  custom: "Custom β profile",
};

/** Numeric shown in the entry box: full value, dust stripped. */
function inputText(v: number): string {
  return String(roundDust(Number(v.toPrecision(6))));
}

function ParamField({
  meta,
  value,
  onCommit,
}: {
  meta: ParamMeta;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commitDraft = (): void => {
    if (draft !== null) {
      const x = Number(draft);
      if (Number.isFinite(x)) {
        const v = clamp(meta.int ? Math.round(x) : x, meta.min, meta.max);
        onCommit(roundDust(v));
      }
      setDraft(null);
    }
  };

  const dec = stepDecimals(meta.step);
  return (
    <div className="field" title={meta.tooltip}>
      <div className="field-head">
        <span className="field-label">{meta.label}</span>
        <span className="field-entry">
          {/* text input: number inputs localize decimals (0,4) and reject
              scientific notation entry in some locales */}
          <input
            type="text"
            inputMode="decimal"
            value={draft ?? inputText(value)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setDraft(null);
            }}
          />
          {meta.unit ? <span className="field-unit">{meta.unit}</span> : null}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={valToPos(meta, value)}
        onChange={(e) => {
          const v = posToVal(meta, Number(e.target.value));
          // avoid churning the store when snapping lands on the same value
          if (Math.abs(v - value) > (meta.int ? 0.5 : meta.step * 1e-6) || dec === 0) {
            onCommit(v);
          }
        }}
        aria-label={meta.label}
      />
    </div>
  );
}

function GroupSection({ group }: { group: ParamGroup }) {
  const cfg = useStudio((s) => s.cfg);
  const setParam = useStudio((s) => s.setParam);
  const profile = cfg.orbit.profile;
  const show = (m: ParamMeta): boolean =>
    !m.profiles || m.profiles.includes(profile);

  const fields = PARAM_META.filter((m) => m.group === group && show(m));
  const basic = fields.filter((m) => !m.advanced);
  const advanced = fields.filter((m) => m.advanced);

  return (
    <section className="param-group">
      <h3>{group}</h3>
      {group === "Orbit" ? <ProfileSelect /> : null}
      {basic.map((m) => (
        <ParamField
          key={m.path}
          meta={m}
          value={getParam(cfg, m.path)}
          onCommit={(v) => setParam(m.path, v)}
        />
      ))}
      {group === "Mission" ? <MissionModeControls /> : null}
      {advanced.length ? (
        <details>
          <summary>advanced ({advanced.length})</summary>
          {advanced.map((m) => (
            <ParamField
              key={m.path}
              meta={m}
              value={getParam(cfg, m.path)}
              onCommit={(v) => setParam(m.path, v)}
            />
          ))}
        </details>
      ) : null}
    </section>
  );
}

function ProfileSelect() {
  const profile = useStudio((s) => s.cfg.orbit.profile);
  const setProfile = useStudio((s) => s.setProfile);
  return (
    <div
      className="field"
      title="β(t) model: dawn-dusk SSO stays near-permanently sunlit; ISS-like precesses through heavy-eclipse seasons."
    >
      <div className="field-head">
        <span className="field-label">Orbit class</span>
      </div>
      <select
        value={profile}
        onChange={(e) => setProfile(e.target.value as OrbitProfileT)}
      >
        {(Object.keys(PROFILE_LABELS) as OrbitProfileT[]).map((p) => (
          <option key={p} value={p}>
            {PROFILE_LABELS[p]}
          </option>
        ))}
      </select>
    </div>
  );
}

function MissionModeControls() {
  const stochastic = useStudio((s) => s.cfg.mission.stochastic);
  const seed = useStudio((s) => s.cfg.mission.seed);
  const setStochastic = useStudio((s) => s.setStochastic);
  const setSeed = useStudio((s) => s.setSeed);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <>
      <div
        className="field"
        title="Expected-value mode propagates smooth means; sampled mode draws SPE storms and binomial GPU deaths from the seeded RNG."
      >
        <div className="field-head">
          <span className="field-label">Failure model</span>
        </div>
        <select
          value={stochastic ? "sampled" : "expected"}
          onChange={(e) => setStochastic(e.target.value === "sampled")}
        >
          <option value="expected">Expected value (smooth)</option>
          <option value="sampled">Sampled events (seeded)</option>
        </select>
      </div>
      <div
        className="field"
        title="Seed of the mulberry32 stream; a fixed seed makes sampled runs bit-reproducible."
      >
        <div className="field-head">
          <span className="field-label">RNG seed</span>
          <span className="field-entry">
            <input
              type="text"
              inputMode="numeric"
              value={draft ?? String(seed)}
              disabled={!stochastic}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (draft !== null) {
                  const x = Number(draft);
                  if (Number.isFinite(x)) setSeed(x);
                  setDraft(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </span>
        </div>
      </div>
    </>
  );
}

export function ParamPanel() {
  return (
    <div className="param-panel">
      {GROUP_ORDER.map((g) => (
        <GroupSection key={g} group={g} />
      ))}
    </div>
  );
}
