/**
 * Redaction helpers. Every write of user-derived or provider-derived text to
 * statusText, jobs.step, jobs.error, logs, or mail card bodies goes through here.
 */
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Explicitly prefixed provider keys (OpenAI sk-, Firecrawl fc-, Svix whsec_).
const KEY_PREFIX_RE = /\b(?:sk|fc)-[A-Za-z0-9_\-]{8,}|\bwhsec_[A-Za-z0-9_\-+/=]{8,}/g;
// Long opaque runs (32+ hex, 40+ base64ish). Not applied to bodies: it would
// eat long URL slugs. The lookbehind keeps URL path segments and dotted hosts.
const LONG_RUN_RE = /(?<![/.\w-])(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9_\-]{40,}={0,2})(?![\w-])/g;

export const STATUS_MAX = 300;

/** Strip addresses and key-shaped strings; cap to STATUS_MAX chars. */
export function redact(text: string, max: number = STATUS_MAX): string {
  const cleaned = String(text ?? "")
    .replace(EMAIL_RE, "[redacted inbox]")
    .replace(KEY_PREFIX_RE, "[redacted]")
    .replace(LONG_RUN_RE, "[redacted]");
  return cleaned.length > max ? cleaned.slice(0, max - 1) + "…" : cleaned;
}

/** Strip addresses and keys without a short cap (for card bodies). */
export function redactBody(text: string): string {
  return String(text ?? "")
    .replace(EMAIL_RE, "[redacted inbox]")
    .replace(KEY_PREFIX_RE, "[redacted]");
}

export function truncateBody(text: string, max = 8000): string {
  const s = String(text ?? "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Summarise an unknown thrown value into a redacted, short string. */
export function redactError(err: unknown): string {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return "unknown error";
            }
          })();
  // First line only, without runtime prefixes, so a stack trace never
  // reaches a circle's status text.
  const firstLine = (msg || "unknown error")
    .split("\n")[0]
    .replace(/^Uncaught\s+/, "")
    .replace(/^(?:[\w]*Error):\s*/, "")
    .trim();
  return redact(firstLine || "unknown error");
}
