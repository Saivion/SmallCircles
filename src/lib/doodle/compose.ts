/**
 * Composition: where everything goes on the page.
 *
 * Deterministic from the circle's seed and its elements (DESIGN.md §5). The
 * model never places anything: it says what matters and how much, and this
 * decides the ring, the photo's tilt, each doodle's slot, size and rotation,
 * the palette, the arrows and the little scatter marks.
 */
import { doodleFor, type Marker } from "@convex/lib/vocabulary";
import { hash, rng } from "./pen";

export type ComposeElement = {
  id: string;
  illustration: string;
  label: string;
  importance: number;
  kind: string;
  pointsAt: { x: number; y: number } | null;
  order: number;
};

export type Placed = {
  id: string;
  illustration: string;
  label: string;
  /** Centre of the doodle, in page units. */
  x: number;
  y: number;
  /** Doodle box size in page units (the 100-unit primitive scales to this). */
  size: number;
  rotate: number;
  marker: Marker | null;
  /** Where the label sits relative to the doodle. */
  labelSide: "above" | "below" | "left" | "right";
  labelRotate: number;
  /** Arrow from the doodle to a point on the photo, when it points at something in it. */
  arrow: { from: [number, number]; to: [number, number]; bend: number } | null;
  seed: number;
  /** 0..1 around the ring, for draw order and entrance direction. */
  angle: number;
};

export type Composition = {
  width: number;
  height: number;
  ring: { cx: number; cy: number; rx: number; ry: number; seed: number };
  photo: { cx: number; cy: number; w: number; h: number; rotate: number; tapeRotate: number };
  placed: Placed[];
  scatter: { kind: "spark" | "dots" | "twinkle"; x: number; y: number; size: number; rotate: number; seed: number }[];
  palette: Marker[];
};

export const PAGE_W = 1000;
export const PAGE_H = 860;

/**
 * Three markers per circle, never more (DESIGN.md §10). The mood picks a family;
 * the seed picks one set in it, so two warm circles still don't match.
 */
const PALETTES: Record<string, Marker[][]> = {
  warm: [
    ["sun", "coral", "leaf"],
    ["sun", "blush", "coral"],
    ["coral", "sun", "lilac"],
  ],
  cool: [
    ["sky", "leaf", "sun"],
    ["sky", "lilac", "leaf"],
    ["leaf", "sky", "blush"],
  ],
  night: [
    ["sky", "sun", "lilac"],
    ["lilac", "sky", "blush"],
  ],
};
const ANY = [...PALETTES.warm, ...PALETTES.cool];

/** Keep a doodle's own marker when it's in the palette, else the palette's nearest stand-in. */
function markerFor(id: string, palette: Marker[], r: () => number): Marker | null {
  const own = doodleFor(id)?.marker ?? null;
  if (own === null) return null;
  if (palette.includes(own)) return own;
  return palette[Math.floor(r() * palette.length)];
}

/**
 * Lay the circle out. `aspect` is the photo's width/height (from the loaded
 * image, or 4:5 until it's known).
 */
