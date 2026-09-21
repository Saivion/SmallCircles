/**
 * Client document store, outside React.
 *
 * - Cards: a map with per-card listeners, so a card that changes re-renders
 *   exactly that card. `transact()` batches many upserts into one emit.
 * - Agents, boards, tasks, runs, mail: small lists. Each is a slice with a
 *   stable snapshot array (new identity only when something changed) and
 *   per-id listeners.
 *
 * Convex is the source of truth; `sync.tsx` diffs query results in here.
 */
import type { Agent, Board, Card, Mail, Run, Task } from "./types";

type Listener = () => void;

/* The canvas this page works on, set once by the sync bridge. */
let canvasId: string | null = null;
export function setCanvasId(id: string) {
  canvasId = id;
}
export function getCanvasId() {
  return canvasId;
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

const cards = new Map<string, Card>();
const cardListeners = new Set<Listener>();
const cardIdListeners = new Map<string, Set<Listener>>();
let cardsVersion = 0;
let txDepth = 0;
let txChanged: Set<string> | null = null;

export function transact<T>(fn: () => T): T {
  txDepth += 1;
  try {
    return fn();
  } finally {
    txDepth -= 1;
    if (txDepth === 0 && txChanged) {
      const changed = txChanged;
      txChanged = null;
      emitCards(changed);
    }
  }
}

function emitCards(changed: Iterable<string>) {
  if (txDepth > 0) {
    txChanged ??= new Set();
    for (const id of changed) txChanged.add(id);
    return;
  }
  cardsVersion += 1;
  for (const id of changed) {
    const set = cardIdListeners.get(id);
    if (set) for (const l of set) l();
  }
  for (const l of cardListeners) l();
}

function sameCard(a: Card, b: Card) {
  return (
    a.status === b.status &&
    a.kind === b.kind &&
    a.title === b.title &&
    a.body === b.body &&
    a.bodyLength === b.bodyLength &&
    a.url === b.url &&
    a.domain === b.domain &&
    a.imageUrl === b.imageUrl &&
    a.type === b.type &&
    a.caption === b.caption &&
    a.quote === b.quote &&
    a.focusScore === b.focusScore &&
    a.inFocus === b.inFocus &&
    a.focusReason === b.focusReason &&
    a.boardId === b.boardId &&
    a.source === b.source &&
    a.query === b.query &&
    a.updatedAt === b.updatedAt
  );
}

export function upsertCard(next: Card): boolean {
  const prev = cards.get(next._id);
  if (prev && sameCard(prev, next)) return false;
  cards.set(next._id, next);
  emitCards([next._id]);
  return true;
}

export function removeCard(id: string) {
  if (!cards.delete(id)) return;
  emitCards([id]);
}

export function getCard(id: string) {
  return cards.get(id);
}

export function allCards() {
  return Array.from(cards.values());
}

export function cardIds() {
  return cards.keys();
}

export function getCardsVersion() {
  return cardsVersion;
}

export function subscribeCards(listener: Listener) {
  cardListeners.add(listener);
  return () => {
    cardListeners.delete(listener);
  };
}

export function subscribeCard(id: string, listener: Listener) {
  let set = cardIdListeners.get(id);
  if (!set) {
    set = new Set();
    cardIdListeners.set(id, set);
  }
  set.add(listener);
  return () => {
    const current = cardIdListeners.get(id);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) cardIdListeners.delete(id);
  };
}

/** Live counts for a board, derived from its cards. */
export function boardCardStats(boardId: string) {
  let found = 0;
  let read = 0;
  let kept = 0;
  let pending = 0;
  for (const c of cards.values()) {
    if (c.boardId !== boardId || c.kind === "archived") continue;
    found += 1;
    if (c.status === "ready" || (!c.status && c.kind !== "raw")) read += 1;
    if (c.inFocus) kept += 1;
    if (c.status === "new" || c.status === "reading") pending += 1;
  }
  return { found, read, kept, pending };
}

/* ------------------------------------------------------------------ */
/* List slices                                                         */
/* ------------------------------------------------------------------ */

type Doc = { _id: string };

function createSlice<T extends Doc>(order: (a: T, b: T) => number) {
  const map = new Map<string, T>();
  const listeners = new Set<Listener>();
  const idListeners = new Map<string, Set<Listener>>();
  const EMPTY: readonly T[] = [];
  let snapshot: readonly T[] = EMPTY;
  let version = 0;
  /** True once the server has answered at least once, even with nothing. */
  let loaded = false;

  return {
    set(list: readonly T[]) {
      const changed: string[] = [];
      const seen = new Set<string>();
      for (const doc of list) {
        seen.add(doc._id);
        const prev = map.get(doc._id);
        if (!prev || JSON.stringify(prev) !== JSON.stringify(doc)) {
          map.set(doc._id, doc);
          changed.push(doc._id);
        }
      }
      for (const id of Array.from(map.keys())) {
        if (!seen.has(id)) {
          map.delete(id);
          changed.push(id);
        }
      }
      const first = !loaded;
      loaded = true;
      if (!changed.length && !first) return;
      snapshot = Array.from(map.values()).sort(order);
      version += 1;
      for (const id of changed) {
        const set = idListeners.get(id);
        if (set) for (const l of set) l();
      }
      for (const l of listeners) l();
    },
    get: (id: string) => map.get(id),
    all: () => snapshot,
    server: () => EMPTY,
    version: () => version,
    loaded: () => loaded,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeId(id: string, listener: Listener) {
      let set = idListeners.get(id);
      if (!set) {
        set = new Set();
        idListeners.set(id, set);
      }
      set.add(listener);
      return () => {
        const current = idListeners.get(id);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) idListeners.delete(id);
      };
    },
  };
}

const agents = createSlice<Agent>((a, b) => a.createdAt - b.createdAt);
const boards = createSlice<Board>((a, b) => a.createdAt - b.createdAt);
const tasks = createSlice<Task>((a, b) => b.startedAt - a.startedAt);
const runs = createSlice<Run>((a, b) => b.startedAt - a.startedAt);
const mail = createSlice<Mail>((a, b) => b.createdAt - a.createdAt);

export const setAgents = agents.set;
export const getAgent = agents.get;
export const getAgents = agents.all;
export const getServerAgents = agents.server;
export const subscribeAgents = agents.subscribe;
export const setBoards = boards.set;
export const getBoard = boards.get;
export const getBoards = boards.all;
export const getServerBoards = boards.server;
export const getBoardsLoaded = boards.loaded;
export const subscribeBoards = boards.subscribe;
export const subscribeBoard = boards.subscribeId;

export const setTasks = tasks.set;
export const getTask = tasks.get;
export const getTasks = tasks.all;
export const getServerTasks = tasks.server;
export const getTasksVersion = tasks.version;
export const subscribeTasks = tasks.subscribe;

export const setRuns = runs.set;
export const getRuns = runs.all;
export const subscribeRuns = runs.subscribe;

export const setMail = mail.set;
export const getMail = mail.all;
export const getServerMail = mail.server;
export const subscribeMail = mail.subscribe;

/* ------------------------------------------------------------------ */
/* Derived lookups                                                     */
/* ------------------------------------------------------------------ */

/** The newest running task on a card, if an agent is working it right now. */
export function activeTaskOnCard(cardId: string): Task | undefined {
  for (const t of getTasks()) if (t.state === "running" && t.cardId === cardId) return t;
  return undefined;
}

/** Every task that touched a card, oldest first. */
export function tasksForCard(cardId: string): Task[] {
  return getTasks()
    .filter((t) => t.cardId === cardId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

