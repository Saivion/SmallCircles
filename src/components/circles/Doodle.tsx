"use client";

import { memo, useMemo, type CSSProperties } from "react";
import type { Marker } from "@convex/lib/vocabulary";
import { Pen, type Stroke } from "@/lib/doodle/pen";
import { MARKS, PRIMITIVES } from "@/lib/doodle/primitives";

const MARKER_VAR: Record<Marker | "ink" | "paper", string> = {
  sun: "var(--marker-sun)",
  coral: "var(--marker-coral)",
  sky: "var(--marker-sky)",
  leaf: "var(--marker-leaf)",
  lilac: "var(--marker-lilac)",
  blush: "var(--marker-blush)",
  ink: "var(--ink)",
  paper: "var(--sheet)",
};

/** The strokes for one drawing. Pure: same id + seed + roughness, same lines. */
export function drawStrokes(id: string, seed: number, roughness = 0.55): Stroke[] {
  const pen = new Pen(seed, { roughness });
  const prim = (PRIMITIVES as Record<string, (p: Pen) => void>)[id] ?? (MARKS as Record<string, (p: Pen) => void>)[id] ?? MARKS.spark;
  prim(pen);
  return pen.strokes;
}

type Props = {
  id: string;
  seed: number;
  /** Centre and size in the parent SVG's units. */
  x: number;
  y: number;
  size: number;
  rotate?: number;
  /** Swap the drawing's own marker for the circle's palette; null keeps it ink-only. */
  marker?: Marker | null;
  roughness?: number;
  /** Seconds before the first stroke starts; undefined draws it complete. */
  delay?: number;
  /** Target stroke width in the parent's units, however big the drawing is. */
  penWidth?: number;
};

/**
 * One doodle, drawn on. Marker fills sit under the ink, nudged off register
 * (DESIGN.md §2); ink strokes draw in order, each at a pace set by its length.
 */
export const Doodle = memo(function Doodle({ id, seed, x, y, size, rotate = 0, marker, roughness = 0.55, delay, penWidth = 2.6 }: Props) {
  const strokes = useMemo(() => drawStrokes(id, seed, roughness), [id, seed, roughness]);
  const k = size / 100;
  const animated = delay !== undefined;
  // Ink first-to-last over ~1.1s, longer strokes taking longer.
  const inks = strokes.filter((s): s is Extract<Stroke, { kind: "ink" }> => s.kind === "ink");
  const total = inks.reduce((n, s) => n + s.len, 0) || 1;
  let t = 0;
  const timing = new Map<Stroke, { d: number; dur: number }>();
  for (const s of inks) {
    const dur = 0.18 + (s.len / total) * 0.95;
    timing.set(s, { d: t, dur });
    t += dur * 0.72;
  }
  const inkDone = t;
  const off = { dx: (2.8 + (seed % 7) * 0.2) / k, dy: (2.2 + (seed % 5) * 0.25) / k };

  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) translate(${-size / 2} ${-size / 2}) scale(${k})`}>
      <g transform={`translate(${off.dx} ${off.dy})`}>
        {strokes.map((s, i) =>
          s.kind === "fill" && s.marker !== "ink" ? (
            <path
              key={`f${i}`}
              d={s.d}
              fill={marker === null ? "transparent" : MARKER_VAR[s.marker === "paper" ? "paper" : (marker ?? s.marker)]}
              className={animated ? "doodle-fill" : undefined}
              style={animated ? ({ "--d": `${(delay ?? 0) + inkDone * 0.85}s` } as CSSProperties) : undefined}
            />
          ) : null,
        )}
      </g>
      {strokes.map((s, i) => {
        if (s.kind === "fill") {
          return s.marker === "ink" ? (
            <path
              key={`d${i}`}
              d={s.d}
              fill="var(--ink)"
              className={animated ? "doodle-fill" : undefined}
              style={animated ? ({ "--d": `${(delay ?? 0) + inkDone * 0.6}s` } as CSSProperties) : undefined}
            />
          ) : null;
        }
        const tm = timing.get(s)!;
        return (
          <path
            key={`i${i}`}
            d={s.d}
            pathLength={1}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={(penWidth * (s.width / 2.4)) / k}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={animated ? "ink-stroke" : undefined}
            style={animated ? ({ "--d": `${(delay ?? 0) + tm.d}s`, "--dur": `${tm.dur}s` } as CSSProperties) : undefined}
          />
        );
      })}
    </g>
  );
});

/** A doodle on its own, in its own little SVG (explore card, thumbnails). */
export function DoodleIcon({ id, seed, size = 96, delay, marker }: { id: string; seed: number; size?: number; delay?: number; marker?: Marker | null }) {
  return (
    <svg width={size} height={size} viewBox="0 0 110 110" aria-hidden>
      <Doodle id={id} seed={seed} x={55} y={55} size={100} delay={delay} marker={marker} penWidth={2.4} />
    </svg>
  );
}
