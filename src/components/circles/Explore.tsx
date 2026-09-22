"use client";

import { hash } from "@/lib/doodle/pen";
import { DoodleIcon } from "./Doodle";

type Element = {
  _id: string;
  illustration: string;
  label: string;
  semanticMeaning: string;
  kind: string;
  detail: string | null;
  source: { url: string; title: string } | null;
  geo: { lat: number; lng: number } | null;
};

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const KIND_WORD: Record<string, string> = {
  subject: "in the photo",
  place: "where",
  time: "when",
  weather: "the sky",
  discovered: "around it",
};

/** The explore card: one thing from the circle, a little bigger, with what we know about it. */
export function Explore({ element: e, onClose }: { element: Element; onClose: () => void }) {
  const seed = hash(e._id);
  return (
    <article className="explore" key={e._id}>
      <button type="button" className="explore-close" onClick={onClose} aria-label="close">
        ×
      </button>
      <p className="stamp">{KIND_WORD[e.kind] ?? "around it"}</p>
      <div className="explore-art">
        <DoodleIcon id={e.illustration} seed={seed} size={132} delay={0} />
      </div>
      <h2 className="hand explore-label">{e.label}</h2>
      <p className="explore-meaning">{e.semanticMeaning}</p>
      {e.detail ? <p className="explore-detail">{e.detail}</p> : null}

      {e.geo ? (
        <a
          className="explore-map"
          href={`https://www.openstreetmap.org/?mlat=${e.geo.lat}&mlon=${e.geo.lng}#map=16/${e.geo.lat}/${e.geo.lng}`}
          target="_blank"
          rel="noreferrer"
        >
          <DoodleIcon id="map" seed={seed + 1} size={56} marker="sky" />
          <span>
            <span className="hand">see it on a map</span>
            <span className="stamp">
              {e.geo.lat.toFixed(4)}, {e.geo.lng.toFixed(4)}
            </span>
          </span>
        </a>
      ) : null}

      {e.source ? (
        <a className="explore-source" href={e.source.url} target="_blank" rel="noreferrer">
          <span className="stamp">{domain(e.source.url)} ↗</span>
          <span className="explore-source-title">{e.source.title}</span>
        </a>
      ) : null}
    </article>
  );
}
