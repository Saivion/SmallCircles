/**
 * The world around a moment: where it was, what the sky was doing, what the
 * light was like. Metadata goes in, meaning comes out ("golden hour in the
 * 7th", not "48.8584, 2.2945 at 20:32").
 *
 * OpenStreetMap Nominatim for places and Open-Meteo for weather and the sun:
 * both free, keyless and fine for this volume (Nominatim asks for ≤1 req/s
 * and a real User-Agent).
 */

const UA = "SmallCircles/1.0 (+https://successful-antelope-571.convex.site)";
const TIMEOUT_MS = 8000;

async function getJson<T>(url: string): Promise<T | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type Place = {
  /** The most specific thing worth naming: a landmark, a venue, else the neighbourhood or city. */
  name: string;
  neighbourhood?: string;
  city?: string;
  country?: string;
  lat: number;
  lng: number;
  /** The named spot itself, when the coordinates land on one (a café, a park, a tower). */
  spot?: string;
  spotKind?: string;
};

type NominatimAddress = Record<string, string | undefined>;
type NominatimHit = {
  lat?: string;
  lon?: string;
  name?: string;
  category?: string;
  type?: string;
  addresstype?: string;
  address?: NominatimAddress;
  display_name?: string;
};

const SPOT_CATEGORIES = new Set(["amenity", "tourism", "leisure", "historic", "shop", "building", "man_made", "natural"]);

function toPlace(hit: NominatimHit, lat: number, lng: number): Place | null {
  const a = hit.address ?? {};
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county;
  const neighbourhood = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.city_district ?? a.borough;
  const spot = hit.name && hit.category && SPOT_CATEGORIES.has(hit.category) ? hit.name : undefined;
  const name = spot ?? neighbourhood ?? city ?? a.state ?? a.country;
  if (!name) return null;
  return {
    name,
    ...(neighbourhood ? { neighbourhood } : {}),
    ...(city ? { city } : {}),
    ...(a.country ? { country: a.country } : {}),
    lat,
    lng,
    ...(spot ? { spot, spotKind: hit.type ?? hit.category } : {}),
  };
}

/** Coordinates to a place. */
export async function reverseGeocode(lat: number, lng: number): Promise<Place | null> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=en` +
    `&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`;
  const hit = await getJson<NominatimHit>(url);
  return hit ? toPlace(hit, lat, lng) : null;
}

/** A place name the photo suggests ("Eiffel Tower, Paris") to coordinates. */
export async function forwardGeocode(query: string): Promise<Place | null> {
  const q = query.trim().slice(0, 120);
  if (!q) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&accept-language=en&q=${encodeURIComponent(q)}`;
  const hits = await getJson<NominatimHit[]>(url);
  const hit = hits?.[0];
  if (!hit?.lat || !hit.lon) return null;
  return toPlace(hit, Number(hit.lat), Number(hit.lon));
}

// ---------------------------------------------------------------------------
// Time and sky
// ---------------------------------------------------------------------------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "2026-06-14T20:32:00" (camera wall-clock) → parts, no time zone games. */
export function parseTaken(takenAt: string | undefined) {
  const m = takenAt?.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const hour = m[4] !== undefined ? Number(m[4]) : undefined;
  const minute = m[5] !== undefined ? Number(m[5]) : undefined;
  return { y, mo, d, hour, minute, isoDate: `${m[1]}-${m[2]}-${m[3]}` };
}

export function dateLabel(t: NonNullable<ReturnType<typeof parseTaken>>): string {
  return `${MONTHS[t.mo - 1]} ${t.d}, ${t.y}`;
}

export function shortDate(t: NonNullable<ReturnType<typeof parseTaken>>): string {
  return `${MONTHS[t.mo - 1].slice(0, 3)} ${t.d}`;
}

