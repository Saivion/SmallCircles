"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { openView, useView } from "@/lib/route";
import { AddSomething, ContributionCard } from "./Contribute";
import { CircleCanvas, type CanvasContribution, type CanvasElement } from "./CircleCanvas";
import { CrossedPaths } from "./CrossedPaths";
import { Explore } from "./Explore";

type Props = { slug: string; circleId: Id<"circles">; onClose: () => void };

function ago(t: number): string {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const TYPE_WORD = { note: "a note", memory: "a memory", photo: "a photo", reaction: "a reaction" } as const;

/**
 * One circle, open: the moment, the world Small Circles drew around it, and
 * the outer ring of what people added. The author comes back here to see who
 * added what; a visitor adds something and watches the circle grow.
 */
export function CircleView({ slug, circleId, onClose }: Props) {
  const circle = useQuery(api.circles.get, { slug, circleId });
  const remove = useMutation(api.circles.remove);
  const seen = useMutation(api.circles.seen);
  const view = useView();
  const [selected, setSelected] = useState<string | null>(null);

  // Opening it is the visit: counted once per person, and it pays down give-to-get.
  const ready = circle !== undefined && circle !== null;
  useEffect(() => {
    if (ready) void seen({ slug, circleId }).catch(() => {});
  }, [ready, slug, circleId, seen, circle?.contributionCount]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.closest("input, textarea")) return;
      if (selected) setSelected(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, onClose]);

  const elements: CanvasElement[] = useMemo(
    () =>
      (circle?.elements ?? []).map((e) => ({
        id: e._id,
        illustration: e.illustration,
        label: e.label,
        importance: e.importance,
        kind: e.kind,
        pointsAt: e.pointsAt,
        order: e.order,
        detail: e.detail,
        createdAt: e.createdAt,
      })),
    [circle?.elements],
  );
  const contributions: CanvasContribution[] = useMemo(
    () =>
      (circle?.contributions ?? []).map((k) => ({
        id: k._id,
        type: k.type,
        illustration: k.illustration,
        label: k.label,
        text: k.text,
        by: k.by,
        photoUrl: k.photoUrl,
        reading: k.state === "reading",
        createdAt: k.createdAt,
      })),
    [circle?.contributions],
  );

  const back = view === "discover" ? "← three moments" : "← the hour";

  if (circle === undefined) {
    return (
      <main className="view view-circle is-loading">
        <p className="hand muted">opening the page…</p>
      </main>
    );
  }
  if (circle === null) {
    return (
      <main className="view view-circle">
        <p className="hand">this circle isn&apos;t here any more.</p>
        <button type="button" className="pill" onClick={onClose}>
          {back.replace("← ", "back to ")}
        </button>
      </main>
    );
  }

  const drawing = circle.status === "drawing";
  const ctx = circle.context;
  const chin = [ctx.place?.city ?? ctx.place?.name, ctx.light ?? ctx.timeOfDay].filter(Boolean).join(" · ").toLowerCase() || circle.dateLabel;
  const openElement = selected ? circle.elements.find((e) => e._id === selected) ?? null : null;
  const openContribution = selected ? circle.contributions.find((k) => k._id === selected) ?? null : null;
  const who = circle.author ?? "someone";

  return (
    <main className={`view view-circle${selected ? " is-exploring" : ""}`}>
      <nav className="circle-nav">
        <button type="button" className="pill pill-quiet" onClick={onClose}>
          {back}
        </button>
        <span className="circle-nav-end">
          {drawing ? (
            <span className="live">
              <i /> drawing
            </span>
          ) : null}
          {circle.isMine ? (
            <button
              type="button"
              className="link-quiet"
              onClick={() => {
                if (window.confirm("remove this circle, its photo and everything people added?")) {
                  void remove({ slug, circleId }).then(onClose);
                }
              }}
            >
              remove
            </button>
          ) : null}
        </span>
      </nav>

      <header className="circle-head">
        <div className="circle-head-main">
          <h1 className={`title circle-h1${circle.title === "a moment" ? " is-pending" : ""}`}>{circle.title}</h1>
          {circle.subtitle ? <p className="hand circle-sub">{circle.subtitle}</p> : null}
        </div>
        <dl className="circle-meta">
          {circle.prompt ? (
            <div>
              <dt className="stamp">topic</dt>
              <dd className="circle-meta-prompt">{circle.prompt}</dd>
            </div>
          ) : null}
          <div>
            <dt className="stamp">shared by</dt>
            <dd>{circle.seeded ? <span className="circle-meta-house">small circles · a starter</span> : <span className="name-chip is-small">{who}</span>}</dd>
          </div>
          {circle.note ? (
            <div>
              <dt className="stamp">{circle.seeded ? "the note" : "they wrote"}</dt>
              <dd className="circle-note" title={circle.note}>&ldquo;{circle.note}&rdquo;</dd>
            </div>
          ) : null}
        </dl>
      </header>

      {circle.isMine && !circle.released && circle.hour !== null ? (
        <p className="waiting">
          your moment gets featured after you visit {circle.owed} more{" "}
          <button type="button" className="link-pop" onClick={() => openView("discover")}>
            moment{circle.owed === 1 ? "" : "s"} →
          </button>
        </p>
      ) : null}

      <section className="stage">
        <div className="page">
          <CircleCanvas
            seed={circle.generationSeed}
            photoUrl={circle.photoUrl}
            elements={elements}
            contributions={contributions}
            drawing={drawing}
            palette={ctx.palette}
            kind={ctx.kind}
            chin={chin}
            selectedId={selected}
            onOpen={(id) => setSelected((s) => (s === id ? null : id))}
          />
        </div>

        <aside className="margin" aria-live="polite">
          {openElement ? (
            <Explore element={openElement} onClose={() => setSelected(null)} />
          ) : openContribution ? (
            <ContributionCard slug={slug} k={openContribution} onClose={() => setSelected(null)} />
          ) : (
            <>
              <CrossedPaths
                self={{ _id: circle._id, title: circle.title, photoUrl: circle.photoUrl, author: circle.author, dateLabel: circle.dateLabel }}
                isMine={circle.isMine}
                connections={circle.connections}
              />
              {!circle.isMine && circle.released ? (
                <AddSomething slug={slug} circleId={circle._id} title={circle.title} fromDiscover={view === "discover"} />
              ) : null}
              <ol className={`notes${drawing ? " is-live" : ""}`}>
                {circle.notes.map((n, i) => (
                  <li key={n._id} className="note" style={{ animationDelay: `${Math.min(i, 3) * 0.05}s` }}>
                    {n.text}
                  </li>
                ))}
              </ol>
              {drawing ? <Thinking /> : null}
              {circle.contributions.length > 0 ? (
                <ol className="added">
                  {circle.contributions
                    .slice()
                    .reverse()
                    .map((k) => (
                      <li key={k._id}>
                        <button type="button" className="added-row" onClick={() => setSelected(k._id)}>
                          <span className="added-who">{k.by}</span>
                          <span className="added-what">added {TYPE_WORD[k.type]}</span>
                          <span className="stamp added-when">{k.state === "reading" ? "reading…" : ago(k.createdAt)}</span>
                        </button>
                      </li>
                    ))}
                </ol>
              ) : null}
              {!drawing && circle.elements.length > 0 ? <p className="hint">tap anything around the photo</p> : null}
              {circle.status === "failed" ? <p className="hint">{circle.error ?? "this one didn't draw."}</p> : null}
            </>
          )}
        </aside>
      </section>

    </main>
  );
}

/**
 * Still working: two dashed hand-drawn rings turning opposite ways round a
 * small dot, under the last note, until the circle is drawn.
 */
function Thinking() {
  return (
    <span className="thinking" role="status" aria-label="still drawing">
      <svg viewBox="0 0 48 48" aria-hidden>
        <circle className="thinking-ring is-outer" cx="24" cy="24" r="19" />
        <circle className="thinking-ring is-inner" cx="24" cy="24" r="12" />
        <circle className="thinking-dot" cx="24" cy="24" r="3.6" />
      </svg>
    </span>
  );
}
