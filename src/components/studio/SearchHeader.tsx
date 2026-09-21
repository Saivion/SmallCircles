"use client";

import { useMutation } from "convex/react";
import { ArrowUp, LoaderCircle, Search, X } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { getBoard, getCanvasId, subscribeBoards } from "@/lib/mind/store";
import { getSearchStatus, getServerSearchStatus, searchNow, subscribeSearch } from "@/lib/mind/search";
import { getQuery, getSelectedBoardId, getServerQuery, readNull, selectBoard, setQuery, subscribeQuery, subscribeSelectedBoard } from "@/lib/mind/ui";

/** Dispatch on window to switch the line to drawing a circle and focus it. */
export const DRAW_EVENT = "smallcircles:draw";
/** Dispatch on window to put the cursor in the line, ready to search. */
export const SEEK_EVENT = "smallcircles:seek";

type Mode = "search" | "draw";
type Note = { kind: "busy" } | { kind: "done"; text: string } | { kind: "error"; text: string } | null;

const HAS_URL = /(https?:\/\/|www\.)\S+/i;
const IDEAS = ["brutalist poster type", "cozy reading nooks", "90s web design", "moody film stills"];

function errorText(e: unknown, fallback: string) {
  if (e && typeof e === "object" && "data" in e && typeof (e as { data: unknown }).data === "string") return (e as { data: string }).data;
  return e instanceof Error ? e.message.split("\n")[0] : fallback;
}

function readTitle() {
  const id = getSelectedBoardId();
  return id ? (getBoard(id)?.title ?? null) : null;
}

function subscribeTitle(l: () => void) {
  const a = subscribeSelectedBoard(l);
  const b = subscribeBoards(l);
  return () => {
    a();
    b();
  };
}

/**
 * The big quiet line at the top of every page. It searches your circles by
 * default; switch it to draw and the same line starts a new circle, or drops
 * pasted links into the circle you are in. "/" jumps to search, "+" (or "N") to draw.
 */
export const SearchHeader = memo(function SearchHeader() {
  const query = useSyncExternalStore(subscribeQuery, getQuery, getServerQuery);
  const status = useSyncExternalStore(subscribeSearch, getSearchStatus, getServerSearchStatus);
  const circle = useSyncExternalStore(subscribeTitle, readTitle, readNull);
  const submit = useMutation(api.boards.submit);
  const [mode, setMode] = useState<Mode>("search");
  const [value, setValue] = useState(query);
  const [note, setNote] = useState<Note>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draw = mode === "draw";
  const links = draw && HAS_URL.test(value);

  // Switching keeps whatever is typed, so a search can become a circle and back.
  const open = useCallback((next: Mode) => {
    setMode(next);
    setNote(null);
    setValue((typed) => typed || (next === "search" ? getQuery() : ""));
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) return;
      if (e.key === "/" || e.key === "+" || e.key === "n" || e.key === "N") {
        e.preventDefault();
        open(e.key === "/" ? "search" : "draw");
      }
    };
    const onDraw = () => open("draw");
    const onSeek = () => open("search");
    window.addEventListener("keydown", onKey);
    window.addEventListener(DRAW_EVENT, onDraw);
    window.addEventListener(SEEK_EVENT, onSeek);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(DRAW_EVENT, onDraw);
      window.removeEventListener(SEEK_EVENT, onSeek);
    };
  }, [open]);

  const clear = () => {
    setValue("");
    setNote(null);
    if (!draw) setQuery("");
  };

  const send = async () => {
    const text = value.trim();
    if (!draw) {
      if (!text) return clear();
      setQuery(text);
      searchNow();
      return;
    }
    const canvasId = getCanvasId();
    if (!canvasId || !text || note?.kind === "busy") return;
    setNote({ kind: "busy" });
    try {
      const boardId = links ? (getSelectedBoardId() ?? undefined) : undefined;
      const res = await submit({ canvasId: canvasId as Id<"canvases">, text, boardId: boardId as Id<"boards"> | undefined });
      setValue("");
      setQuery("");
      setNote({
        kind: "done",
        text: res.started ? "Circle drawn. The team is on its way." : res.added ? `Added ${res.added} ${res.added === 1 ? "link" : "links"}.` : "Already in this circle.",
      });
      window.setTimeout(() => setNote((n) => (n?.kind === "done" ? null : n)), 3600);
      selectBoard(res.boardId);
    } catch (e) {
      setNote({ kind: "error", text: errorText(e, "Could not draw the circle.") });
    }
  };

  const busy = draw ? note?.kind === "busy" : status === "loading";
  const tip =
    note && note.kind !== "busy" ? (
      <span className={note.kind === "error" ? "is-error" : "is-done"}>{note.text}</span>
    ) : draw ? (
      <span>
        {links ? (circle ? `These links go into “${circle}”. ` : "Links start a circle of their own. ") : "Name what it should gather, or paste links. "}
        Press <b>ENTER</b>.
      </span>
    ) : (
      <span>
        Narrows as you type. Press <b>ENTER</b> to ask in plain words.
      </span>
    );

  return (
    <header className={`seek${draw ? " is-draw" : ""}`}>
      <form
        className="seek-form"
        role={draw ? undefined : "search"}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          ref={inputRef}
          className="seek-input"
          value={value}
          maxLength={2000}
          placeholder={draw ? "Draw a new circle…" : "Search my circles…"}
          aria-label={draw ? "Draw a new circle, or paste links" : "Search my circles"}
          onChange={(e) => {
            setValue(e.target.value);
            if (note?.kind === "error") setNote(null);
            // Searching narrows as you type; drawing waits for Enter.
            if (!draw) setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") clear();
          }}
        />
        {value ? (
          <button type="button" className="seek-clear" aria-label="Clear" onClick={clear}>
            <X size={22} strokeWidth={1.4} />
          </button>
        ) : null}
        <button type="submit" className="seek-go" aria-label={draw ? "Draw the circle" : "Search"} disabled={draw && !value.trim()}>
          {busy ? (
            <LoaderCircle size={draw ? 20 : 30} strokeWidth={draw ? 2 : 1.2} className="spin" />
          ) : draw ? (
            <ArrowUp size={20} strokeWidth={2} />
          ) : (
            <Search size={30} strokeWidth={1.2} />
          )}
        </button>
      </form>

      <div className="seek-tips">
        <p>
          <span className="seek-dot" aria-hidden="true" />
          {tip}
        </p>
        <div className="seek-modes" role="tablist" aria-label="What the line does">
          <button type="button" role="tab" aria-selected={!draw} className={`seek-mode${!draw ? " is-on" : ""}`} onClick={() => open("search")}>
            Search <kbd>/</kbd>
          </button>
          <button type="button" role="tab" aria-selected={draw} className={`seek-mode is-draw${draw ? " is-on" : ""}`} onClick={() => open("draw")}>
            <span className="seek-mode-dot" aria-hidden="true" />
            Draw a circle <kbd title="Press + or N">+</kbd>
          </button>
        </div>
      </div>

      {draw && !value ? (
        <div className="seek-ideas" aria-label="Ideas">
          <span>Try</span>
          {IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              className="seek-idea"
              onClick={() => {
                setValue(idea);
                inputRef.current?.focus();
              }}
            >
              {idea}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
});
