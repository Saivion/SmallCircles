"use client";

import type { Id } from "@convex/_generated/dataModel";
import { hash } from "@/lib/doodle/pen";
import { openCircle } from "@/lib/route";
import { DoodleIcon } from "./Doodle";

type Side = { _id: Id<"circles">; title: string; photoUrl: string | null; author: string | null; dateLabel: string | null };

export type Connection = {
  _id: Id<"circleConnections">;
  type: "same_place" | "same_landmark" | "nearby" | "same_day" | "similar_moment";
  reason: string;
  other: Side & { isMine: boolean };
};

const TYPE_WORD: Record<Connection["type"], string> = {
  same_place: "same place",
  same_landmark: "same landmark",
  nearby: "a few streets apart",
  same_day: "same day",
  similar_moment: "a lot alike",
};

/** What each connection is drawn with, where the thread meets. */
const TYPE_DRAWING: Record<Connection["type"], string> = {
  same_place: "pin",
  same_landmark: "star",
  nearby: "map",
  same_day: "calendar",
  similar_moment: "heart",
};

function Print({ side, name, tilt, onOpen }: { side: Side; name: string; tilt: number; onOpen?: () => void }) {
  const body = (
    <>
      <span className="crossed-photo" style={{ rotate: `${tilt}deg` }}>
        {side.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={side.photoUrl} alt={side.title} />
        ) : (
          <span className="crossed-photo-empty" />
        )}
      </span>
      <span className="crossed-name">{name}</span>
      {side.dateLabel ? <span className="stamp crossed-when">{side.dateLabel}</span> : null}
    </>
  );
  return onOpen ? (
    <button type="button" className="crossed-side is-other" onClick={onOpen} aria-label={`open ${side.title}, shared by ${name}`}>
      {body}
    </button>
  ) : (
    <span className="crossed-side">{body}</span>
  );
}

/**
 * Moments this one crossed paths with, as a small card taped into the margin:
 * the two photos as prints, a dashed thread between them caught on a drawing
 * that says how (a pin for the same place), and one plain sentence about it.
 */
export function CrossedPaths({ self, isMine, connections }: { self: Side; isMine: boolean; connections: Connection[] }) {
  if (connections.length === 0) return null;
  const mine = isMine ? "yours" : (self.author ?? "this moment");
  return (
    <section className="crossed" aria-label="crossed paths">
      <span className="add-tape" aria-hidden />
      <p className="stamp crossed-head">crossed paths</p>
      {connections.map((k) => {
        const theirs = k.other.isMine ? "yours" : (k.other.author ?? "someone");
        return (
          <article key={k._id} className="crossed-item">
            <div className="crossed-pair">
              <Print side={self} name={mine} tilt={-4} />
              <span className="crossed-thread" aria-hidden>
                <svg viewBox="0 0 100 40" preserveAspectRatio="none">
                  <path d="M0 26 C 22 8, 38 30, 50 20 S 80 6, 100 24" />
                </svg>
                <span className="crossed-knot">
                  <DoodleIcon id={TYPE_DRAWING[k.type]} seed={hash(`crossed:${k._id}`)} size={34} />
                </span>
              </span>
              <Print side={k.other} name={theirs} tilt={3.5} onOpen={() => openCircle(k.other._id)} />
            </div>
            <p className="crossed-type">{TYPE_WORD[k.type]}</p>
            <p className="crossed-reason">{k.reason}</p>
            <button type="button" className="link-quiet crossed-open" onClick={() => openCircle(k.other._id)}>
              {k.other.isMine ? "open your moment" : `see ${theirs}'s moment`} →
            </button>
          </article>
        );
      })}
    </section>
  );
}
