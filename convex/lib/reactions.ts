/**
 * The quickest way to add to someone's circle: one drawing and one word.
 * Pure TypeScript with zero imports, shared by the page and the backend.
 */
export const REACTIONS = [
  { id: "heart", word: "love this" },
  { id: "star", word: "beautiful" },
  { id: "sun", word: "made my day" },
  { id: "wave", word: "feels familiar" },
  { id: "pin", word: "i was here too" },
  { id: "camera", word: "want to see this" },
] as const;

export type ReactionId = (typeof REACTIONS)[number]["id"];

export function reactionFor(id: string) {
  return REACTIONS.find((r) => r.id === id) ?? null;
}

/** What each kind of contribution starts out drawn as, before Small Circles has read it. */
export const FIRST_DRAWING = { note: "star", memory: "calendar", photo: "camera" } as const;

/** The prompts under "memory", to make it quick to start one. */
export const MEMORY_STARTERS = ["this reminds me of", "i was here in", "this feels like"] as const;
