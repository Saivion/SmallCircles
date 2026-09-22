/**
 * How two moments relate, from what we know about each: never from their words
 * alone. Pure and deterministic: the same two circles always score the same.
 *
 * Signals and weights (a total, capped at 1):
 *   same_exact_place   +0.50  both photos' GPS within ~120 m, or the same named spot
 *   same_landmark      +0.25  the same landmark or source drawn around both
 *   nearby             +0.15  both photos' GPS within ~1 km
 *   same_neighbourhood +0.10
 *   same_city          +0.05
 *   same_day           +0.10  taken on the same calendar day (+0.05 within two weeks)
 *   similar_moment     up to +0.10  the same kind of moment, the same things in it
 *
 * Only a total ≥ CONNECTION_THRESHOLD ever becomes a visible connection. Two
 * dinners in the same city on the same day score 0.15–0.25: not enough.
 * Quality over quantity.
 */

export const CONNECTION_THRESHOLD = 0.5;

export type MatchProfile = {
  /** GPS from the photo itself (never a guess). */
  gps: { lat: number; lng: number } | null;
  spotKey: string | null;
  hoodKey: string | null;
  cityKey: string | null;
  /** "2026-06-14T20:32:00", wall clock, when the camera knew. */
  takenAt: string | null;
  kind: string | null;
  /** Normalised landmark labels and source URLs drawn around it. */
  landmarks: string[];
  /** Normalised labels of the things in and around it. */
  things: string[];
  /** Display names, for the reason sentence. */
  spot: string | null;
  hood: string | null;
  city: string | null;
};

export type ConnectionType = "same_place" | "same_landmark" | "nearby" | "same_day" | "similar_moment";

export type Match = {
  score: number;
  type: ConnectionType;
  signals: string[];
  /** A plain sentence built from the facts; the meaning gate may write a better one. */
  reason: string;
};

/** Lowercase, no accents, no punctuation, single spaces. "Dōgenzaka 2" → "dogenzaka 2". */
export function normalise(text: string | null | undefined): string | null {
  if (!text) return null;
  const n = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return n || null;
}

export function cityKeyOf(city?: string | null, country?: string | null): string | null {
  const c = normalise(city);
  return c ? `${c}|${normalise(country) ?? ""}` : null;
}

/** A ~1 km cell. Neighbours are ±1 in each direction. */
export function geoCellOf(lat: number, lng: number): string {
  return `${Math.round(lat * 100)}:${Math.round(lng * 100)}`;
}

export function neighbourCells(cell: string): string[] {
  const [a, b] = cell.split(":").map(Number);
  const out: string[] = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(`${a + i}:${b + j}`);
  return out;
}

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function day(t: string | null): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null;
}

function overlap(a: string[], b: string[]): string[] {
  const set = new Set(a);
  return [...new Set(b.filter((x) => set.has(x)))];
}

/** Score how two moments relate. */
export function match(a: MatchProfile, b: MatchProfile): Match {
  let place = 0;
  let score = 0;
  const signals: string[] = [];
  let type: ConnectionType = "similar_moment";

  const d = a.gps && b.gps ? metres(a.gps, b.gps) : null;
  const sameSpot = !!a.spotKey && a.spotKey === b.spotKey;
  if ((d !== null && d <= 120) || sameSpot) {
    place = 0.5;
    signals.push(sameSpot ? `same spot (${a.spot ?? a.spotKey})` : `${Math.round(d!)} m apart`);
    type = "same_place";
  } else if (d !== null && d <= 1000) {
    place = 0.15;
    signals.push(`${Math.round(d)} m apart`);
    type = "nearby";
  }
  score += place;

  const landmarks = overlap(a.landmarks, b.landmarks);
  if (landmarks.length) {
    score += 0.25;
    signals.push(`same landmark (${landmarks[0]})`);
    if (type !== "same_place") type = "same_landmark";
  }

  const sameCity = !!a.cityKey && a.cityKey === b.cityKey;
  if (sameCity && !!a.hoodKey && a.hoodKey === b.hoodKey && place < 0.5) {
    score += 0.1;
    signals.push(`same neighbourhood (${a.hood ?? a.hoodKey})`);
    if (type === "similar_moment") type = "nearby";
  } else if (sameCity) {
    score += 0.05;
    signals.push(`same city (${a.city ?? a.cityKey})`);
  }

  const da = day(a.takenAt);
  const db = day(b.takenAt);
  if (da !== null && db !== null) {
    const gap = Math.abs(da - db);
    if (gap === 0) {
      score += 0.1;
      signals.push("same day");
      if (type === "similar_moment" && sameCity) type = "same_day";
    } else if (gap <= 14) {
      score += 0.05;
      signals.push("within two weeks");
    }
  }

  const things = overlap(a.things, b.things);
  const similar = (a.kind && a.kind === b.kind ? 0.03 : 0) + Math.min(0.07, things.length * 0.035);
  if (similar > 0) {
    score += similar;
    signals.push(things.length ? `both have ${things.slice(0, 2).join(", ")}` : `both a ${a.kind}`);
  }

  return { score: Math.min(1, Math.round(score * 100) / 100), type, signals, reason: reasonFor(type, a, b, landmarks[0]) };
}

/** A plain sentence from the facts alone. */
function reasonFor(type: ConnectionType, a: MatchProfile, b: MatchProfile, landmark?: string): string {
  const where = a.spot && a.spotKey === b.spotKey ? a.spot : a.hood && a.hoodKey === b.hoodKey ? a.hood : a.city && a.cityKey === b.cityKey ? a.city : null;
  const sameDay = day(a.takenAt) !== null && day(a.takenAt) === day(b.takenAt);
  switch (type) {
    case "same_place":
      return `both taken at the same place${where ? `, ${where}` : ""}${sameDay ? ", on the same day" : ", on different days"}`;
    case "same_landmark":
      return `both drawn around ${landmark ?? "the same landmark"}${where ? ` in ${where}` : ""}`;
    case "nearby":
      return `taken a few streets apart${where ? ` in ${where}` : ""}`;
    case "same_day":
      return `both in ${where ?? "the same city"} on the same day`;
    default:
      return "two moments with a lot in common";
  }
}

/** Drawings that stand for a landmark rather than a thing. */
export const LANDMARK_DRAWINGS = new Set(["tower", "dome", "arch", "bridge", "ferris_wheel", "lighthouse", "skyline", "mountain", "hot_air_balloon"]);
