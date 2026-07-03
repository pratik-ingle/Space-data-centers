/**
 * Thin React wrapper around uPlot: owns instance lifecycle, responsive
 * width, x-range band shading (eclipse/SPE windows) and a live playhead
 * line. All series/axis options come from the caller; the caller must keep
 * `opts` referentially stable (useMemo) — a new identity recreates the plot.
 */
import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export interface BandSpec {
  ranges: [number, number][];
  color: string;
}

interface Props {
  opts: Omit<uPlot.Options, "width" | "height">;
  height: number;
  data: uPlot.AlignedData;
  bands?: BandSpec[];
  /** Live vertical marker in x units; null hides it. */
  cursorX?: number | null;
}

export function UPlotChart({ opts, height, data, bands, cursorX }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const bandsRef = useRef<BandSpec[]>([]);
  const dataRef = useRef<uPlot.AlignedData>(data);
  bandsRef.current = bands ?? [];
  dataRef.current = data;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    // shades band x-ranges after grid/axes, before series
    const drawBands = (u: uPlot): void => {
      const specs = bandsRef.current;
      if (!specs.length) return;
      const { ctx, bbox } = u;
      const xMin = u.scales.x.min;
      const xMax = u.scales.x.max;
      if (xMin == null || xMax == null) return;
      ctx.save();
      for (const b of specs) {
        ctx.fillStyle = b.color;
        for (const [x0, x1] of b.ranges) {
          const lo = Math.max(x0, xMin);
          const hi = Math.min(x1, xMax);
          if (hi <= lo) continue;
          const p0 = u.valToPos(lo, "x", true);
          const p1 = u.valToPos(hi, "x", true);
          ctx.fillRect(p0, bbox.top, Math.max(p1 - p0, 1), bbox.height);
        }
      }
      ctx.restore();
    };

    const full: uPlot.Options = {
      ...opts,
      width: el.clientWidth || 480,
      height,
      hooks: {
        ...opts.hooks,
        drawAxes: [...(opts.hooks?.drawAxes ?? []), drawBands],
        init: [
          ...(opts.hooks?.init ?? []),
          (u: uPlot) => {
            const line = document.createElement("div");
            line.className = "playhead";
            u.over.appendChild(line);
            playheadRef.current = line;
          },
        ],
      },
    };

    const u = new uPlot(full, dataRef.current, el);
    plotRef.current = u;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w > 0) u.setSize({ width: w, height });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
      plotRef.current = null;
      playheadRef.current = null;
    };
  }, [opts, height]);

  useEffect(() => {
    plotRef.current?.setData(data, true);
  }, [data]);

  // bands can change without a data change (rare); repaint cheaply
  useEffect(() => {
    plotRef.current?.redraw(false);
  }, [bands]);

  useEffect(() => {
    const u = plotRef.current;
    const line = playheadRef.current;
    if (!u || !line) return;
    const xMin = u.scales.x.min;
    const xMax = u.scales.x.max;
    if (
      cursorX == null ||
      !Number.isFinite(cursorX) ||
      xMin == null ||
      xMax == null ||
      cursorX < xMin ||
      cursorX > xMax
    ) {
      line.style.display = "none";
      return;
    }
    line.style.display = "block";
    line.style.transform = `translateX(${u.valToPos(cursorX, "x")}px)`;
  }, [cursorX, data]);

  return <div ref={wrapRef} className="chart" />;
}
