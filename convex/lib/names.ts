/**
 * Who you are here: two words, picked at random, never tied to anything else.
 * No profiles, no handles; just enough of a name to say "amber fox added a
 * memory". Pure TypeScript with zero imports.
 */

const FIRST = [
  "amber", "quiet", "paper", "early", "slow", "lucky", "small", "soft", "salt", "cedar",
  "velvet", "linen", "lemon", "ember", "misty", "sunny", "rusty", "hazel", "coral", "willow",
  "tidal", "honey", "maple", "copper", "pocket", "gentle", "idle", "golden", "silver", "wild",
] as const;

const SECOND = [
  "fox", "heron", "moth", "otter", "finch", "wren", "hare", "badger", "sparrow", "koi",
  "robin", "lark", "owl", "seal", "deer", "crane", "beetle", "swift", "puffin", "gecko",
  "pigeon", "marten", "newt", "plover", "vole", "magpie", "tern", "stoat", "lynx", "ibis",
] as const;

/** A name from any source of randomness in [0, 1). */
export function makeAlias(rand: () => number = Math.random): string {
  return `${FIRST[Math.floor(rand() * FIRST.length)]} ${SECOND[Math.floor(rand() * SECOND.length)]}`;
}

/** A few different names to choose from. */
export function aliasChoices(n = 3, rand: () => number = Math.random): string[] {
  const out = new Set<string>();
  let guard = 0;
  while (out.size < n && guard++ < 50) out.add(makeAlias(rand));
  return [...out];
}

const ALIAS = /^[a-z]{2,12} [a-z]{2,12}$/;

/** Only names this file could have made. */
export function isAlias(value: string): boolean {
  if (!ALIAS.test(value)) return false;
  const [a, b] = value.split(" ");
  return (FIRST as readonly string[]).includes(a) && (SECOND as readonly string[]).includes(b);
}

/** The name the house uses for starter moments. */
export const HOUSE_ALIAS = "small circles";
