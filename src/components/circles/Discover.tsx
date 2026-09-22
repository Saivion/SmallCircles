"use client";

import { useQuery } from "convex/react";
import type { CSSProperties } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useHour } from "@/lib/hour";
import { openView } from "@/lib/route";
import { CircleCoin } from "./CircleCoin";
import { Mark } from "./Home";

type Props = { slug: string; onOpen: (id: Id<"circles">) => void };

/**
 * Discover: not a feed. Three moments, the ones the fewest people have seen,
 * this hour's first. Pick one, add something small, come back for the next.
 * Visiting is also how your own moment gets featured: give attention, get it.
 */
export function Discover({ slug, onOpen }: Props) {
  const { hour } = useHour();
  const d = useQuery(api.circles.discover, { slug, hour });

  return (
    <main className="view view-discover">
      <header className="discover-head">
        <button type="button" className="pill pill-quiet" onClick={() => openView("home")}>
          ← the hour
        </button>
        <span className="discover-mark">
          <Mark size={28} />
        </span>
      </header>

      <section className="discover-intro">
        {/* <p className="stamp">this hour · {prompt}</p> */}
        <h1 className="title">three moments. open one.</h1>
        <p className="hand muted">these are the ones the fewest people have seen. add something small, then come back for the next.</p>
        {/* a fixed slot, so the line arriving with the data never nudges the page */}
        <div className="owed-slot">{d && d.owed > 0 ? <Owed owed={d.owed} /> : null}</div>
      </section>

      {d === undefined ? (
        // Three empty rings the size of the real ones hold the layout while the moments load.
        <section className="discover-three is-waiting" aria-label="finding moments" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="discover-pick is-placeholder" style={{ rotate: `${(i - 1) * 1.6}deg`, "--i": i } as CSSProperties} aria-hidden>
              <svg viewBox="0 0 200 200" className="coin">
                <circle cx="100" cy="100" r="58" className="placeholder-photo" />
                <circle cx="100" cy="100" r="76" className="placeholder-ring" />
              </svg>
              <span className="coin-title">&nbsp;</span>
              <span className="stamp coin-date">&nbsp;</span>
            </div>
          ))}
        </section>
      ) : d.moments.length === 0 ? (
        <section className="discover-empty">
          <p className="hand">you&apos;ve seen every moment out there right now.</p>
          <p className="hand muted">share yours, or come back in a little while.</p>
          <button type="button" className="pill" onClick={() => openView("home")}>
            back to the hour
          </button>
        </section>
      ) : (
        <section className="discover-three">
          {d.moments.map((c, i) => (
            <button key={c._id} type="button" className="discover-pick is-arriving" style={{ rotate: `${(i - 1) * 1.6}deg`, "--i": i } as CSSProperties} onClick={() => onOpen(c._id)}>
              <CircleCoin id={c._id} seed={c.generationSeed} photoUrl={c.photoUrl} illustrations={c.illustrations} drawing={c.status === "drawing"} />
              <span className="coin-title">{c.title}</span>
              <span className="stamp coin-date">
                {c.seeded ? "a starter moment" : (c.author ?? "someone")}
                {!c.seeded && c.hour === hour ? " · this hour" : c.prompt ? ` · ${c.prompt}` : ""}
              </span>
              {d.revisits.includes(c._id) ? (
                <span className="discover-seen is-revisit">you&apos;ve been here · see what&apos;s new</span>
              ) : c.views === 0 ? (
                <span className="discover-seen">nobody has seen this yet</span>
              ) : null}
            </button>
          ))}
        </section>
      )}
    </main>
  );
}

/** How close your own moment is to going out: dots that fill as you visit. */
function Owed({ owed }: { owed: number }) {
  const total = 3;
  const done = Math.max(0, total - owed);
  return (
    <p className="owed">
      <span className="owed-dots" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={i < done ? "is-done" : ""} />
        ))}
      </span>
      your moment gets featured after {owed} more visit{owed === 1 ? "" : "s"}
    </p>
  );
}
