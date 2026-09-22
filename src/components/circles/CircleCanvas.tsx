"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  arrowPath,
  compose,
  composeOuter,
  connectorPath,
  ringPath,
  type ComposeElement,
  type OuterPlaced,
  type Placed,
} from "@/lib/doodle/compose";
import { Doodle } from "./Doodle";

export type CanvasElement = ComposeElement & { detail: string | null; createdAt?: number };

/** Something another person added: drawn on the outer ring. */
export type CanvasContribution = {
  id: string;
  type: "note" | "memory" | "photo" | "reaction";
  illustration: string;
  label: string;
  text: string | null;
  by: string;
  photoUrl: string | null;
  reading: boolean;
  createdAt: number;
};

type Props = {
  seed: number;
  photoUrl: string | null;
  elements: CanvasElement[];
  drawing: boolean;
  palette?: string | null;
  kind?: string | null;
  /** Written on the print's chin. */
  chin?: string | null;
  selectedId?: string | null;
  onOpen?: (id: string) => void;
  /** Draw everything in from scratch (opening a finished circle). False renders it complete. */
  animate?: boolean;
  /** Thumbnails: no labels, no interaction. */
  mini?: boolean;
  /** What other people added, oldest first. */
  contributions?: CanvasContribution[];
};

type Box = { x: number; y: number; w: number; h: number };