export function compose(args: {
  seed: number;
  elements: ComposeElement[];
  aspect: number;
  palette?: string | null;
  kind?: string | null;
}): Composition {
  const r = rng(args.seed);
  const W = PAGE_W;
  const H = PAGE_H;
  // A trip spreads wide; a dinner or a person sits close.
  const spread = args.kind === "trip" || args.kind === "place" || args.kind === "nature" ? 1.06 : args.kind === "meal" || args.kind === "people" ? 0.94 : 1;
  const cx = W / 2 + (r() - 0.5) * 16;
  const cy = H / 2 + 6 + (r() - 0.5) * 10;
  const rx = 420 * spread;
  const ry = 360 * spread;

  // The photo: about 38% of the ring's width, bounded so tall photos stay inside.
  const aspect = Math.max(0.5, Math.min(1.9, args.aspect || 0.8));
  let pw = 300;
  let ph = pw / aspect;
  if (ph > 380) {
    ph = 380;
    pw = ph * aspect;
  }
  const photo = {
    cx,
    cy: cy - 6,
    w: pw,
    h: ph,
    rotate: (r() - 0.5) * 6,
    tapeRotate: -6 + r() * 12,
  };

  // Its own random stream, so choosing colours never moves anything on an existing circle.
  const family = PALETTES[args.palette ?? ""] ?? ANY;
  const palette = family[Math.floor(rng(hash(`${args.seed}:palette`))() * family.length)];

  // Most important first; ties keep arrival order so the page is stable while it grows.
  const els = [...args.elements].sort((a, b) => b.importance - a.importance || a.order - b.order).slice(0, 8);
  const n = Math.max(els.length, 5);

  // Slots around the ring. The top is the place of honour; the start angle
  // and spacing vary a little per seed so no two circles line up the same.
  const start = -90 + (r() - 0.5) * 24;
  const slots: number[] = [];
  for (let i = 0; i < n; i++) {
    // Alternate right/left of the top so importance spreads evenly round the ring.
    const k = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 === 1 ? 1 : -1);
    slots.push(start + (k * 360) / n + (r() - 0.5) * (120 / n));
  }

  const placed: Placed[] = [];
  const photoBox = { x0: photo.cx - pw / 2 - 30, x1: photo.cx + pw / 2 + 30, y0: photo.cy - ph / 2 - 30, y1: photo.cy + ph / 2 + 50 };

  els.forEach((e, i) => {
    const deg = slots[i];
    const a = (deg * Math.PI) / 180;
    const size = 64 + 64 * Math.max(0, Math.min(1, e.importance)) * (i === 0 ? 1.15 : 1);
    // Sit on the ring, nudged in or out a touch.
    const onRing = 0.9 + r() * 0.12;
    let x = cx + Math.cos(a) * rx * onRing;
    let y = cy + Math.sin(a) * ry * onRing;
    // Never over the photo.
    if (x > photoBox.x0 - size / 2 && x < photoBox.x1 + size / 2 && y > photoBox.y0 - size / 2 && y < photoBox.y1 + size / 2) {
      y = y < photo.cy ? photoBox.y0 - size / 2 - 6 : photoBox.y1 + size / 2 + 6;
    }
    // Stay on the page, with room for the label (above/below or out to the side).
    x = Math.max(size / 2 + 72, Math.min(W - size / 2 - 72, x));
    y = Math.max(size / 2 + 64, Math.min(H - size / 2 - 64, y));
    // Keep a little air between doodles.
    for (const p of placed) {
      const dx = x - p.x;
      const dy = y - p.y;
      const min = (size + p.size) / 2 + 22;
      const d = Math.hypot(dx, dy);
      if (d < min && d > 0) {
        x += (dx / d) * (min - d);
        y += (dy / d) * (min - d);
      }
    }

    // Labels face away from the photo: above/below at the poles, left/right on the sides.
    // Side labels sit outside so opposite doodles mirror each other.
    const fromCx = x - cx;
    const fromCy = y - cy;
    const labelSide: Placed["labelSide"] =
      Math.abs(fromCx) > Math.abs(fromCy) * 0.9 ? (fromCx < 0 ? "left" : "right") : fromCy < 0 ? "above" : "below";

    let arrow: Placed["arrow"] = null;
    if (e.pointsAt && placed.filter((p) => p.arrow).length < 2 && e.kind === "subject") {
      // A point on the photo, in page units (ignoring the small tilt).
      const tx = photo.cx - pw / 2 + e.pointsAt.x * pw;
      const ty = photo.cy - ph / 2 + e.pointsAt.y * ph;
      // Start just off the doodle, toward the target; stop short of the print edge.
      const vx = tx - x;
      const vy = ty - y;
      const vl = Math.hypot(vx, vy) || 1;
      const from: [number, number] = [x + (vx / vl) * (size * 0.55), y + (vy / vl) * (size * 0.55)];
      const edgeX = Math.max(photo.cx - pw / 2 - 10, Math.min(photo.cx + pw / 2 + 10, tx));
      const edgeY = Math.max(photo.cy - ph / 2 - 10, Math.min(photo.cy + ph / 2 + 10, ty));
      // Aim at the point, but land on the print's border so nothing is drawn over the photo.
      const inside = Math.abs(tx - photo.cx) < pw / 2 && Math.abs(ty - photo.cy) < ph / 2;
      const to: [number, number] = inside ? clipToEdge(from, [tx, ty], photo) : [edgeX, edgeY];
      if (Math.hypot(to[0] - from[0], to[1] - from[1]) > 40) arrow = { from, to, bend: (r() - 0.5) * 0.6 };
    }

    placed.push({
      id: e.id,
      illustration: e.illustration,
      label: e.label,
      x,
      y,
      size,
      rotate: (r() - 0.5) * 20,
      marker: markerFor(e.illustration, palette, r),
      labelSide,
      labelRotate: (r() - 0.5) * 6,
      arrow,
      seed: hash(`${args.seed}:${e.id}`),
      angle: ((deg + 90 + 360) % 360) / 360,
    });
  });

  // Scatter: one to three meaningless marks in the emptiest corners.
  const corners: [number, number][] = [
    [90, 90],
    [W - 90, 90],
    [90, H - 90],
    [W - 90, H - 90],
    [W / 2, 60],
  ];
  const free = corners.filter(([x, y]) => placed.every((p) => Math.hypot(p.x - x, p.y - y) > p.size / 2 + 70));
  const kinds = ["spark", "twinkle", "dots"] as const;
  const scatter = free.slice(0, 1 + Math.floor(r() * 3)).map(([x, y], i) => ({
    kind: kinds[(i + Math.floor(r() * 3)) % 3],
    x: x + (r() - 0.5) * 40,
    y: y + (r() - 0.5) * 30,
    size: 26 + r() * 16,
    rotate: r() * 40,
    seed: hash(`${args.seed}:mark:${i}`),
  }));

  return { width: W, height: H, ring: { cx, cy, rx, ry, seed: hash(`${args.seed}:ring`) }, photo, placed, scatter, palette };
}

