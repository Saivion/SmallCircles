"use client";

import { Plus } from "lucide-react";
import { memo, useSyncExternalStore } from "react";
import { boardCardStats, getBoards, getCardsVersion, getServerBoards, subscribeBoards, subscribeCards } from "@/lib/mind/store";
import { getSelectedBoardId, readNull, selectBoard, setQuery, subscribeSelectedBoard } from "@/lib/mind/ui";
import { CircleCover, coverImages } from "./Circles";
import { DRAW_EVENT } from "./SearchHeader";

function readZero() {
  return 0;
}

/**
 * The circles as a band of equal cells across the sheet: each one its cover,
 * its name and what the team kept, and a last cell for drawing a new one.
 * The band keeps the same column rhythm as the wall below it.
 */
export const CircleStrip = memo(function CircleStrip() {
  const boards = useSyncExternalStore(subscribeBoards, getBoards, getServerBoards);
  const selected = useSyncExternalStore(subscribeSelectedBoard, getSelectedBoardId, readNull);
  useSyncExternalStore(subscribeCards, getCardsVersion, readZero);

  return (
    <div className="strip" role="tablist" aria-label="Your circles">
      {[...boards].reverse().map((b) => {
        const s = boardCardStats(b._id);
        const on = selected === b._id;
        return (
          <button
            key={b._id}
            type="button"
            role="tab"
            aria-selected={on}
            className={`strip-cell status-${b.status}${on ? " is-on" : ""}`}
            onClick={() => {
              setQuery("");
              selectBoard(on ? null : b._id);
            }}
          >
            <CircleCover images={coverImages(b._id)} size={34} running={b.status === "running"} />
            <span className="strip-text">
              <span className="strip-name">{b.title}</span>
              <span className="strip-meta">{b.status === "running" ? "the team is working" : b.status === "failed" ? "stopped" : `${s.kept} kept`}</span>
            </span>
          </button>
        );
      })}

      <button
        type="button"
        className="strip-cell is-new"
        onClick={() => {
          setQuery("");
          selectBoard(null);
          window.setTimeout(() => window.dispatchEvent(new Event(DRAW_EVENT)), 30);
        }}
      >
        <span className="strip-plus" aria-hidden="true">
          <Plus size={16} />
        </span>
        <span className="strip-text">
          <span className="strip-name">New circle</span>
          <span className="strip-meta">name what to gather</span>
        </span>
      </button>
    </div>
  );
});
