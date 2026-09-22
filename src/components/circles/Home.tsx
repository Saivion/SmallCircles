"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState, useSyncExternalStore, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { aliasChoices } from "@convex/lib/names";
import { hash } from "@/lib/doodle/pen";
import { leftLabel, useHour } from "@/lib/hour";
import { useHere } from "@/lib/presence";
import { CircleCoin } from "./CircleCoin";
import { Composer } from "./Composer";
import { DoodleIcon } from "./Doodle";
import { DropZone } from "./DropZone";

type Props = { slug: string; onOpen: (id: Id<"circles">) => void };

/** The mark: three small circles, drawn. */
export function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="mark">
      <circle cx="15" cy="16" r="9" fill="var(--marker-sun)" />
      <circle cx="25" cy="17" r="8" fill="none" stroke="var(--ink)" strokeWidth="2" />
      <circle cx="19" cy="26" r="7" fill="none" stroke="var(--ink)" strokeWidth="2" />
      <circle cx="30" cy="30" r="2.4" fill="var(--pop)" />
    </svg>
  );
}

export type Summary = {
  _id: Id<"circles">;
  title: string;
  subtitle: string | null;
  dateLabel: string | null;
  status: "drawing" | "done" | "failed";
  photoUrl: string | null;
  generationSeed: number;
  illustrations: string[];
  author: string | null;
  prompt: string | null;
  hour: number | null;
  isMine: boolean;
  released: boolean;
  owed: number;
  views: number;
  contributionCount: number;
  connectionCount: number;
  unseen: number;
  seeded: boolean;
};

/** The ring always has this many seats, so with one moment or eight the page stays balanced. */
const SLOTS = 8;
/** On a phone the ring is small: six is as many as can sit round it without touching. */
const PHONE_SLOTS = 6;

const NARROW = "(max-width: 700px)";
function subscribeNarrow(cb: () => void) {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
/** Phones and narrow windows (the layout that scrolls). */
function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
}
/** One trip round the ring, in seconds. Matches `orbit` in globals.css. */
const ORBIT_S = 150;

/**
 * Where the ring is right now, as a negative animation delay. Both the ring and
 * each circle's counter-spin read the wall clock, so a circle that arrives
 * mid-turn still stands upright.
 */
function useOrbitPhase(): string {
  const [phase] = useState(() => `-${((Date.now() / 1000) % ORBIT_S).toFixed(2)}s`);
  return phase;
}

/** Drawings that keep an empty seat company. */
export const FILLERS = ["tower", "coffee", "sunset", "ticket", "map", "people", "wave", "calendar", "plane", "music", "cake", "moon"];

/** Who shared it, as the ring says it. */
export function byLine(c: Summary, hour: number): string {
  if (c.seeded) return "a starter moment";
  const who = c.author ?? "someone";
  return c.hour === hour ? `${who} · this hour` : who;
}

/**
 * Home: the hour's prompt in the middle, everyone's moments drifting round it,
 * and yours underneath with what people have added to them.
 */
export function Home({ slug, onOpen }: Props) {
  const { hour, prompt, minutesLeft } = useHour();
  const narrow = useNarrow();
  const slots = narrow ? PHONE_SLOTS : SLOTS;
  const pool = useQuery(api.circles.pool, { slug, hour, limit: slots });
  const mine = useQuery(api.circles.list, { slug });
  const [file, setFile] = useState<File | null>(null);

  if (pool === undefined || mine === undefined) {
    return (
      <main className="view view-home">
        <p className="hand muted loading-line">finding this hour&apos;s circles…</p>
      </main>
    );
  }


  const hasSide = mine.length > 0;

  return (
    <main className={`view view-home${hasSide ? " has-side" : ""}`}>
      <div className="home-main">
        <header className="home-head">
          <Mark />
          <span className="wordmark">small circles</span>
        </header>
        <p className="home-line">share a moment. find who else was there.</p>
        <Identity slug={slug} />

        <div className="orbit-wrap">
          <section className="stage-orbit" aria-label="moments from this hour" style={{ "--slot-w": "19%" } as CSSProperties}>
            <div className="orbit-track" aria-hidden />
            <Ring>
              {Array.from({ length: slots }, (_, i) => {
                const c = pool[i];
                return (
                  <Slot key={c?._id ?? `slot-${i}`} i={i} of={slots}>
                    {c ? <Coin circle={c} sub={byLine(c, hour)} onOpen={() => onOpen(c._id)} /> : <Filler id={FILLERS[(i + hour) % FILLERS.length]} i={i} />}
                  </Slot>
                );
              })}
            </Ring>
            <div className="orbit-center">
              <DropZone onPick={setFile}>
                <span className="stamp drop-stamp">{leftLabel(minutesLeft)}</span>
                <span className="drop-prompt">{prompt}</span>
                <span className="drop-sub">drop a photo here, or tap to answer</span>
              </DropZone>
            </div>
          </section>
        </div>

      </div>

      {hasSide ? (
        <aside className="home-side" aria-label="your moments">
          <Yours circles={mine} onOpen={onOpen} />
          <Reach slug={slug} circles={mine} />
        </aside>
      ) : null}

      {file ? (
        <Composer
          key={`${file.name}:${file.size}:${file.lastModified}`}
          slug={slug}
          file={file}
          prompt={prompt}
          onClose={() => setFile(null)}
          onShared={(id) => {
            setFile(null);
            onOpen(id);
          }}
        />
      ) : null}
    </main>
  );
}

