"use client";

import { DOODLES } from "@convex/lib/vocabulary";
import { hash } from "@/lib/doodle/pen";
import { DoodleIcon } from "./Doodle";

/** Every drawing in the vocabulary on one page (`?sheet=1`), for checking the house style. */
export function Sheet() {
  return (
    <main className="view sheet-page">
      <h1 className="title">the vocabulary</h1>
      <p className="stamp">{DOODLES.length} drawings</p>
      <div className="sheet-grid">
        {DOODLES.map((d, i) => (
          <figure key={d.id} className="sheet-cell">
            <DoodleIcon id={d.id} seed={hash(`sheet:${d.id}`)} size={96} delay={0.1 + (i % 12) * 0.05} />
            <figcaption className="stamp">{d.id.replace("_", " ")}</figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
