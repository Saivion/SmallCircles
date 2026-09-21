"use client";

import { memo, useMemo, useSyncExternalStore } from "react";
import { getAspectVersion, subscribeAspect } from "@/lib/mind/aspect";
import { estimateHeight } from "@/lib/mind/masonry";
import { allCards, getCardsVersion, subscribeCards } from "@/lib/mind/store";
import { Masonry, useColumns, type MasonryEntry } from "./Masonry";
import { Tile } from "./Tile";

const LATELY = 60;

function readZero() {
  return 0;
}

/** Home: everything the team kept lately, across every circle, newest first. */
export const HomeView = memo(function HomeView() {
  const cardsVersion = useSyncExternalStore(subscribeCards, getCardsVersion, readZero);
  const aspectVersion = useSyncExternalStore(subscribeAspect, getAspectVersion, readZero);
  const { ref, cols, colW } = useColumns();

  const entries = useMemo<MasonryEntry[]>(() => {
    void cardsVersion;
    void aspectVersion;
    return allCards()
      .filter((c) => c.inFocus && !c.twinOf && c.kind !== "archived")
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
      .slice(0, LATELY)
      .map((c) => ({ key: c._id, height: estimateHeight(c, colW), node: <Tile id={c._id} /> }));
  }, [cardsVersion, aspectVersion, colW]);

  return (
    <section className="band is-wall" ref={ref}>
      {entries.length ? (
        <Masonry entries={entries} cols={cols} colW={colW} />
      ) : (
        <p className="band-empty">Nothing kept yet. Open a circle to watch the team, or press + to draw another.</p>
      )}
    </section>
  );
});