export function Ring({ children }: { children: ReactNode }) {
  const phase = useOrbitPhase();
  return (
    <div className="orbit-spin" style={{ animationDelay: phase }}>
      {children}
    </div>
  );
}

export function Slot({ i, of, children }: { i: number; of: number; children: ReactNode }) {
  const phase = useOrbitPhase();
  const angle = (i / of) * 360 - 90;
  return (
    <div className="orbit-slot" style={{ "--a": `${angle}deg`, "--i": i } as CSSProperties}>
      <div className="orbit-upright" style={{ animationDelay: phase }}>
        {children}
      </div>
    </div>
  );
}

export function Coin({ circle: c, sub, onOpen, badge }: { circle: Summary; sub: string; onOpen: () => void; badge?: string | null }) {
  return (
    <button type="button" className="coin-button" onClick={onOpen} aria-label={`${c.title}, ${sub}`}>
      <span className="coin-wrap">
        <CircleCoin id={c._id} seed={c.generationSeed} photoUrl={c.photoUrl} illustrations={c.illustrations} drawing={c.status === "drawing"} />
        {badge ? <span className="coin-badge">{badge}</span> : null}
      </span>
      <span className="coin-title">{c.status === "drawing" && c.title === "a moment" ? "drawing…" : c.title}</span>
      <span className="stamp coin-date">{sub}</span>
    </button>
  );
}

export function Filler({ id, i }: { id: string; i: number }) {
  return (
    <span className="orbit-filler" style={{ "--i": i } as CSSProperties}>
      <DoodleIcon id={id} seed={hash(`${id}:${i}`)} size={64} delay={0.3 + i * 0.2} />
    </span>
  );
}

/** What your own circle says under it: waiting, what's new, or who's seen it. Only you see this. */
function yourLine(c: Summary): string {
  if (c.status === "drawing") return "drawing…";
  if (c.hour === null) return "only you";
  if (!c.released) return `featured after ${c.owed} more visit${c.owed === 1 ? "" : "s"}`;
  // New since you last opened it says so, in words, so it never looks like the same line in another colour.
  if (c.unseen > 0) return c.views > 0 ? `${c.unseen} new · seen by ${c.views}` : `${c.unseen} new`;
  const seen = c.views === 0 ? "featured" : `seen by ${c.views}`;
  return c.contributionCount > 0 ? `${seen} · ${c.contributionCount} added` : seen;
}

/** Visits it takes before a moment is featured (give to get). Matches GIVE_BEFORE_GET in convex/circles.ts. */
const VISITS_TO_FEATURE = 3;

/** How close a waiting moment is to being featured: a short dotted track, one dot per visit. */
function FeatureProgress({ owed }: { owed: number }) {
  const done = Math.max(0, VISITS_TO_FEATURE - owed);
  return (
    <span className="yours-progress" role="img" aria-label={`${done} of ${VISITS_TO_FEATURE} visits done`}>
      {Array.from({ length: VISITS_TO_FEATURE }, (_, i) => (
        <i key={i} className={i < done ? "is-done" : undefined} />
      ))}
    </span>
  );
}

