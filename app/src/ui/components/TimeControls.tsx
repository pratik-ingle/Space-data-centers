/**
 * Transport bar: play/pause/step/run-to-end, log time-warp slider
 * (1x .. 1,000,000x), timeline scrubber (seek rebuilds deterministically in
 * the worker), and time/orbit readouts.
 */
import { useRef, useState } from "react";
import { fmtDuration, fmtFixed, fmtPct, fmtWarp } from "../format";
import { useStudio } from "../store";

const WARP_MAX_LOG = 6;

export function TimeControls() {
  const tick = useStudio((s) => s.tick);
  const missionEndS = useStudio((s) => s.missionEndS);
  const nEpochs = useStudio((s) => s.nEpochs);
  const play = useStudio((s) => s.play);
  const pause = useStudio((s) => s.pause);
  const stepEpoch = useStudio((s) => s.stepEpoch);
  const runToEnd = useStudio((s) => s.runToEnd);
  const setWarp = useStudio((s) => s.setWarp);
  const seek = useStudio((s) => s.seek);
  const summary = useStudio((s) => s.summary);

  const [scrub, setScrub] = useState<number | null>(null);
  const lastSeekMs = useRef(0);

  const timeS = scrub ?? tick.timeS;
  const done = summary !== null && tick.timeS >= missionEndS;

  const throttledSeek = (t: number): void => {
    const now = performance.now();
    if (now - lastSeekMs.current > 80) {
      lastSeekMs.current = now;
      seek(t);
    }
  };

  return (
    <footer className="time-controls">
      <div className="transport">
        <button title="Restart mission" onClick={() => seek(0)}>
          ⏮
        </button>
        <button
          className="play"
          title={tick.playing ? "Pause" : done ? "Replay" : "Play"}
          onClick={() => (tick.playing ? pause() : play())}
        >
          {tick.playing ? "⏸" : "▶"}
        </button>
        <button title="Step one epoch (~2 weeks)" onClick={stepEpoch}>
          ⏭
        </button>
        <button title="Run to end of mission" onClick={runToEnd}>
          ⏩ end
        </button>
      </div>

      <div className="warp" title="Time warp (log scale)">
        <span className="warp-label">warp</span>
        <input
          type="range"
          min={0}
          max={WARP_MAX_LOG}
          step={0.05}
          value={Math.log10(Math.max(tick.warp, 1))}
          onChange={(e) => setWarp(Math.round(10 ** Number(e.target.value)))}
        />
        <span className="warp-value">{fmtWarp(tick.warp)}</span>
      </div>

      <div className="scrubber">
        <input
          type="range"
          min={0}
          max={Math.max(missionEndS, 1)}
          step={Math.max(missionEndS / 2000, 1)}
          value={timeS}
          onChange={(e) => {
            const t = Number(e.target.value);
            setScrub(t);
            throttledSeek(t);
          }}
          onPointerUp={() => {
            if (scrub !== null) {
              seek(scrub);
              setScrub(null);
            }
          }}
          aria-label="Mission timeline"
        />
      </div>

      <div className="time-readouts">
        <span className="ro" title="Mission elapsed time">
          t {fmtDuration(timeS)}
        </span>
        <span className="ro" title="Degradation epoch">
          epoch {Math.min(tick.epoch + 1, Math.max(nEpochs, 1))}/{nEpochs || "–"}
        </span>
        <span className="ro" title="Solar beta angle">
          β {fmtFixed(tick.beta, 1)}°
        </span>
        <span className="ro" title="Eclipse fraction this epoch">
          fe {fmtPct(tick.fe)}
        </span>
      </div>
    </footer>
  );
}
