"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { aliasChoices } from "@convex/lib/names";
import { useHour } from "@/lib/hour";
import { CircleCanvas, type CanvasContribution, type CanvasElement } from "./CircleCanvas";
import { byLine, Coin, Filler, FILLERS, Mark, Ring, Slot, type Summary } from "./Home";

type Circle = NonNullable<FunctionReturnType<typeof api.circles.get>>;
type Props = { slug: string; onDone: () => void };
type Phase = "name" | "show" | "leaving";

/** How long the page takes to fade into the next one. Matches `.intro.is-leaving` in globals.css. */
const FADE_MS = 650;

/**
 * The way in. First a plain page: what this is, and which name you'll go by.
 * Then one example moment draws itself while three lines say how it works,
 * and a couple of strangers' additions land on it. Then it fades into the hour.
 */
export function Intro({ slug, onDone }: Props) {
  const me = useQuery(api.people.me, { slug });
  const choose = useMutation(api.people.chooseAlias);
  const { hour, prompt } = useHour();
  const pool = useQuery(api.circles.pool, { slug, hour, limit: 16 });
  const [phase, setPhase] = useState<Phase>("name");
  const [choices, setChoices] = useState(() => aliasChoices(3));
  const [busy, setBusy] = useState(false);
  /**
   * Whether they already had a name when this page opened. Latched on the
   * first answer: choosing one makes `me.chosen` true, and without this the
   * page would swap to "welcome back" for the moment it takes to leave.
   */
  const [returning, setReturning] = useState<boolean | null>(null);
  if (returning === null && me !== undefined) setReturning(me?.chosen === true);

  // The example: a finished starter moment with plenty drawn round it, fetched while they pick a name.
  const example = useMemo(() => {
    const done = (pool ?? []).filter((c) => c.status === "done");
    return done.find((c) => c.seeded && c.illustrations.length >= 5) ?? done.find((c) => c.illustrations.length >= 4) ?? null;
  }, [pool]);
  const circle = useQuery(api.circles.get, example ? { slug, circleId: example._id } : "skip");
  /**
   * The example, held once it arrives. The pool is live, so the example it
   * picks can change under us; without this the showcase would drop back to
   * the name page mid-play, or while fading out.
   */
  const [shown, setShown] = useState<Circle | null>(null);
  if (circle && circle !== shown) setShown(circle);

  useEffect(() => {
    if (phase !== "leaving") return;
    const t = window.setTimeout(onDone, FADE_MS);
    return () => window.clearTimeout(t);
  }, [phase, onDone]);

  const next = async (alias?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      if (alias) await choose({ slug, alias });
      setPhase(shown ? "show" : "leaving");
    } finally {
      setBusy(false);
    }
  };

  const finish = useCallback(() => setPhase("leaving"), []);

  if (phase !== "name" && shown) {
    return <Showcase circle={shown} leaving={phase === "leaving"} onFinish={finish} />;
  }

  return (
    <main className={`intro intro-name${phase === "leaving" ? " is-leaving" : ""}`}>
      <div className="intro-copy">
        <header className="intro-brand">
          <Mark size={30} />
          <span className="wordmark">small circles</span>
        </header>

        <h1 className="intro-title">
          we share more
          <br />
          than we know.
        </h1>
        <p className="intro-lede">share a moment, and see where it meets someone else&apos;s: the same place, the same night, the same kind of day.</p>

        <section className="intro-pick" aria-label="choose your name">
          {me === undefined || returning === null ? (
            <p className="hand muted">one moment…</p>
          ) : returning ? (
            <>
              <p className="intro-ask">welcome back, {me?.alias}.</p>
              <button type="button" className="pill intro-go" onClick={() => void next()} disabled={busy}>
                continue as {me?.alias} →
              </button>
              <div className="intro-pick-head is-quiet">
                <span className="intro-ask">or go by</span>
                <button type="button" className="intro-shuffle" onClick={() => setChoices(aliasChoices(3))}>
                  see others
                </button>
              </div>
              <div className="intro-names is-quiet">
                {choices.map((a) => (
                  <button key={a} type="button" className="name-chip" onClick={() => void next(a)} disabled={busy}>
                    {a}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="intro-pick-head">
                <p className="intro-ask">choose your name</p>
                <button type="button" className="intro-shuffle" onClick={() => setChoices(aliasChoices(3))}>
                  see others
                </button>
              </div>
              <div className="intro-names">
                {choices.map((a) => (
                  <button key={a} type="button" className="name-chip is-big" onClick={() => void next(a)} disabled={busy}>
                    {a}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <IntroOrbit moments={pool ?? []} hour={hour} prompt={prompt} />
    </main>
  );
}

const SAMPLE_SLOTS = 8;

/**
 * The hour as it looks right now: this hour's prompt in the middle and real
 * moments drifting round it. A sample to look at, not to click, until you have a name.
 */
function IntroOrbit({ moments, hour, prompt }: { moments: Summary[]; hour: number; prompt: string }) {
  return (
    <div className="intro-art" aria-hidden inert>
      <section className="stage-orbit intro-orbit" style={{ "--slot-w": "19%" } as CSSProperties}>
        <div className="orbit-track" />
        <Ring>
          {Array.from({ length: SAMPLE_SLOTS }, (_, i) => {
            const c = moments[i];
            return (
              <Slot key={c?._id ?? `slot-${i}`} i={i} of={SAMPLE_SLOTS}>
                {c ? <Coin circle={c} sub={byLine(c, hour)} onOpen={() => {}} /> : <Filler id={FILLERS[(i + hour) % FILLERS.length]} i={i} />}
              </Slot>
            );
          })}
        </Ring>
        <div className="orbit-center">
          <div className="drop drop-hero intro-center">
            <span className="stamp drop-stamp">topic of the hour</span>
            <span className="drop-prompt">{prompt}</span>
          </div>
        </div>
      </section>
    </div>
  );
}


const CAPTIONS = [
  { at: 0, text: "you share a moment", sub: "one photo, answering the hour's prompt." },
  { at: 2600, text: "small circles draws its world", sub: "where it was, the light, what's in it. drawn, never generated." },
  { at: 5600, text: "then it finds who else was there", sub: "the same place, a stranger's memory of it, a photo of the same sky." },
];
/** When the example additions land, and when the whole thing hands over to the hour. */
const ARRIVALS = [6100, 7000];
const FINISH_MS = 9800;

/** What a couple of strangers might add. It's an example, and the caption says so. */
function exampleAdditions(now: number): CanvasContribution[] {
  return [
    { id: "example-1", type: "memory", illustration: "calendar", label: "same night", text: "i was here last summer. same sky, same song.", by: "quiet heron", photoUrl: null, reading: false, createdAt: now },
    { id: "example-2", type: "reaction", illustration: "heart", label: "love this", text: null, by: "salt moth", photoUrl: null, reading: false, createdAt: now },
  ];
}

/** The example moment, drawing itself and then growing, while the captions walk through it. */
function Showcase({ circle, leaving, onFinish }: { circle: Circle; leaving: boolean; onFinish: () => void }) {
  const [step, setStep] = useState(0);
  const [added, setAdded] = useState<CanvasContribution[]>([]);

  useEffect(() => {
    const timers = [
      ...CAPTIONS.slice(1).map((c, i) => window.setTimeout(() => setStep(i + 1), c.at)),
      ...ARRIVALS.map((at, i) => window.setTimeout(() => setAdded((a) => [...a, exampleAdditions(Date.now())[i]]), at)),
      window.setTimeout(onFinish, FINISH_MS),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [onFinish]);

  const elements: CanvasElement[] = useMemo(
    () =>
      circle.elements.map((e) => ({
        id: e._id,
        illustration: e.illustration,
        label: e.label,
        importance: e.importance,
        kind: e.kind,
        pointsAt: e.pointsAt,
        order: e.order,
        detail: e.detail,
        // Everything counts as already there, so it draws in, one by one, from the start.
        createdAt: 0,
      })),
    [circle.elements],
  );
  const ctx = circle.context;
  const chin = [ctx.place?.city ?? ctx.place?.name, ctx.light ?? ctx.timeOfDay].filter(Boolean).join(" · ").toLowerCase() || circle.dateLabel;

  return (
    <main className={`intro intro-show${leaving ? " is-leaving" : ""}`}>
      <div className="intro-copy">
        <header className="intro-brand">
          <Mark size={30} />
          <span className="wordmark">small circles</span>
        </header>
        <p className="stamp">how it works · for example, &ldquo;{circle.title}&rdquo;</p>
        <ol className="intro-captions">
          {CAPTIONS.map((c, i) => (
            <li key={c.text} className={i === step ? "is-now" : i < step ? "is-done" : ""}>
              <span className="intro-caption">{c.text}</span>
              <span className="intro-caption-sub">{c.sub}</span>
            </li>
          ))}
        </ol>
        {/* <button type="button" className="link-quiet intro-skip" onClick={onFinish}>
          skip to the hour →
        </button> */}
      </div>
      <div className="intro-stage">
        <CircleCanvas
          seed={circle.generationSeed}
          photoUrl={circle.photoUrl}
          elements={elements}
          contributions={added}
          drawing={false}
          palette={ctx.palette}
          kind={ctx.kind}
          chin={chin}
        />
      </div>
    </main>
  );
}
