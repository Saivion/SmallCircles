"use client";

import { memo, useCallback, useSyncExternalStore } from "react";
import { markBroken, setAspect } from "@/lib/mind/aspect";
import { actorName } from "@/lib/mind/crew";
import { captionText, noteText, tileKind } from "@/lib/mind/masonry";
import { activeTaskOnCard, getAgent, getCard, getTask, subscribeCard, subscribeTasks } from "@/lib/mind/store";
import { getOpenCardId, openCard, readFalse, subscribeOpen } from "@/lib/mind/ui";
import { Orb } from "./Circles";

function readEmpty() {
  return "";
}

/**
 * A picture has to be at least this many pixels on its long side to stand as
 * a card face. Anything smaller is a logo or a thumbnail and would only show
 * up blurry, so the card falls back to its page face instead.
 */
const MIN_LONG_SIDE = 420;

function hostOf(url?: string) {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * One saved thing: the thing itself on a white card, and a short caption
 * underneath. Pictures stand alone, quotes are set in serif, notes in mono,
 * pages as a document with their title. While a crew member works the card,
 * the line underneath says who has it and what they are doing, and the edge
 * takes the lead's colour.
 */
export const Tile = memo(function Tile({ id }: { id: string }) {
  const subscribe = useCallback((l: () => void) => subscribeCard(id, l), [id]);
  const read = useCallback(() => getCard(id), [id]);
  const card = useSyncExternalStore(subscribe, read, read);
  const readOpen = useCallback(() => getOpenCardId() === id, [id]);
  const open = useSyncExternalStore(subscribeOpen, readOpen, readFalse);
  const readWork = useCallback(() => activeTaskOnCard(id)?._id ?? "", [id]);
  const workId = useSyncExternalStore(subscribeTasks, readWork, readEmpty);

  if (!card) return null;
  const kind = tileKind(card);
  const domain = card.domain ?? hostOf(card.url);
  const work = workId ? getTask(workId) : undefined;
  const worker = work ? getAgent(work.agentId) : undefined;
  const aside = card.inFocus === false || !!card.twinOf;
  const kept = !!card.inFocus && !card.twinOf;

  const caption = captionText(card);

  return (
    <article
      className={`tile k-${kind}${open ? " is-open" : ""}${aside ? " is-aside" : ""}${worker ? ` is-worked tone-${worker.color}` : ""}`}
      data-card-id={id}
    >
      <button type="button" className="tile-face" onClick={() => openCard(id)} aria-label={card.title}>
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={(el) => {
              if (el && el.complete && el.naturalWidth === 0 && el.currentSrc) markBroken(id);
            }}
            className="tile-img"
            src={card.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={(e) => {
              const img = e.currentTarget;
              const long = Math.max(img.naturalWidth, img.naturalHeight);
              if (long >= MIN_LONG_SIDE) setAspect(id, img.naturalWidth / img.naturalHeight);
              else markBroken(id);
            }}
            onError={() => markBroken(id)}
          />
        ) : null}
        {kind === "quote" ? <span className="tile-quote">“{card.quote}”</span> : null}
        {kind === "note" ? <span className="tile-note">{noteText(card)}</span> : null}
        {kind === "doc" || kind === "failed" ? (
          <span className="tile-doc">
            <span className="tile-doc-lines" aria-hidden="true" />
            {domain ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="tile-doc-icon" src={`https://icons.duckduckgo.com/ip3/${domain}.ico`} alt="" loading="lazy" decoding="async" />
            ) : null}
            <span className="tile-doc-title">{card.title}</span>
          </span>
        ) : null}
        {kind === "pending" ? (
          <span className="tile-pending">
            <span className="tile-pending-ring" aria-hidden="true" />
            <span className="tile-doc-title">{card.title}</span>
          </span>
        ) : null}
        {kept ? <span className="kept-dot" title="Kept" /> : null}
      </button>
      {work && worker ? (
        <p className="tile-cap is-work">
          <Orb color={worker.color} tool={work.tool} live size={18} />
          <span className="tile-work-name">{actorName(work)}</span>
          <span className="tile-work-label">{work.label}</span>
        </p>
      ) : (
        <p className="tile-cap">{caption}</p>
      )}
    </article>
  );
});