/** Where the line from `from` to `to` crosses the photo's border. */
function clipToEdge(from: [number, number], to: [number, number], photo: Composition["photo"]): [number, number] {
  const x0 = photo.cx - photo.w / 2 - 10;
  const x1 = photo.cx + photo.w / 2 + 10;
  const y0 = photo.cy - photo.h / 2 - 10;
  const y1 = photo.cy + photo.h / 2 + 10;
  let t = 1;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  for (const [edge, d, s] of [
    [x0, dx, from[0]],
    [x1, dx, from[0]],
  ] as const) {
    if (d !== 0) {
      const tt = (edge - s) / d;
      const yy = from[1] + dy * tt;
      if (tt > 0 && tt < t && yy >= y0 && yy <= y1) t = tt;
    }
  }
  for (const [edge, d, s] of [
    [y0, dy, from[1]],
    [y1, dy, from[1]],
  ] as const) {
    if (d !== 0) {
      const tt = (edge - s) / d;
      const xx = from[0] + dx * tt;
      if (tt > 0 && tt < t && xx >= x0 && xx <= x1) t = tt;
    }
  }
  return [from[0] + dx * t, from[1] + dy * t];
}

/** The hand-drawn ring: two passes of a wobbly ellipse, ends overlapping. */
export function ringPath(ring: Composition["ring"], pass: 0 | 1): string {
  const r = rng(ring.seed + pass * 7919);
  const start = r() * Math.PI * 2;
  const sweep = Math.PI * 2 * (1.04 + r() * 0.04);
  const n = 72;
  const f1 = 2 + Math.floor(r() * 2);
  const ph = r() * Math.PI * 2;
  const amp = 6 + r() * 5;
  const off = pass === 1 ? 5 + r() * 4 : 0;
  let d = "";
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = start + sweep * t;
    const wob = Math.sin(a * f1 + ph) * amp + Math.sin(a * 5 + ph * 2) * (amp * 0.25);
    const x = ring.cx + Math.cos(a) * (ring.rx + wob + off);
    const y = ring.cy + Math.sin(a) * (ring.ry + wob * 0.8 + off * 0.8);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d.trim();
}

/**
 * A closed shape that follows a ring's own wobble, at another radius: the same
 * seed, frequencies and phase as ringPath's first pass, so a photo cut with it
 * has the outline of the ring drawn around it, only smaller. The wobble scales
 * with the radius, so a small shape wobbles as much, relatively, as its ring.
 */
export function ringShapePath(ring: Composition["ring"], rx: number, ry = rx, softness = 1): string {
  const r = rng(ring.seed);
  r(); // start (the shape is closed, so where it starts doesn't matter)
  r(); // sweep
  const f1 = 2 + Math.floor(r() * 2);
  const ph = r() * Math.PI * 2;
  const amp = (6 + r() * 5) * (rx / ring.rx) * softness;
  const n = 72;
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wob = Math.sin(a * f1 + ph) * amp + Math.sin(a * 5 + ph * 2) * (amp * 0.25);
    const x = ring.cx + Math.cos(a) * (rx + wob);
    const y = ring.cy + Math.sin(a) * (ry + wob * 0.8);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return `${d}Z`;
}

