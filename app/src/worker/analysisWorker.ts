/**
 * Analysis worker: synchronous full-mission jobs off the UI thread —
 * design-panel projections (deterministic expected outcome for the current
 * sliders), full missions for A/B compare, and Monte Carlo ensembles.
 */
import { runMission } from "../core/mission";
import { runMonteCarlo } from "../core/montecarlo";
import type { FromAnalysis, ToAnalysis } from "./protocol";

const post = (m: FromAnalysis): void => {
  (self as unknown as Worker).postMessage(m);
};

self.onmessage = (ev: MessageEvent<ToAnalysis>) => {
  const m = ev.data;
  switch (m.t) {
    case "project": {
      // Projection is the expected outcome: always expected-value mode.
      const res = runMission(m.cfg, { stochastic: false });
      post({ t: "projection", id: m.id, summary: res.summary });
      break;
    }
    case "mission": {
      const res = runMission(m.cfg);
      post({
        t: "mission",
        id: m.id,
        summary: res.summary,
        hist: res.hist,
        events: res.events,
        design: res.design,
      });
      break;
    }
    case "mc": {
      let lastPost = 0;
      const r = runMonteCarlo(m.cfg, m.runs, m.seed, (done, total) => {
        const now = performance.now();
        if (now - lastPost > 100 || done === total) {
          lastPost = now;
          post({ t: "mcProgress", id: m.id, done, total });
        }
      });
      post({
        t: "mc",
        id: m.id,
        result: {
          delivered: r.delivered,
          per_tonne: r.per_tonne,
          survivors: r.survivors,
          sensitivity: r.sensitivity,
          p5: r.p5,
          p50: r.p50,
          p95: r.p95,
          labels: r.labels,
        },
      });
      break;
    }
  }
};
