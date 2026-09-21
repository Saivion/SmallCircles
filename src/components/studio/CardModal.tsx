"use client";

import { useMutation } from "convex/react";
import { Archive, ArchiveRestore, ExternalLink, Trash2, X } from "lucide-react";
import { memo, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { actorName } from "@/lib/mind/crew";
import { noteText } from "@/lib/mind/masonry";
import { getAgent, getBoard, getCard, subscribeCard, subscribeTasks, tasksForCard } from "@/lib/mind/store";
import { closeCard, getOpenCardId, readNull, selectBoard, subscribeOpen } from "@/lib/mind/ui";
import { Orb } from "./Circles";

function readZero() {
  return 0;
}

/**
 * A card, up close, over a soft veil: the thing itself on the left; on the
 * right what it is, whether it was kept and why, where it came from, and
 * the crew's path that brought it here.
 */
export const CardModal = memo(function CardModal() {
  const id = useSyncExternalStore(subscribeOpen, getOpenCardId, readNull);
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id]);
  if (!id) return null;
  return <Body key={id} id={id} />;
});

function Body({ id }: { id: string }) {
  const subscribe = useCallback((l: () => void) => subscribeCard(id, l), [id]);
  const read = useCallback(() => getCard(id), [id]);
  const card = useSyncExternalStore(subscribe, read, read);
  const readSteps = useCallback(() => tasksForCard(id).length, [id]);
  useSyncExternalStore(subscribeTasks, readSteps, readZero);
  const archive = useMutation(api.cards.archive);
  const restore = useMutation(api.cards.restore);
  const remove = useMutation(api.cards.remove);
  const [busy, setBusy] = useState(false);
  if (!card) return null;

  const board = card.boardId ? getBoard(card.boardId) : undefined;
  const twin = card.twinOf ? getCard(card.twinOf) : undefined;
  const steps = tasksForCard(id);
  const archived = card.kind === "archived";
  const summary = noteText(card);
  const origin =
    card.source === "found"
      ? card.query?.startsWith("followed from")
        ? `Link Follower ${card.query}`
        : `Found searching “${card.query ?? board?.title ?? ""}”`
      : card.source === "email"
        ? "Emailed in"
        : "You saved it";

  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="veil" onClick={closeCard}>
      <div className="lightbox" role="dialog" aria-label={card.title} onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-media">
          {card.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.imageUrl} alt="" decoding="async" />
          ) : card.quote ? (
            <blockquote className="lightbox-quote">“{card.quote}”</blockquote>
          ) : (
            <p className="lightbox-note">{summary || card.title}</p>
          )}
        </div>
        <div className="lightbox-info">
          <div className="lightbox-top">
            {board ? (
              <button type="button" className="lightbox-circle" onClick={() => { closeCard(); selectBoard(board._id); }}>
                {board.title}
                {card.section ? ` · ${card.section}` : ""}
              </button>
            ) : (
              <span />
            )}
            <button type="button" className="panel-close" aria-label="Close" onClick={closeCard}>
              <X size={18} />
            </button>
          </div>
          <h2 className="lightbox-title">{card.title}</h2>
          {card.caption ? <p className="lightbox-caption">{card.caption}</p> : null}
          {card.url ? (
            <a className="lightbox-link" href={card.url} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={12} aria-hidden="true" /> {card.domain ?? card.url}
            </a>
          ) : null}

          {typeof card.focusScore === "number" || twin ? (
            <div className={`verdict${card.inFocus && !twin ? " is-kept" : ""}`}>
              <span className="verdict-ring" style={{ ["--fit" as string]: `${Math.round((card.focusScore ?? 0) * 100)}` }}>
                {Math.round((card.focusScore ?? 0) * 100)}
              </span>
              <span className="verdict-text">
                <b>{twin ? "Set aside as a twin" : card.inFocus ? "Kept" : "Set aside"}</b>
                {card.focusReason ? <span>{card.focusReason}</span> : null}
              </span>
            </div>
          ) : null}

          <p className="lightbox-origin">
            {origin}
            {card.type ? ` · ${card.type}` : ""}
          </p>

          {steps.length ? (
            <section className="path">
              <h3 className="path-label">How it got here</h3>
              <ol>
                {steps.map((t) => {
                  const agent = getAgent(t.agentId);
                  return (
                    <li key={t._id} className={`path-step state-${t.state}`}>
                      {agent ? <Orb color={agent.color} tool={t.tool} live={t.state === "running"} size={22} /> : null}
                      <span>
                        <b>{actorName(t)}</b> {t.label}
                        {t.note ? <small>{t.note}</small> : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          {summary && summary !== card.caption && (card.imageUrl || card.quote) ? <p className="lightbox-summary">{summary}</p> : null}

          <div className="lightbox-actions">
            {archived ? (
              <button type="button" className="pill" disabled={busy} onClick={() => void act(() => restore({ cardId: id as Id<"cards"> }))}>
                <ArchiveRestore size={14} aria-hidden="true" /> Restore
              </button>
            ) : (
              <button type="button" className="pill" disabled={busy} onClick={() => void act(() => archive({ cardId: id as Id<"cards"> }))}>
                <Archive size={14} aria-hidden="true" /> Archive
              </button>
            )}
            <button
              type="button"
              className="pill"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  if (!window.confirm("Remove this card?")) return;
                  closeCard();
                  await remove({ cardId: id as Id<"cards"> });
                })
              }
            >
              <Trash2 size={14} aria-hidden="true" /> Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