/** A curved arrow with a hand-drawn head. */
export function arrowPath(a: NonNullable<Placed["arrow"]>): { shaft: string; head: string; len: number } {
  const [x1, y1] = a.from;
  const [x2, y2] = a.to;
  const mx = (x1 + x2) / 2 - (y2 - y1) * a.bend;
  const my = (y1 + y2) / 2 + (x2 - x1) * a.bend;
  const shaft = `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  // Head along the curve's final tangent.
  const tx = x2 - mx;
  const ty = y2 - my;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl;
  const uy = ty / tl;
  const hl = 14;
  const hx1 = x2 - ux * hl - uy * hl * 0.55;
  const hy1 = y2 - uy * hl + ux * hl * 0.55;
  const hx2 = x2 - ux * hl + uy * hl * 0.55;
  const hy2 = y2 - uy * hl - ux * hl * 0.55;
  const head = `M${hx1.toFixed(1)} ${hy1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} L${hx2.toFixed(1)} ${hy2.toFixed(1)}`;
  const len = Math.hypot(x2 - x1, y2 - y1) * 1.15;
  return { shaft, head, len };
}

// ---------------------------------------------------------------------------
// The outer ring: what other people added. It sits outside the moment's own
// world, so the circle literally grows, and the page zooms out to hold it.
// ---------------------------------------------------------------------------

export type OuterInput = {
  id: string;
  type: "note" | "memory" | "photo" | "reaction";
  label: string;
  text: string | null;
};

export type OuterPlaced = {
  id: string;
  x: number;
  y: number;
  rotate: number;
  /** Half-size of what's drawn there, for the connector and the page bounds. */
  w: number;
  h: number;
  /** Where its connector ends, on the moment's own ring. */
  anchor: [number, number];
  seed: number;
  /** Text wrapped into lines, for notes and memories. */
  lines: string[];
};

export type Outer = {
  ring: { cx: number; cy: number; rx: number; ry: number; seed: number };
  placed: OuterPlaced[];
  /** The page, grown to hold the outer ring. */
  box: { x: number; y: number; w: number; h: number };
};

/** Twelve seats round the outer ring, filled in a spread-out order so it grows evenly. */
export const OUTER_SEATS = 12;
const SEAT_ORDER = [0, 6, 3, 9, 1, 7, 4, 10, 2, 8, 5, 11];

/** Break words into lines of about `max` characters, at most `rows` lines. */
export function wrap(text: string, max = 20, rows = 4): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= max) line += " " + w;
    else {
      lines.push(line);
      line = w;
    }
    if (lines.length === rows) break;
  }
  if (line && lines.length < rows) lines.push(line);
  const used = lines.join(" ").length;
  if (used < text.trim().length && lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/[.,;:!?]*$/, "") + "…";
  return lines.map((l) => (l.length > max + 6 ? l.slice(0, max + 5) + "…" : l));
}

/** Size of each kind of contribution as drawn, in page units (half-width, half-height). */
function sizeOf(item: OuterInput, lines: string[]): { w: number; h: number } {
  if (item.type === "photo") return { w: 92, h: 112 };
  if (item.type === "reaction") return { w: 70, h: 72 };
  return { w: 118, h: 18 + Math.max(1, lines.length) * 13 };
}

/**
 * `labelScale`: how much bigger than 21px the page's handwritten labels are drawn
 * (phones write them at 40px), so what's added keeps clear of them at any size.
 */
export function composeOuter(comp: Composition, items: OuterInput[], seed: number, labelScale = 1): Outer | null {
  if (items.length === 0) return null;
  const r = rng(hash(`${seed}:outer`));
  const { cx, cy, rx, ry } = comp.ring;
  const orx = rx + 175;
  const ory = ry + 165;
  const start = -75 + r() * 30;
  const turn = r() < 0.5 ? 0 : 3; // which seat the first contribution takes
  const placed: OuterPlaced[] = items.slice(-OUTER_SEATS).map((item, i) => {
    const seat = SEAT_ORDER[(i + turn) % OUTER_SEATS];
    const deg = start + (seat * 360) / OUTER_SEATS + (r() - 0.5) * 8;
    const a = (deg * Math.PI) / 180;
    const lines = item.type === "note" || item.type === "memory" ? wrap(item.text ?? item.label) : [];
    const { w, h } = sizeOf(item, lines);
    const x = cx + Math.cos(a) * orx * (0.97 + r() * 0.06);
    const y = cy + Math.sin(a) * ory * (0.97 + r() * 0.06);
    // The connector reaches in to just outside the moment's own ring.
    const anchor: [number, number] = [cx + Math.cos(a) * (rx + 36), cy + Math.sin(a) * (ry + 36)];
    return { id: item.id, x, y, rotate: (r() - 0.5) * 9, w, h, anchor, seed: hash(`${seed}:${item.id}`), lines };
  });

  // Nothing added may sit on anything already drawn: not a doodle, not its handwritten
  // label, not the photo, not another addition. Each one keeps its direction from the
  // centre (so its line still points the right way) and slides outward until it's clear.
  const obstacles = innerObstacles(comp, labelScale);
  const taken: Box[] = [];
  for (const p of placed) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    let best = boxOf(p, 1, cx, cy, dx, dy);
    for (let f = 1; f <= 1.9; f += 0.05) {
      const b = boxOf(p, f, cx, cy, dx, dy);
      best = b;
      if (![...obstacles, ...taken].some((o) => hits(o, b))) break;
    }
    p.x = cx + dx * best.f;
    p.y = cy + dy * best.f;
    taken.push(best);
  }
  // The page grows to hold everything, with a margin, and never shrinks below the moment's own page.
  let x0 = -30;
  let y0 = -10;
  let x1 = comp.width + 30;
  let y1 = comp.height + 10;
  for (const p of placed) {
    x0 = Math.min(x0, p.x - p.w - 30);
    x1 = Math.max(x1, p.x + p.w + 30);
    y0 = Math.min(y0, p.y - p.h - 30);
    y1 = Math.max(y1, p.y + p.h + 40);
  }
  // Once there are enough to draw the outer ring (CircleCanvas), the page holds all of it.
  if (placed.length >= 4) {
    x0 = Math.min(x0, cx - orx - 20);
    x1 = Math.max(x1, cx + orx + 20);
    y0 = Math.min(y0, cy - ory - 20);
    y1 = Math.max(y1, cy + ory + 20);
  }
  return {
    ring: { cx, cy, rx: orx, ry: ory, seed: hash(`${seed}:outer-ring`) },
    placed,
    // Just big enough for what's there: one note grows the page toward it, not all round.
    box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
  };
}

type Box = { x0: number; y0: number; x1: number; y1: number; f: number };

const CLEAR = 12;
/** Handwritten labels on the page: ~11 units a character at 21px Kalam, ~28 tall. */
const LABEL_CHAR = 11;

function hits(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Where an addition would sit at `f` times its seat's distance from the centre, with room round it. */
function boxOf(p: OuterPlaced, f: number, cx: number, cy: number, dx: number, dy: number): Box {
  const x = cx + dx * f;
  const y = cy + dy * f;
  // Notes and memories carry their author's name under the slip.
  const under = p.lines.length ? 26 : 0;
  return { x0: x - p.w - CLEAR, y0: y - p.h - CLEAR, x1: x + p.w + CLEAR, y1: y + p.h + under + CLEAR, f };
}

/** Everything the moment's own page has drawn: each doodle, its label, and the print. */
function innerObstacles(comp: Composition, k: number): Box[] {
  const out: Box[] = [];
  const { photo } = comp;
  out.push({ x0: photo.cx - photo.w / 2 - 16, y0: photo.cy - photo.h / 2 - 28, x1: photo.cx + photo.w / 2 + 16, y1: photo.cy + photo.h / 2 + 50, f: 1 });
  for (const p of comp.placed) {
    const half = p.size / 2;
    out.push({ x0: p.x - half, y0: p.y - half, x1: p.x + half, y1: p.y + half, f: 1 });
    // The label, wherever CircleCanvas writes it (labelPos): the same gap either side.
    const gap = half + 12;
    const w = (p.label.length * LABEL_CHAR + 8) * k;
    const t = 16 * k;
    const box =
      p.labelSide === "left"
        ? { x0: p.x - gap - w, x1: p.x - gap, y0: p.y - t, y1: p.y + t }
        : p.labelSide === "right"
          ? { x0: p.x + gap, x1: p.x + gap + w, y0: p.y - t, y1: p.y + t }
          : p.labelSide === "above"
            ? { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - gap - 26 * k, y1: p.y - gap + 6 * k }
            : { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y + gap + 16 - 22 * k, y1: p.y + gap + 16 + 8 * k };
    out.push({ ...box, f: 1 });
  }
  return out;
}

/** A soft hand-drawn line from a contribution in toward the moment. */
export function connectorPath(from: [number, number], to: [number, number], seed: number): string {
  const r = rng(seed);
  const mx = (from[0] + to[0]) / 2 + (r() - 0.5) * 30;
  const my = (from[1] + to[1]) / 2 + (r() - 0.5) * 30;
  return `M${from[0].toFixed(1)} ${from[1].toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${to[0].toFixed(1)} ${to[1].toFixed(1)}`;
}