/** Your moments, stacked down the side: come back here to see what strangers added. */
function Yours({ circles, onOpen }: { circles: Summary[]; onOpen: (id: Id<"circles">) => void }) {
  const fresh = circles.reduce((n, c) => n + c.unseen, 0);
  return (
    <section className="yours">
      <h2 className="yours-head">
        yours
        {fresh > 0 ? <span className="yours-new">{fresh} new</span> : null}
      </h2>
      <ol className="yours-list">
        {circles.map((c) => (
          <li key={c._id}>
            <button
              type="button"
              className={`yours-row${c.unseen > 0 ? " has-new" : ""}`}
              onClick={() => onOpen(c._id)}
              aria-label={`${c.title}: ${yourLine(c)}`}
              title={yourLine(c)}
            >
              <span className="yours-coin">
                <CircleCoin id={c._id} seed={c.generationSeed} photoUrl={c.photoUrl} illustrations={c.illustrations} drawing={c.status === "drawing"} />
                {c.unseen > 0 ? <span className="coin-badge">+{c.unseen}</span> : null}
              </span>
              <span className="yours-text">
                <span className="yours-title">{c.status === "drawing" && c.title === "a moment" ? "drawing…" : c.title}</span>
                {!c.released && c.hour !== null && c.status !== "drawing" ? <FeatureProgress owed={c.owed} /> : null}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Who you are here, and who else is: two random words each, nothing more. */
function Identity({ slug }: { slug: string }) {
  const me = useQuery(api.people.me, { slug });
  const here = useHere(slug);
  const choose = useMutation(api.people.chooseAlias);
  const [choices, setChoices] = useState(() => aliasChoices(3));
  const [picking, setPicking] = useState(false);
  if (!me) return <p className="identity">&nbsp;</p>;

  const count = here?.count ?? 1;
  const company = count <= 1 ? "just you here" : `${count} here`;

  if (!me.chosen || picking) {
    return (
      <div className="identity identity-pick">
        <span className="hand">{me.chosen ? "go by something else:" : "who are you here?"}</span>
        {choices.map((a) => (
          <button
            key={a}
            type="button"
            className="name-chip"
            onClick={() => {
              void choose({ slug, alias: a }).then(() => setPicking(false));
            }}
          >
            {a}
          </button>
        ))}
        <button type="button" className="link-quiet" onClick={() => setChoices(aliasChoices(3))} aria-label="other names">
          others
        </button>
      </div>
    );
  }
  return (
    <p className="identity">
      you&apos;re{" "}
      <button type="button" className="name-chip is-me" onClick={() => setPicking(true)} title="pick another name">
        {me.alias}
      </button>{" "}
      <span className="identity-here">
        <i aria-hidden /> {company}
      </span>
    </p>
  );
}

/**
 * How far your moments have travelled: times seen, and things people added.
 * Only you see these. If Small Circles has no address for you yet, one quiet line
 * offers to email you when your moments connect (that's where those emails go).
 */
function Reach({ slug, circles }: { slug: string; circles: Summary[] }) {
  const inbox = useQuery(api.circles.inbox, { slug });
  const shared = circles.filter((c) => c.hour !== null);
  const total = (f: (c: Summary) => number) => shared.reduce((n, c) => n + f(c), 0);
  const seen = total((c) => c.views);
  const added = total((c) => c.contributionCount);
  // Drawn, not written: an eye and a heart. The words are there for screen readers and on hover.
  const stats = [
    { n: seen, drawing: "eye", word: seen === 1 ? "time seen" : "times seen" },
    { n: added, drawing: "heart", word: added === 1 ? "thing added" : "things added" },
  ];
  return (
    <div className="reach">
      <p className="stamp reach-head">your moments so far</p>
      <ul className="reach-stats">
        {stats.map((s) => (
          <li key={s.drawing} title={`${s.n} ${s.word}`} aria-label={`${s.n} ${s.word}`}>
            <DoodleIcon id={s.drawing} seed={hash(`reach:${s.drawing}`)} size={38} />
            <span className="reach-n" aria-hidden>
              {s.n}
            </span>
          </li>
        ))}
      </ul>
      {inbox && !inbox.from ? <NotifyMe slug={slug} /> : null}
    </div>
  );
}

/** Where to send word when your moments connect or grow. Shown only until there's an address. */
function NotifyMe({ slug }: { slug: string }) {
  const setFrom = useMutation(api.circles.setEmailFrom);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await setFrom({ slug, email: value });
    } catch (err) {
      setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : "that didn't save.");
    }
  };
  return (
    <form className="notify-me" onSubmit={save}>
      <label className="hand" htmlFor="notify-me">
        email me when my moments connect
      </label>
      <span className="notify-me-row">
        <input id="notify-me" type="email" placeholder="your email" value={value} onChange={(e) => setValue(e.target.value)} required />
        <button type="submit" className="pill">
          save
        </button>
      </span>
      {error ? <span className="drop-error">{error}</span> : null}
    </form>
  );
}
