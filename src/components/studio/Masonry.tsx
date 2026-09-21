"use client";

import { useEffect, useState, type ReactNode } from "react";
import { distribute, GAP } from "@/lib/mind/masonry";

/** `span: 2` puts an entry across the first two columns, at the top. */
export type MasonryEntry = { key: string; height: number; node: ReactNode; span?: 1 | 2 };

const MIN_COL = 208;
const MAX_COLS = 6;

/**
 * Measure a band and decide how many columns fit. A callback ref, so
 * measuring starts whenever the element appears, even if the view first
 * rendered nothing while its data was still arriving.
 */
export function useColumns() {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!node) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  const cols = width ? Math.max(1, Math.min(MAX_COLS, Math.floor((width + GAP) / (MIN_COL + GAP)))) : 0;
  const colW = cols ? (width - GAP * (cols - 1)) / cols : MIN_COL;
  return { ref: setNode, cols, colW };
}

/**
 * Each card into the column that is currently shortest, so the newest
 * things read left to right across the top and the wall stays even. An
 * entry with span 2 sits across the first two columns at the top.
 */
export function Masonry({ entries, cols, colW }: { entries: MasonryEntry[]; cols: number; colW: number }) {
  if (!cols) return null;
  const wide = cols >= 2 ? entries.find((e) => e.span === 2) : undefined;
  const rest = wide ? entries.filter((e) => e !== wide) : entries;
  const offset = wide ? wide.height + GAP : 0;
  const start = wide ? [offset, offset] : [];
  return (
    <div className="masonry" style={{ gap: GAP }}>
      {wide ? (
        <div className="masonry-wide" style={{ width: colW * 2 + GAP, height: wide.height }}>
          {wide.node}
        </div>
      ) : null}
      {distribute(rest, cols, start).map((col, i) => (
        <div key={i} className="masonry-col" style={{ gap: GAP, width: colW, paddingTop: i < 2 ? offset : 0 }}>
          {col.map((e) => (
            <div key={e.key}>{e.node}</div>
          ))}
        </div>
      ))}
    </div>
  );
}
