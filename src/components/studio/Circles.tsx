"use client";

import { memo, useState } from "react";
import { isBroken } from "@/lib/mind/aspect";
import { tileKind } from "@/lib/mind/masonry";
import { allCards } from "@/lib/mind/store";
import type { AgentColor, Tool } from "@/lib/mind/types";
import { ToolIcon } from "./ToolIcon";

/** The mark: the SmallCircles logo. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="mark" src="/SmallCirclesLogo.png" width={size} height={size} alt="" aria-hidden="true" decoding="async" />
  );
}

/**
 * An orb: a lead or a crew member as a small circle in its lead's colour,
 * with the tool it uses. While it works, a ring turns around it.
 */
export const Orb = memo(function Orb({
  color,
  tool,
  live = false,
  size = 28,
  title,
}: {
  color: AgentColor;
  tool: Tool;
  live?: boolean;
  size?: number;
  title?: string;
}) {
  return (
    <span className={`orb tone-${color}${live ? " is-live" : ""}`} style={{ width: size, height: size }} title={title}>
      <ToolIcon tool={tool} size={Math.round(size * 0.56)} live={live} />
    </span>
  );
});

/**
 * Up to three picture URLs from a board for its cover. Prefers kept image
 * cards, then any other card with a real image so the three dots fill when
 * the circle has photos.
 */
export function coverImages(boardId: string, max = 3): string[] {
  const cards = allCards().filter(
    (c) => c.boardId === boardId && c.kind !== "archived" && !c.twinOf && c.imageUrl && !isBroken(c._id),
  );
  const rank = (c: (typeof cards)[number]) =>
    Number(tileKind(c) === "image") * 4 + Number(!!c.inFocus) * 2 + (c.focusScore ?? 0) / 100;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...cards].sort((a, b) => rank(b) - rank(a) || b.createdAt - a.createdAt)) {
    const url = c.imageUrl!;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/** Logo colours for empty cover slots — apricot, bubblegum, coffee bean. */
const FILL = ["cover-fill-a", "cover-fill-b", "cover-fill-c"] as const;

/**
 * A circle's cover: three overlapping round pictures. Missing or broken
 * images become solid logo-colour dots so the mark shape still reads.
 */
export const CircleCover = memo(function CircleCover({
  images,
  size = 44,
  running = false,
}: {
  images: string[];
  size?: number;
  running?: boolean;
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const slots = [0, 1, 2] as const;

  return (
    <span className={`cover${running ? " is-running" : ""}`} style={{ width: size, height: size }} aria-hidden="true">
      {slots.map((i) => {
        const src = images[i];
        const show = src && !failed.has(src);
        return (
          <span key={i} className={`cover-dot cover-${i}${show ? "" : ` ${FILL[i]}`}`}>
            {show ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setFailed((prev) => new Set(prev).add(src))}
              />
            ) : null}
          </span>
        );
      })}
    </span>
  );
});
