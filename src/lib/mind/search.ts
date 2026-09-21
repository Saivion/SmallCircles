/**
 * "Search my circles", answered by the model.
 *
 * Nothing about the query is decided on the client. The text goes to the
 * backend action `search.query`, where OpenAI reads it as a subject and an
 * intent (pictures, quotes, reading, any), the subject is embedded, the
 * canvas's card embeddings are searched by vector, and the model reranks
 * the top hits into a short ordered set. The client keeps that set: the
 * shelf under the field lists it, and on the wall only those cards stay lit.
 *
 * Typing answers at once from the cards already in the browser (title,
 * caption, domain, section, circle, body), so the wall narrows on every
 * keystroke. The model's reading of the question replaces that set when it
 * lands, keeping any plain text match the model missed. A late reply for an
 * older query is dropped.
 */
import { allCards, getBoard, getCard } from "./store";
import type { Card } from "./types";
import { getQuery, subscribeQuery } from "./ui";

export type SearchIntent = "visual" | "quotes" | "reading" | "any";

export type SearchResult = {
  query: string;
  /** "typed" until the model answers, then "model". */
  kind: "typed" | "model";
  /** The model's reading of what was asked for. */
  subject: string;
  intent: SearchIntent;
  /** Ranked card ids, best first. */
  ranked: string[];
  matched: ReadonlySet<string>;
};

export type SearchStatus = "idle" | "loading" | "done" | "error";

export type SearchRunner = (q: string) => Promise<{
  subject: string;
  intent: SearchIntent;
  results: { cardId: string; score: number }[];
}>;

type Listener = () => void;

/** How long typing rests before the model is asked. */
const DEBOUNCE_MS = 420;
/** Below this, only the typed match runs; one or two letters ask nothing. */
const MODEL_MIN_CHARS = 3;
/** At most this many typed matches; the model returns its own ranking. */
const TYPED_MAX = 60;

let runner: SearchRunner | null = null;
let current: SearchResult | null = null;
let status: SearchStatus = "idle";
let errorText = "";
let version = 0;
let seq = 0;
let timer: number | null = null;
const listeners = new Set<Listener>();
let started = false;