/** The page's frame, eased from one size to the next so the circle zooms out as it grows. */
function useEasedBox(target: Box): Box {
  const [box, setBox] = useState(target);
  const from = useRef(target);
  const key = `${target.x.toFixed(1)} ${target.y.toFixed(1)} ${target.w.toFixed(1)} ${target.h.toFixed(1)}`;
  useEffect(() => {
    const start = from.current;
    if (start.x === target.x && start.y === target.y && start.w === target.w && start.h === target.h) return;
    // No animation frames arrive while the page is hidden, and some people ask for less motion: go straight there.
    const still = document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    const dur = 1100;
    let raf = 0;
    const step = (t: number) => {
      const k = still ? 1 : Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      const next = {
        x: start.x + (target.x - start.x) * e,
        y: start.y + (target.y - start.y) * e,
        w: start.w + (target.w - start.w) * e,
        h: start.h + (target.h - start.h) * e,
      };
      from.current = next;
      setBox(next);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    if (still) step(t0);
    else raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return box;
}

/** Phones write the page's labels at 40px instead of 21 (globals.css), so what's added keeps further clear. */
const PHONE = "(max-width: 560px)";
function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function useLabelScale(): number {
  return useSyncExternalStore(subscribePhone, () => (window.matchMedia(PHONE).matches ? 40 / 21 : 1), () => 1);
}

/** The photo's shape, once it has loaded; 4:5 until then. */
function usePhotoAspect(url: string | null): number {
  const [aspect, setAspect] = useState(0.8);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const img = new Image();
    img.onload = () => live && img.naturalWidth && setAspect(img.naturalWidth / img.naturalHeight);
    img.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return aspect;
}

const PHOTO_IN = 0.1;
const RING_IN = 0.55;
const FIRST_DOODLE = 1.6;
const STAGGER = 0.42;

/** Where a label sits, relative to its doodle's centre. Outside-facing, and mirrored left/right. */
function labelPos(p: Placed): { dx: number; dy: number; anchor: "start" | "middle" | "end"; baseline: "alphabetic" | "middle" } {
  const gap = p.size / 2 + 12;
  switch (p.labelSide) {
    case "left":
      return { dx: -gap, dy: 0, anchor: "end", baseline: "middle" };
    case "right":
      return { dx: gap, dy: 0, anchor: "start", baseline: "middle" };
    case "above":
      return { dx: 0, dy: -gap - 2, anchor: "middle", baseline: "alphabetic" };
    case "below":
      return { dx: 0, dy: gap + 16, anchor: "middle", baseline: "alphabetic" };
  }
}

/**
 * A Small Circle: the photo in the middle, the moment's world drawn around it.
 * Everything visual comes from `compose` + the seed, so the same circle
 * always draws the same page.
 */
export function CircleCanvas({ seed, photoUrl, elements, drawing, palette, kind, chin, selectedId, onOpen, animate = true, mini = false, contributions = [] }: Props) {
  const aspect = usePhotoAspect(photoUrl);
  const comp = useMemo(() => compose({ seed, elements, aspect, palette, kind }), [seed, elements, aspect, palette, kind]);
  const { photo, ring } = comp;
  const labelScale = useLabelScale();
  const outer = useMemo(() => (mini ? null : composeOuter(comp, contributions, seed, labelScale)), [comp, contributions, seed, mini, labelScale]);

  // What was on the page when it opened draws in sequence; what arrives later draws as it lands.
  const [openedAt] = useState(() => Date.now());

  // What people added comes last: after the moment's own world has drawn itself, the page
  // zooms out and their additions land one by one. Until then the page hugs the moment.
  const outerAt = FIRST_DOODLE + comp.placed.length * STAGGER + 0.6;
  const [grown, setGrown] = useState(!animate);
  useEffect(() => {
    if (grown) return;
    const wait = Math.max(0, openedAt + outerAt * 1000 - Date.now());
    const t = window.setTimeout(() => setGrown(true), wait);
    return () => window.clearTimeout(t);
  }, [grown, openedAt, outerAt]);

  const innerBox: Box = mini ? { x: 0, y: 0, w: comp.width, h: comp.height } : { x: -30, y: -10, w: comp.width + 60, h: comp.height + 20 };
  // Something added while you're looking makes room for itself straight away, even mid-drawing.
  const addedSinceOpen = contributions.some((k) => k.createdAt > openedAt - 1000);
  const box = useEasedBox(outer && (grown || addedSinceOpen) ? outer.box : innerBox);
  // The faint outer ring shows once the circle has really grown; before that the page hugs what's there.
  const outerRing = useMemo(() => (outer && outer.placed.length >= 4 ? ringPath(outer.ring, 0) : null), [outer]);
  const byId = useMemo(() => new Map(contributions.map((k) => [k.id, k])), [contributions]);

  const createdOf = useMemo(() => new Map(elements.map((e) => [e.id, e.createdAt ?? 0])), [elements]);
  const delayFor = (id: string, index: number): number | undefined => {
    if (!animate) return undefined;
    const born = createdOf.get(id) ?? 0;
    // A second of slack for clock skew between the server and this browser.
    return born < openedAt + 1000 ? FIRST_DOODLE + index * STAGGER : 0.05;
  };

  const ring0 = useMemo(() => ringPath(ring, 0), [ring]);
  const ring1 = useMemo(() => ringPath(ring, 1), [ring]);

  // The pen: the newest thing being drawn while the circle is still working.
  const newest = drawing ? comp.placed.reduce<Placed | null>((a, p) => {
    const e = elements.find((x) => x.id === p.id);
    const b = a ? elements.find((x) => x.id === a.id) : null;
    return !a || (e && b && e.order > b.order) ? p : a;
  }, null) : null;

  const tilt = `rotate(${photo.rotate} ${photo.cx} ${photo.cy})`;
  const px = photo.cx - photo.w / 2;
  const py = photo.cy - photo.h / 2;
  const clipId = `photo-${seed}`;

  return (
    <svg
      className={`circle-canvas${mini ? " is-mini" : ""}${selectedId ? " has-selection" : ""}`}
      viewBox={`${box.x.toFixed(1)} ${box.y.toFixed(1)} ${box.w.toFixed(1)} ${box.h.toFixed(1)}`}
      role={mini ? undefined : "img"}
      aria-label={mini ? undefined : "a small circle"}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={px} y={py} width={photo.w} height={photo.h} rx={2} />
        </clipPath>
      </defs>

      {/* the ring, two passes of one hand */}
      <g className="ring">
        {[ring0, ring1].map((d, i) => (
          <path
            key={i}
            d={d}
            pathLength={1}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={i === 0 ? 2.2 : 1.1}
            strokeLinecap="round"
            opacity={i === 0 ? 0.9 : 0.4}
            className={animate ? "ink-stroke" : undefined}
            style={animate ? ({ "--d": `${RING_IN + i * 0.35}s`, "--dur": "1.4s" } as CSSProperties) : undefined}
          />
        ))}
      </g>

      {/* scatter: marks that mean nothing and make the page feel finished */}
      {!mini &&
        !outer &&
        comp.scatter.map((m, i) => (
          <g key={`m${i}`} className="scatter">
            <Doodle id={m.kind} seed={m.seed} x={m.x} y={m.y} size={m.size} rotate={m.rotate} marker={null} delay={animate ? FIRST_DOODLE + 0.2 + i * 0.3 : undefined} penWidth={1.8} />
          </g>
        ))}

      {/* the moment: an instant print, taped down */}
      <g className={`print${animate ? " is-landing" : ""}`} transform={tilt} style={{ "--d": `${PHOTO_IN}s` } as CSSProperties}>
        <rect className="print-sheet" x={px - 12} y={py - 12} width={photo.w + 24} height={photo.h + 12 + 44} rx={2} />
        {photoUrl ? (
          <image href={photoUrl} x={px} y={py} width={photo.w} height={photo.h} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId})`} />
        ) : (
          <rect x={px} y={py} width={photo.w} height={photo.h} fill="var(--paper-deep)" />
        )}
        {chin && !mini ? (
          // Centred in the white strip under the photo: across the print, and halfway down its 44-unit chin.
          <text className="print-chin" x={photo.cx} y={py + photo.h + 22} textAnchor="middle" dominantBaseline="central">
            {chin}
          </text>
        ) : null}
        <rect
          className="tape"
          x={photo.cx - 40}
          y={py - 24}
          width={80}
          height={24}
          transform={`rotate(${photo.tapeRotate} ${photo.cx} ${py - 12})`}
        />
      </g>

      {/* arrows from a doodle to the thing it means, in the photo */}
      {!mini &&
        comp.placed.map((p, i) => {
          if (!p.arrow) return null;
          const a = arrowPath(p.arrow);
          const d = delayFor(p.id, i);
          return (
            <g key={`a${p.id}`} className="arrow">
              <path d={a.shaft} pathLength={1} fill="none" stroke="var(--ink)" strokeWidth={1.8} strokeLinecap="round" className={d !== undefined ? "ink-stroke" : undefined} style={d !== undefined ? ({ "--d": `${d + 0.9}s`, "--dur": "0.6s" } as CSSProperties) : undefined} />
              <path d={a.head} pathLength={1} fill="none" stroke="var(--ink)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={d !== undefined ? "ink-stroke" : undefined} style={d !== undefined ? ({ "--d": `${d + 1.45}s`, "--dur": "0.2s" } as CSSProperties) : undefined} />
            </g>
          );
        })}

      {/* the world around it */}
      {comp.placed.map((p, i) => {
        const d = delayFor(p.id, i);
        const lp = labelPos(p);
        const open = () => onOpen?.(p.id);
        return (
          <g
            key={p.id}
            className={`thing${selectedId === p.id ? " is-selected" : ""}`}
            tabIndex={mini ? -1 : 0}
            role={mini ? undefined : "button"}
            aria-label={mini ? undefined : p.label}
            onClick={mini ? undefined : open}
            onKeyDown={mini ? undefined : (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open())}
          >
            {/* positioned by a CSS transform so things glide when the page rearranges */}
            <g className="thing-pos" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
              <circle cx={0} cy={0} r={p.size / 2 + 8} fill="transparent" />
              <g className="thing-art">
                <Doodle id={p.illustration} seed={p.seed} x={0} y={0} size={p.size} rotate={p.rotate} marker={p.marker} delay={d} />
              </g>
              {!mini ? (
                <text
                  className={`thing-label${d !== undefined ? " is-writing" : ""}`}
                  x={lp.dx}
                  y={lp.dy}
                  textAnchor={lp.anchor}
                  dominantBaseline={lp.baseline}
                  transform={`rotate(${p.labelRotate} ${lp.dx} ${lp.dy})`}
                  style={d !== undefined ? ({ "--d": `${d + 0.8}s` } as CSSProperties) : undefined}
                >
                  {p.label}
                </text>
              ) : null}
            </g>
          </g>
        );
      })}

      {/* the outer ring: what other people added */}
      {outer ? (
        <g className="outer">
          {outerRing ? <path d={outerRing} fill="none" className="outer-ring" pathLength={1} /> : null}
          {outer.placed.map((p, i) => {
            const k = byId.get(p.id);
            if (!k) return null;
            // Already there when the page opened: lands after the drawing, in turn.
            // Added while looking (yours, or anyone's arriving live): lands right now.
            const already = k.createdAt <= openedAt - 1000;
            const land = !animate ? undefined : already ? outerAt + 0.35 + i * 0.4 : 0.1;
            return (
              <OuterThing
                key={p.id}
                p={p}
                k={k}
                land={land}
                selected={selectedId === p.id}
                onOpen={() => onOpen?.(p.id)}
              />
            );
          })}
        </g>
      ) : null}

      {newest && !mini ? <circle className="pen-dot" cx={newest.x + newest.size * 0.42} cy={newest.y - newest.size * 0.42} r={7} /> : null}
    </svg>
  );
}

/**
 * One thing someone added, drawn in the page's own hand: a note is a taped
 * slip, a memory a slip with a marker edge, a photo a tiny print, a reaction a
 * doodle with one word. A thin line runs in to the moment it belongs to.
 */
function OuterThing({ p, k, land, selected, onOpen }: { p: OuterPlaced; k: CanvasContribution; land: number | undefined; selected: boolean; onOpen: () => void }) {
  const line = useMemo(() => connectorPath([p.x, p.y], p.anchor, p.seed), [p.x, p.y, p.anchor, p.seed]);
  // Fixed at first render: a thing that has landed doesn't land again when the page re-renders.
  const [d] = useState(land);
  const arriving = d !== undefined;
  const clip = `outer-photo-${p.id}`;
  return (
    <g
      className={`outer-thing is-${k.type}${selected ? " is-selected" : ""}${k.reading ? " is-reading" : ""}${arriving ? " is-arriving" : ""}`}
      style={arriving ? ({ "--land": `${d}s` } as CSSProperties) : undefined}
      tabIndex={0}
      role="button"
      aria-label={`${k.by}: ${k.text ?? k.label}`}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
    >
      <path d={line} className={`outer-line${arriving ? " ink-stroke" : ""}`} pathLength={1} fill="none" style={arriving ? ({ "--d": `${d! + 0.5}s`, "--dur": "0.7s" } as CSSProperties) : undefined} />
      <g className="outer-pos" style={{ transform: `translate(${p.x}px, ${p.y}px) rotate(${p.rotate}deg)` }}>
        <g className="outer-art">
          {k.type === "reaction" ? (
            <>
              <Doodle id={k.illustration} seed={p.seed} x={0} y={-12} size={78} delay={d} />
              <text className="outer-word" x={0} y={46} textAnchor="middle">
                {k.label}
              </text>
            </>
          ) : k.type === "photo" ? (
            <>
              <rect className="print-sheet outer-sheet" x={-78} y={-98} width={156} height={184} rx={2} />
              <defs>
                <clipPath id={clip}>
                  <rect x={-68} y={-88} width={136} height={136} rx={1} />
                </clipPath>
              </defs>
              {k.photoUrl ? (
                <image href={k.photoUrl} x={-68} y={-88} width={136} height={136} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip})`} />
              ) : (
                <rect x={-68} y={-88} width={136} height={136} fill="var(--paper-deep)" />
              )}
              <text className="outer-chin" x={0} y={70} textAnchor="middle">
                {k.label}
              </text>
              <rect className="tape" x={-26} y={-108} width={52} height={18} transform="rotate(-4 0 -99)" />
            </>
          ) : (
            <>
              <rect className="print-sheet outer-sheet" x={-p.w} y={-p.h} width={p.w * 2} height={p.h * 2} rx={2} />
              {k.type === "memory" ? <rect className="outer-edge" x={-p.w} y={-p.h} width={7} height={p.h * 2} /> : <rect className="tape" x={-22} y={-p.h - 9} width={44} height={16} transform={`rotate(3 0 ${-p.h})`} />}
              {p.lines.map((l, i) => (
                <text key={i} className="outer-text" x={-p.w + 20} y={-p.h + 30 + i * 26}>
                  {l}
                </text>
              ))}
              <g className="outer-mark">
                <Doodle id={k.illustration} seed={p.seed} x={p.w - 6} y={-p.h + 4} size={46} delay={d} penWidth={2.2} />
              </g>
            </>
          )}
          <text className="outer-by" x={0} y={k.type === "reaction" ? 66 : k.type === "photo" ? 104 : p.h + 20} textAnchor="middle">
            {k.reading ? "reading…" : `— ${k.by}`}
          </text>
        </g>
      </g>
    </g>
  );
}
