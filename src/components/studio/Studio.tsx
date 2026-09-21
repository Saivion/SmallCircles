"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { CanvasSync } from "@/lib/mind/sync";
import { getBoards, getBoardsLoaded, getCardsVersion, getTasks, getTasksVersion, subscribeBoards, subscribeCards, subscribeTasks } from "@/lib/mind/store";
import {
  getPanel,
  getQuery,
  getSelectedBoardId,
  getServerPanel,
  getServerQuery,
  readFalse,
  readNull,
  setPanel,
  subscribePanel,
  subscribeQuery,
  subscribeSelectedBoard,
} from "@/lib/mind/ui";
import { BoardView } from "./BoardView";
import { CardModal } from "./CardModal";
import { CircleStrip } from "./CircleStrip";
import { EmptyHome } from "./EmptyHome";
import { HomeView } from "./HomeView";
import { Rail } from "./Rail";
import { SearchHeader } from "./SearchHeader";
import { SearchView } from "./SearchView";
import { SheetHead } from "./SheetHead";
import { StudioPanel } from "./StudioPanel";

function readZero() {
  return 0;
}

function readBoardCount() {
  return getBoards().length;
}

/**
 * The shell: the rail down the side, then one sheet holding the head, the
 * line, the circles and the wall as bands of the same width. The team panel
 * slides in beside the sheet, never over it.
 */
export function Studio({ canvasId, loaded }: { canvasId: Id<"canvases"> | null; loaded: boolean }) {
  const selected = useSyncExternalStore(subscribeSelectedBoard, getSelectedBoardId, readNull);
  const query = useSyncExternalStore(subscribeQuery, getQuery, getServerQuery);
  const panel = useSyncExternalStore(subscribePanel, getPanel, getServerPanel);
  const boards = useSyncExternalStore(subscribeBoards, readBoardCount, readZero);
  const boardsLoaded = useSyncExternalStore(subscribeBoards, getBoardsLoaded, readFalse);
  const tasksVersion = useSyncExternalStore(subscribeTasks, getTasksVersion, readZero);
  useSyncExternalStore(subscribeCards, getCardsVersion, readZero);
  const wasRunning = useRef(false);

  // Nothing renders until the circles have answered, so the landing page
  // never flashes for someone who already has some.
  const ready = loaded && boardsLoaded;
  const empty = ready && boards === 0 && !selected && !query;

  useEffect(() => {
    if (empty) {
      setPanel(null);
      wasRunning.current = false;
      return;
    }
    void tasksVersion;
    const live = getTasks().some((t) => t.state === "running");
    if (live && !wasRunning.current) setPanel("team");
    wasRunning.current = live;
  }, [empty, tasksVersion]);

  if (!ready) {
    return <div className="studio is-loading">{canvasId ? <CanvasSync canvasId={canvasId} /> : null}</div>;
  }

  if (empty) {
    return (
      <div className="studio is-empty">
        {canvasId ? <CanvasSync canvasId={canvasId} /> : null}
        <EmptyHome canvasId={canvasId} />
      </div>
    );
  }

  return (
    <div className={`studio${panel ? " has-panel" : ""}`}>
      {canvasId ? <CanvasSync canvasId={canvasId} /> : null}
      <Rail />
      <main className="sheet">
        <section className="topblock">
          <SheetHead />
          <SearchHeader />
        </section>
        <CircleStrip />
        <div className="sheet-body">{query ? <SearchView /> : selected ? <BoardView key={selected} id={selected} /> : <HomeView />}</div>
      </main>
      {panel ? <StudioPanel tab={panel} /> : null}
      <CardModal />
    </div>
  );
}
