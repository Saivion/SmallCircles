/**
 * The pen: turns geometry into hand-drawn strokes.
 *
 * Every shape is resampled into points, pushed off its true line by smooth,
 * seeded noise, and written back as a curved SVG path. The same seed always
 * draws the same wobble, so a circle redraws identically; a new seed draws
 * a new hand.
 */
import type { Marker } from "@convex/lib/vocabulary";

export type Pt = readonly [number, number];

export type Stroke =
  | { kind: "ink"; d: string; len: number; width: number; faint?: boolean }
  | { kind: "fill"; d: string; marker: Marker | "ink" | "paper" };

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (FNV-1a). */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function dist(a: Pt, b: Pt) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Evenly resample a polyline every `step` units. */
function resample(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** Catmull-Rom through points, sampled into a dense polyline. */
function spline(pts: Pt[], closed: boolean, perSeg = 8): Pt[] {
  if (pts.length < 3) return pts.slice();
  const P = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
  const out: Pt[] = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(closed ? pts[0] : pts[pts.length - 1]);
  return out;
}

/** Smooth path through dense points using quadratic midpoints. */
function toPath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
  let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += ` Q${r2(x)} ${r2(y)} ${r2((x + nx) / 2)} ${r2((y + ny) / 2)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${r2(last[0])} ${r2(last[1])}`;
  return d;
}

function length(pts: Pt[]) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1], pts[i]);
  return n;
}

export type PenOptions = {
  /** 0 = steady hand, 1 = quick sketch. */
  roughness?: number;
  /** Base stroke width in drawing units (the 100-unit box). */
  width?: number;
};

export class Pen {
  readonly strokes: Stroke[] = [];
  private readonly rand: () => number;
  private readonly rough: number;
  private readonly base: number;
  private w: number;

  constructor(seed: number, opts: PenOptions = {}) {
    this.rand = rng(seed);
    this.rough = Math.max(0, Math.min(1, opts.roughness ?? 0.5));
    this.base = opts.width ?? 2.4;
    this.w = this.base;
  }

  /** A seeded number in [a, b). Primitives may use it for small variations. */
  between(a: number, b: number) {
    return a + (b - a) * this.rand();
  }

  /** Set the stroke width multiplier for following strokes (1 = default). */
  weight(mult: number) {
    this.w = this.base * mult;
    return this;
  }

  /**
   * Push points off their line with smooth low-frequency noise (a couple of
   * sines with seeded phase), plus a little overshoot at open ends, the way
   * a pen keeps moving past where it meant to stop.
   */
  private wobble(pts: Pt[], closed: boolean): Pt[] {
    const amp = 0.35 + this.rough * 1.6;
    const dense = resample(pts, 3);
    const total = length(dense) || 1;
    const ph1 = this.rand() * Math.PI * 2;
    const ph2 = this.rand() * Math.PI * 2;
    const f1 = 1 + this.rand() * 1.5;
    const f2 = 3 + this.rand() * 3;
    let run = 0;
    const out: Pt[] = dense.map((p, i) => {
      if (i > 0) run += dist(dense[i - 1], p);
      const t = run / total;
      const a = dense[Math.max(0, i - 1)];
      const b = dense[Math.min(dense.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const n = amp * (0.7 * Math.sin(t * Math.PI * 2 * f1 + ph1) + 0.3 * Math.sin(t * Math.PI * 2 * f2 + ph2));
      return [p[0] + nx * n, p[1] + ny * n] as Pt;
    });
    if (!closed && out.length > 1) {
      const over = this.rough * 2.2 * this.rand();
      const [a, b] = [out[out.length - 2], out[out.length - 1]];
      const l = dist(a, b) || 1;
      out.push([b[0] + ((b[0] - a[0]) / l) * over, b[1] + ((b[1] - a[1]) / l) * over]);
    } else if (closed && out.length > 2) {
      // A hand closes a loop by crossing its own start a little.
      const extra = Math.max(2, Math.round(out.length * 0.06));
      out.push(...out.slice(1, extra + 1));
    }
    return out;
  }

  private ink(pts: Pt[], closed: boolean, faint = false) {
    const w = this.wobble(pts, closed);
    const width = this.w * (0.9 + this.rand() * 0.25);
    this.strokes.push({ kind: "ink", d: toPath(w), len: Math.round(length(w)), width, ...(faint ? { faint } : {}) });
  }

  /** A straight line. */
  line(x1: number, y1: number, x2: number, y2: number) {
    this.ink([[x1, y1], [x2, y2]], false);
    return this;
  }

  /** Straight segments through points. */
  poly(pts: Pt[], closed = false) {
    this.ink(closed ? [...pts, pts[0]] : pts, closed);
    return this;
  }

  /** A smooth curve through points. */
  curve(pts: Pt[], closed = false) {
    this.ink(spline(pts, closed), closed);
    return this;
  }

  /** An ellipse, optionally a partial arc (angles in degrees, 0 = right, clockwise). */
  ellipse(cx: number, cy: number, rx: number, ry: number, from = 0, sweep = 360) {
    const n = Math.max(12, Math.round((Math.abs(sweep) / 360) * 36));
    const start = ((from + this.between(-12, 12) * (sweep === 360 ? 1 : 0)) * Math.PI) / 180;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const a = start + ((sweep * Math.PI) / 180) * (i / n);
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    this.ink(pts, sweep >= 360);
    return this;
  }

  circle(cx: number, cy: number, r: number) {
    return this.ellipse(cx, cy, r, r);
  }

  rect(x: number, y: number, w: number, h: number) {
    return this.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
  }

  /** A small solid ink dot. */
  dot(x: number, y: number, r = 1.6) {
    const pts: Pt[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      pts.push([x + Math.cos(a) * r * (0.85 + this.rand() * 0.3), y + Math.sin(a) * r * (0.85 + this.rand() * 0.3)]);
    }
    this.strokes.push({ kind: "fill", d: toPath(spline(pts, true)) + " Z", marker: "ink" });
    return this;
  }

  /** A flat marker fill (drawn under the ink, offset by the renderer). */
  fill(pts: Pt[], marker: Marker | "paper" = "sun") {
    const j = 0.6 + this.rough;
    const shaken = pts.map(([x, y]) => [x + (this.rand() - 0.5) * j, y + (this.rand() - 0.5) * j] as Pt);
    this.strokes.push({ kind: "fill", d: toPath(spline(shaken, true)) + " Z", marker });
    return this;
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, marker: Marker | "paper" = "sun") {
    const pts: Pt[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return this.fill(pts, marker);
  }

  fillRect(x: number, y: number, w: number, h: number, marker: Marker | "paper" = "sun") {
    return this.fill([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], marker);
  }
}

/** A primitive draws one concept into a 100×100 box with the given pen. */
export type Primitive = (p: Pen) => void;
