/**
 * What a card looks like on the wall: which face it gets, the words on it,
 * and how tall it will stand. Each card goes into the column that is
 * currently shortest, so the wall stays even. Heights are estimates from
 * what a tile will show; pictures use their real shape once they load.
 */
import { getAspect, isBroken } from "./aspect";
import type { Card } from "./types";

export type TileKind = "image" | "quote" | "note" | "doc" | "pending" | "failed";

export const GAP = 18;
/** The caption box: its padding, then however many lines the words need. */
const CAP_PAD = 21;
const CAP_LINE = 15.2;
/** Captions are cut at a word before this, so no card is mostly caption. */
const CAP_CHARS = 170;

/** Which face a card gets. */
export function tileKind(card: Card): TileKind {
  if (card.status === "new" || card.status === "reading") return "pending";
  if (card.status === "failed") return "failed";
  if (card.imageUrl && card.kind !== "raw" && !isBroken(card._id)) return "image";
  if (card.quote) return "quote";
  if (noteText(card)) return "note";
  return "doc";
}

/** The written summary on a card, without the page text that follows it. */
export function noteText(card: Card) {
  const summary = (card.body ?? "").split("\n\n")[0]?.trim() ?? "";
  if (summary.length >= 40) return summary.slice(0, 260);
  return card.caption && card.caption.length >= 40 ? card.caption : "";
}

function hostOf(url?: string) {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function cut(text: string): string {
  const t = text.trim();
  if (t.length <= CAP_CHARS) return t;
  return `${t.slice(0, CAP_CHARS).replace(/[\s,;:.–—-]*\S*$/, "")}…`;
}

/** The line under a tile. The same text the tile shows, so heights match. */
export function captionText(card: Card): string {
  const domain = card.domain ?? hostOf(card.url);
  switch (tileKind(card)) {
    case "quote":
      return `Quote · ${domain || card.title}`;
    case "doc":
      return domain || card.title;
    case "pending":
      return `${card.status === "reading" ? "Being read" : "Waiting"}${domain ? ` · ${domain}` : ""}`;
    case "failed":
      return `Couldn't open ${domain}`;
    case "image":
      return cut(card.caption ?? card.title);
    default:
      return cut(card.title);
  }
}

/** How tall the caption box stands: every line its words need, nothing cut. */
function captionHeight(card: Card, colW: number): number {
  const perLine = Math.max(16, (colW - 24) / 5.6);
  return CAP_PAD + Math.max(1, Math.ceil(captionText(card).length / perLine)) * CAP_LINE;
}

function lines(text: string, perLine: number) {
  return Math.max(1, Math.ceil(text.length / perLine));
}

export function estimateHeight(card: Card, colW: number): number {
  const CAPTION = captionHeight(card, colW);
  switch (tileKind(card)) {
    case "image": {
      const r = getAspect(card._id);
      const h = r ? colW / r : colW * 1.05;
      return Math.min(colW * 1.7, Math.max(colW * 0.6, h)) + CAPTION;
    }
    case "quote":
      return 56 + lines(card.quote ?? "", Math.max(14, colW / 11)) * 27 + CAPTION;
    case "note":
      return Math.min(300, 40 + lines(noteText(card), Math.max(18, colW / 8.4)) * 18) + CAPTION;
    case "doc":
      return colW * 1.1 + CAPTION;
    case "pending":
      return 140 + CAPTION;
    case "failed":
      return 110 + CAPTION;
  }
}

export type MasonryItem = { key: string; height: number };

/** Split items into `columns` stacks, shortest column first. */
export function distribute<T extends MasonryItem>(items: readonly T[], columns: number, start: readonly number[] = []): T[][] {
  const cols: T[][] = Array.from({ length: Math.max(1, columns) }, () => []);
  const heights = cols.map((_, i) => start[i] ?? 0);
  for (const item of items) {
    let best = 0;
    for (let i = 1; i < heights.length; i++) if (heights[i] < heights[best] - 1) best = i;
    cols[best].push(item);
    heights[best] += item.height + GAP;
  }
  return cols;
}