/** The words of the query, lowercased. A single letter counts as a word. */
function terms(q: string) {
  return Array.from(new Set(q.toLowerCase().split(/[^a-z0-9+#]+/i).filter(Boolean))).slice(0, 8);
}

/** Where a word lands in one piece of text: at the head of a word, inside
 * one, or not at all. A short word only counts at the head, so typing "g"
 * finds "golf" and "gallery" instead of every card with a g in it. */
function hit(text: string, word: string): 2 | 1 | 0 {
  if (!text) return 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(word, from);
    if (at < 0) break;
    const before = at === 0 ? " " : text[at - 1];
    if (!/[a-z0-9]/.test(before)) return 2;
    from = at + 1;
  }
  return word.length >= 3 && text.includes(word) ? 1 : 0;
}

/** Everything about a card the browser can match on, lowercased once. */
function haystacks(c: Card) {
  return {
    title: c.title.toLowerCase(),
    near: `${c.caption ?? ""} ${c.section ?? ""} ${c.type ?? ""} ${c.quote ?? ""} ${c.domain ?? ""} ${c.query ?? ""}`.toLowerCase(),
    circle: (c.boardId ? (getBoard(c.boardId)?.title ?? "") : "").toLowerCase(),
    body: c.body.toLowerCase(),
  };
}

/**
 * What the browser can answer on its own: every card scored by where the
 * words land. A word at the head of the title counts most, one buried in
 * the body least, and every word you type has to land somewhere.
 */
function typedMatches(q: string): string[] {
  const words = terms(q);
  if (!words.length) return [];
  const scored: { id: string; score: number }[] = [];
  for (const c of allCards()) {
    if (c.kind === "archived" || c.twinOf) continue;
    const h = haystacks(c);
    let score = 0;
    let missed = false;
    for (const w of words) {
      const inTitle = hit(h.title, w);
      const inNear = hit(h.near, w);
      const inCircle = hit(h.circle, w);
      const inBody = hit(h.body, w);
      const best =
        inTitle === 2
          ? h.title.startsWith(w)
            ? 16
            : 12
          : inNear === 2
            ? 8
            : inCircle === 2
              ? 6
              : inTitle === 1
                ? 5
                : inNear === 1
                  ? 4
                  : inBody === 2
                    ? 3
                    : inBody === 1
                      ? 1
                      : 0;
      if (best === 0) {
        missed = true;
        break;
      }
      score += best;
    }
    if (missed) continue;
    if (c.inFocus) score += 3;
    scored.push({ id: c._id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, TYPED_MAX).map((x) => x.id);
}

function typedResult(q: string): SearchResult {
  const ranked = typedMatches(q);
  return { query: q, kind: "typed", subject: "", intent: "any", ranked, matched: new Set(ranked) };
}

function emit() {
  version += 1;
  for (const l of listeners) l();
}

/** Installed by the sync layer with the Convex action bound to the canvas. */
export function setSearchRunner(next: SearchRunner | null) {
  runner = next;
  if (next && getQuery() && !current) schedule(0);
}

async function run(q: string) {
  if (!runner) return;
  const my = ++seq;
  status = "loading";
  emit();
  try {
    const r = await runner(q);
    if (my !== seq) return; // a newer query is in flight
    const ranked = r.results.map((x) => x.cardId);
    // Keep plain text matches the model left out; they are what was typed.
    const seen = new Set(ranked);
    for (const id of typedMatches(q)) if (!seen.has(id)) ranked.push(id);
    current = { query: q, kind: "model", subject: r.subject, intent: r.intent, ranked, matched: new Set(ranked) };
    status = "done";
    errorText = "";
  } catch (e) {
    if (my !== seq) return;
    // The typed matches stay on screen; only the model's reading is missing.
    status = "error";
    errorText = e instanceof Error ? e.message.split("\n")[0] : "Search failed.";
  }
  emit();
}

function schedule(delay: number) {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    const q = getQuery();
    if (q) void run(q);
  }, delay);
}

function onQuery() {
  const q = getQuery();
  if (!q) {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    seq += 1; // drop any reply in flight
    if (current || status !== "idle") {
      current = null;
      status = "idle";
      errorText = "";
      emit();
    }
    return;
  }
  if (current?.query === q && current.kind === "model") return;
  // Answer from what is already here, then ask the model about it.
  current = typedResult(q);
  status = q.length >= MODEL_MIN_CHARS ? "loading" : "done";
  errorText = "";
  emit();
  if (q.length >= MODEL_MIN_CHARS) schedule(DEBOUNCE_MS);
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  subscribeQuery(onQuery);
}

/** Run the current query now (Enter). */
export function searchNow() {
  start();
  const q = getQuery();
  if (!q) return;
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  if (current?.query === q && current.kind === "model" && status === "done") return;
  if (!current || current.query !== q) {
    current = typedResult(q);
    emit();
  }
  void run(q);
}

export function subscribeSearch(listener: Listener) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSearchVersion() {
  start();
  return version;
}

/** The latest completed result, or null when the field is empty. */
export function getSearch(): SearchResult | null {
  start();
  return current;
}

export function getServerSearch(): SearchResult | null {
  return null;
}

export function getSearchStatus(): SearchStatus {
  start();
  return status;
}

export function getServerSearchStatus(): SearchStatus {
  return "idle";
}

export function getSearchError() {
  return errorText;
}

/** Human line for the shelf head: "8 pictures". */
export function describeSearch(r: SearchResult) {
  const n = r.ranked.filter((id) => getCard(id)).length;
  const noun =
    r.intent === "visual"
      ? n === 1
        ? "picture"
        : "pictures"
      : r.intent === "quotes"
        ? n === 1
          ? "quote"
          : "quotes"
        : n === 1
          ? "card"
          : "cards";
  return `${n} ${noun}`;
}
