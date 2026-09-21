"use client";

import { useMutation } from "convex/react";
import { RotateCw, Trash2, X } from "lucide-react";
import { memo, useState, useSyncExternalStore } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { actorName } from "@/lib/mind/crew";
import { describeSearch, getSearch, getSearchStatus, getServerSearch, getServerSearchStatus, subscribeSearch } from "@/lib/mind/search";
import {
  boardCardStats,
  getAgent,
  getBoard,
  getCardsVersion,
  getRuns,
  getTasks,
  getTasksVersion,
  subscribeBoards,
  subscribeCards,
  subscribeRuns,
  subscribeTasks,
} from "@/lib/mind/store";
import { getQuery, getSelectedBoardId, getServerQuery, readNull, selectBoard, setQuery, subscribeQuery, subscribeSelectedBoard } from "@/lib/mind/ui";
import { Orb } from "./Circles";

function readZero() {
  return 0;
}

function errorText(e: unknown, fallback: string) {
  if (e && typeof e === "object" && "data" in e && typeof (e as { data: unknown }).data === "string") return (e as { data: string }).data;
  return e instanceof Error ? e.message.split("\n")[0] : fallback;
}

/**
 * One quiet line above the search bar, and only when there is something to
 * say: the circle you are in, or the question you asked, with whatever you
 * can do about it on the right. Home says nothing here; the search line and
 * the circles are the page.
 */
export const SheetHead = memo(function SheetHead() {
  const query = useSyncExternalStore(subscribeQuery, getQuery, getServerQuery);
  const selected = useSyncExternalStore(subscribeSelectedBoard, getSelectedBoardId, readNull);
  const result = useSyncExternalStore(subscribeSearch, getSearch, getServerSearch);
  const status = useSyncExternalStore(subscribeSearch, getSearchStatus, getServerSearchStatus);
  useSyncExternalStore(subscribeCards, getCardsVersion, readZero);
  useSyncExternalStore(subscribeBoards, getCardsVersion, readZero);
  useSyncExternalStore(subscribeTasks, getTasksVersion, readZero);
  useSyncExternalStore(subscribeRuns, () => getRuns().length, readZero);
  const run = useMutation(api.boards.run);
  const remove = useMutation(api.boards.remove);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  let title = "";
  let meta: React.ReactNode = null;
  let actions: React.ReactNode = null;

  if (query) {
    const n = result?.ranked.length ?? 0;
    title = query;
    meta = (
      <>
        <b>{result ? describeSearch(result) : `${n} cards`}</b>
        {result?.subject ? <span className="head-soft"> · understood as {result.subject.split(/[:;,]/)[0].trim()}</span> : null}
        {status === "loading" ? <span className="head-soft"> · reading your question…</span> : null}
      </>
    );
    actions = (
      <button type="button" className="pill" onClick={() => setQuery("")}>
        <X size={13} aria-hidden="true" /> Clear
      </button>
    );
  } else if (selected) {
    const board = getBoard(selected);
    if (board) {
      const stats = boardCardStats(selected);
      const latest = getRuns().find((r) => r.boardId === selected);
      const running = board.status === "running";
      const live = getTasks().filter((t) => t.state === "running" && t.boardId === selected);
      title = board.title;
      meta = (
        <>
          {live.length ? (
            <span className="head-orbs">
              {live.slice(0, 4).map((t) => {
                const a = getAgent(t.agentId);
                return a ? <Orb key={t._id} color={a.color} tool={t.tool} live size={20} title={actorName(t)} /> : null;
              })}
            </span>
          ) : null}
          <b>
            {live.length
              ? `${actorName(live[0])}: ${live[0].label}${live.length > 1 ? `, and ${live.length - 1} more` : ""}`
              : running && latest
                ? `The team is ${latest.stage === "find" ? "planning" : latest.stage === "read" ? "reading" : "sorting"}`
                : board.status === "failed"
                  ? `Stopped${board.error ? `: ${board.error}` : ""}`
                  : `${stats.kept} kept of ${stats.found} found`}
          </b>
          {board.prompt && board.prompt.toLowerCase() !== board.title.toLowerCase() ? <span className="head-soft"> · {board.prompt}</span> : null}
        </>
      );
      actions = (
        <>
          {!running && board.prompt ? (
            <button type="button" className="pill" disabled={busy} onClick={() => void act(() => run({ boardId: selected as Id<"boards"> }), "Could not start.")}>
              <RotateCw size={13} aria-hidden="true" /> Gather more
            </button>
          ) : null}
          <button
            type="button"
            className="pill is-quiet"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Remove “${board.title}” and its ${stats.found} cards?`)) return;
              void act(async () => {
                await remove({ boardId: selected as Id<"boards"> });
                selectBoard(null);
              }, "Could not remove.");
            }}
          >
            <Trash2 size={13} aria-hidden="true" /> Remove
          </button>
        </>
      );
    }
  }

  // Home has no head: the line and the circles speak for themselves.
  if (!title) return null;

  return (
    <header className="head">
      <div className="head-lines">
        <h1 className="head-title">{title}</h1>
        <p className="head-meta">{meta}</p>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {actions ? <div className="head-actions">{actions}</div> : null}
    </header>
  );
});
