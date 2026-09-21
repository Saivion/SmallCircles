/** Collapse whitespace and cap to `max` chars (with an ellipsis). Runtime-agnostic. */
export function trimText(text: string | undefined | null, max: number): string {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  // Cut at a word, so a caption never ends mid-word.
  const head = s.slice(0, Math.max(0, max - 1));
  const word = head.replace(/[\s,;:.\u2013\u2014-]*\S*$/, "");
  return `${word.length > max * 0.6 ? word : head}…`;
}

/** Bare lower-case address out of a `From` header ("Name <a@b>" or "a@b"). */
export function senderAddress(from: string | undefined): string {
  const s = String(from ?? "").trim();
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

const EMAIL_SHAPE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;
export function isEmailAddress(s: string): boolean {
  return s.length <= 254 && EMAIL_SHAPE.test(s);
}
