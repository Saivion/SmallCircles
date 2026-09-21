"use client";

import { ChevronDown } from "lucide-react";
import { memo, useMemo, useState, useSyncExternalStore } from "react";
import { getAspectVersion, subscribeAspect } from "@/lib/mind/aspect";
import { estimateHeight } from "@/lib/mind/masonry";
import { allCards, getBoard, getCardsVersion, subscribeBoard, subscribeCards } from "@/lib/mind/store";
import type { Card } from "@/lib/mind/types";
import { Masonry, useColumns, type MasonryEntry } from "./Masonry";
import { Tile } from "./Tile";

function readZero() {
  return 0;
}

function isWorking(c: Card) {
  return c.status === "new" || c.status === "reading";
}

/**
 * One circle: what is being read right now, then the kept cards in the
 * Grouper's sections, then everything set aside, folded away. Each band is
 * the same grid, so the sections stack without breaking the lines.
 */
export const BoardView = memo(function BoardView({ id }: { id: string }) {
  const board = useSyncExternalStore(
    (l) => subscribeBoard(id, l),
    () => getBoard(id),
    () => undefined,
  );
  const cardsVersion = useSyncExternalStore(subscribeCards, getCardsVersion, readZero);
  const aspectVersion = useSyncExternalStore(subscribeAspect, getAspectVersion, readZero);
  const { ref, cols, colW } = useColumns();
  const [showAside, setShowAside] = useState(false);

  const groups = useMemo(() => {
    void cardsVersion;
    void aspectVersion;
    const cell = (c: Card): MasonryEntry => ({ key: c._id, height: estimateHeight(c, colW), node: <Tile id={c._id} /> });
    const cards = allCards().filter((c) => c.boardId === id && c.kind !== "archived");
    const working = cards.filter(isWorking).sort((a, b) => b.createdAt - a.createdAt);
    const kept = cards.filter((c) => !isWorking(c) && c.inFocus && !c.twinOf).sort((a, b) => (b.focusScore ?? 0) - (a.focusScore ?? 0));
    const unsorted = cards.filter((c) => !isWorking(c) && c.inFocus === undefined && c.status !== "failed" && !c.twinOf);
    const aside = cards.filter((c) => !isWorking(c) && !kept.includes(c) && !unsorted.includes(c));

    const names = new Set(kept.map((c) => c.section).filter(Boolean));
    const grouped = kept.length >= 6 && names.size >= 2 && kept.every((c) => c.section) && kept.length / names.size >= 2;
    const sections: { name: string; cells: MasonryEntry[] }[] = [];
    if (grouped) {
      const order: string[] = [];
      const by = new Map<string, Card[]>();
      for (const c of kept) {
        const n = c.section!;
        if (!by.has(n)) {
          by.set(n, []);
          order.push(n);
        }
        by.get(n)!.push(c);
      }
      for (const n of order) sections.push({ name: n, cells: by.get(n)!.map(cell) });
    } else if (kept.length) {
      sections.push({ name: "Kept", cells: kept.map(cell) });
    }

    return {
      working: [...working, ...unsorted].map(cell),
      workingCount: working.length,
      sections,
      aside: aside.map(cell),
    };
  }, [id, cardsVersion, aspectVersion, colW]);

  if (!board) return null;
  const running = board.status === "running";

  return (
    <div ref={ref}>
      {groups.working.length ? (
        <section className="band is-wall is-working">
          {groups.workingCount ? (
            <h2 className="band-title">
              Being read <span>{groups.workingCount}</span>
            </h2>
          ) : null}
          <Masonry entries={groups.working} cols={cols} colW={colW} />
        </section>
      ) : null}

      {groups.sections.map((s) => (
        <section key={s.name} className="band is-wall">
          <h2 className="band-title">
            {s.name} <span>{s.cells.length}</span>
          </h2>
          <Masonry entries={s.cells} cols={cols} colW={colW} />
        </section>
      ))}

      {!groups.working.length && !groups.sections.length && !running ? (
        <p className="band-empty">Nothing kept here yet. Gather more, or paste links into the line above.</p>
      ) : null}

      {groups.aside.length ? (
        <section className="band is-wall is-aside">
          <button type="button" className="band-title is-toggle" onClick={() => setShowAside((v) => !v)} aria-expanded={showAside}>
            <ChevronDown size={15} className={showAside ? "is-open" : ""} aria-hidden="true" />
            Set aside <span>{groups.aside.length}</span>
          </button>
          {showAside ? <Masonry entries={groups.aside} cols={cols} colW={colW} /> : null}
        </section>
      ) : null}
    </div>
  );
});