/** The hour as words, before we know where the sun was. */
export function partOfDay(hour: number): string {
  if (hour < 5) return "late night";
  if (hour < 8) return "early morning";
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

export type Sky = {
  label: string;
  tempC?: number;
  code?: number;
  /** "golden hour", "just after sunset", "blue hour" … when the sun is the story. */
  light?: string;
  isNight: boolean;
};

/** WMO weather code to a few plain words. */
function weatherWords(code: number): string {
  if (code === 0) return "clear";
  if (code <= 2) return "a few clouds";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "foggy";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "showers";
  if (code === 85 || code === 86) return "snow showers";
  if (code >= 95) return "thunderstorms";
  return "mild";
}

type Meteo = {
  hourly?: { time?: string[]; temperature_2m?: (number | null)[]; weather_code?: (number | null)[] };
  daily?: { sunrise?: string[]; sunset?: string[] };
};

function minutesOf(isoLocal: string | undefined): number | null {
  const m = isoLocal?.match(/T(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Where the sun was relative to the moment, in words. */
function lightWords(at: number, rise: number | null, set: number | null): { light?: string; isNight: boolean } {
  if (rise === null || set === null) return { isNight: at < 6 * 60 || at >= 21 * 60 };
  const toSet = set - at;
  const fromRise = at - rise;
  if (toSet >= 0 && toSet <= 60) return { light: toSet <= 20 ? "just before sunset" : "golden hour", isNight: false };
  if (toSet < 0 && toSet >= -40) return { light: "just after sunset", isNight: false };
  if (toSet < -40 && toSet >= -75) return { light: "blue hour", isNight: true };
  if (fromRise >= 0 && fromRise <= 60) return { light: "just after sunrise", isNight: false };
  if (fromRise < 0 && fromRise >= -40) return { light: "first light", isNight: false };
  return { isNight: at < rise || at > set };
}

/** Weather and sun for a place at a local wall-clock time. Archive first, then the recent-past forecast. */
export async function skyAt(lat: number, lng: number, t: NonNullable<ReturnType<typeof parseTaken>>): Promise<Sky | null> {
  const q =
    `latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&start_date=${t.isoDate}&end_date=${t.isoDate}` +
    `&hourly=temperature_2m,weather_code&daily=sunrise,sunset&timezone=auto`;
  let data = await getJson<Meteo>(`https://archive-api.open-meteo.com/v1/archive?${q}`);
  if (!data?.hourly?.time?.length || data.hourly.temperature_2m?.every((x) => x === null)) {
    data = await getJson<Meteo>(`https://api.open-meteo.com/v1/forecast?${q}`);
  }
  if (!data?.hourly?.time?.length) return null;
  const hour = t.hour ?? 12;
  const idx = Math.min(hour, data.hourly.time.length - 1);
  const temp = data.hourly.temperature_2m?.[idx];
  const code = data.hourly.weather_code?.[idx];
  const at = hour * 60 + (t.minute ?? 0);
  const { light, isNight } =
    t.hour === undefined ? { light: undefined, isNight: false } : lightWords(at, minutesOf(data.daily?.sunrise?.[0]), minutesOf(data.daily?.sunset?.[0]));
  const words = typeof code === "number" ? weatherWords(code) : "";
  const tempC = typeof temp === "number" ? Math.round(temp) : undefined;
  return {
    label: [tempC !== undefined ? `${tempC}°` : "", words].filter(Boolean).join(" · ") || "mild",
    ...(tempC !== undefined ? { tempC } : {}),
    ...(typeof code === "number" ? { code } : {}),
    ...(light ? { light } : {}),
    isNight,
  };
}

/** Which doodle the sky gets. */
export function skyDoodle(sky: Sky): "sun" | "moon" | "cloud" | "rain" | "snow" | "sunset" {
  const c = sky.code ?? 0;
  if (c >= 71 && c <= 86 && c !== 80 && c !== 81 && c !== 82) return "snow";
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95) return "rain";
  if (c === 3 || c === 45 || c === 48) return "cloud";
  if (sky.light && /sunset|golden|sunrise|first light/.test(sky.light)) return "sunset";
  if (sky.isNight) return "moon";
  return c <= 1 ? "sun" : "cloud";
}
