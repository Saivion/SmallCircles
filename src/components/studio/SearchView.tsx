"use client";

import { memo, useMemo, useSyncExternalStore } from "react";
import { getAspectVersion, subscribeAspect } from "@/lib/mind/aspect";
import { estimateHeight } from "@/lib/mind/masonry";
import { getSearch, getSearchError, getSearchStatus, getSearchVersion, getServerSearch, getServerSearchStatus, subscribeSearch } from "@/lib/mind/search";
import { getBoard, getCard, getCardsVersion, subscribeCards } from "@/lib/mind/store";
import type { Card } from "@/lib/mind/types";
import { selectBoard } from "@/lib/mind/ui";
import { Masonry, useColumns, type MasonryEntry } from "./Masonry";
import { Tile } from "./Tile";

function readZero() {
  return 0;
}

/**
 * Answers: the same wall, holding only what fits the question. What was
 * typed narrows it at once; the model's ranking takes over when it lands.
 */
export const SearchView = memo(function SearchView() {
  const result = useSyncExternalStore(subscribeSearch, getSearch, getServerSearch);
  const status = useSyncExternalStore(subscribeSearch, getSearchStatus, getServerSearchStatus);
  const version = useSyncExternalStore(subscribeSearch, getSearchVersion, readZero);
  const cardsVersion = useSyncExternalStore(subscribeCards, getCardsVersion, readZero);
  const aspectVersion = useSyncExternalStore(subscribeAspect, getAspectVersion, readZero);
  const { ref, cols, colW } = useColumns();

  const { entries, from } = useMemo(() => {
    void version;
    void cardsVersion;
    void aspectVersion;
    const cards = (result?.ranked ?? []).map((id) => getCard(id)).filter((c): c is Card => !!c);
    const counts = new Map<string, number>();
    for (const c of cards) if (c.boardId) counts.set(c.boardId, (counts.get(c.boardId) ?? 0) + 1);
    return {
      entries: cards.map<MasonryEntry>((c) => ({ key: c._id, height: estimateHeight(c, colW), node: <Tile id={c._id} /> })),
      from: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
    };
  }, [result, version, cardsVersion, aspectVersion, colW]);

  return (
    <>
      {from.length ? (
        <p className="band-note">
          From{" "}
          {from.map(([boardId, n], i) => (
            <span key={boardId}>
              {i ? ", " : ""}
              <button type="button" className="link-btn" onClick={() => selectBoard(boardId)}>
                {getBoard(boardId)?.title ?? "a circle"}
              </button>{" "}
              ({n})
            </span>
          ))}
        </p>
      ) : null}

      <section className="band is-wall" ref={ref}>
        {entries.length ? <Masonry entries={entries} cols={cols} colW={colW} /> : null}
        {!entries.length && status !== "loading" ? (
          <p className="band-empty">
            {status === "error" ? getSearchError() || "The model could not read that." : "Nothing you have fits that yet. Draw a circle and the team will go find it."}
          </p>
        ) : null}
      </section>
    </>
  );
});
