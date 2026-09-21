const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;

/** Normalise a URL for dedupe: strip fragment, trailing punctuation and slash. */
export function normalizeUrl(raw: string): string | null {
  let s = raw.trim().replace(/[.,;:!?)]+$/, "");
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    s = u.toString();
    if (u.pathname === "/" && !u.search) s = s.replace(/\/$/, "");
    return s.slice(0, 2000);
  } catch {
    return null;
  }
}

/** Up to `max` unique http(s) URLs in the text, in order of appearance. */
export function extractUrls(text: string, max = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(text ?? "").matchAll(URL_RE)) {
    const n = normalizeUrl(m[0]);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

/** The text with URLs removed and whitespace collapsed (the human's note). */
export function stripUrls(text: string, max = 500): string {
  return String(text ?? "")
    .replace(URL_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function urlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** "host/path" title for a raw card. */
export function urlTitle(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "");
    return `${u.hostname.replace(/^www\./, "")}${path}`.slice(0, 200);
  } catch {
    return url.slice(0, 200);
  }
}

