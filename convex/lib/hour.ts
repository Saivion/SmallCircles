/**
 * The hour: one prompt for everyone, the same everywhere, changing on the hour
 * (UTC). Pure TypeScript with zero imports so the page can run the clock
 * itself and the backend can stamp each moment with the prompt it answered.
 */

export const HOUR_MS = 60 * 60 * 1000;

/**
 * Hand-picked, one per hour of the day, in order. Each one points at a single
 * photo you either have in your camera roll or could take right now: concrete
 * enough to picture, and meaningful enough that the answer says something.
 */
export const PROMPTS = [
  "the most beautiful sunset you've seen",
  "a meal you still think about",
  "the view that made you stop walking",
  "a place you'd go back to tomorrow",
  "the best trip you've ever taken",
  "a night you didn't want to end",
  "where you feel most at home",
  "someone you love, doing their thing",
  "your favourite spot in your city",
  "the best coffee you've ever had",
  "a concert or show you'll never forget",
  "somewhere that took your breath away",
  "a perfect day at the beach",
  "your pet at their very best",
  "a moment that made you laugh",
  "the most beautiful place you've ever been",
  "a celebration worth remembering",
  "what your morning looked like today",
  "a street you'd love to walk again",
  "somewhere you went on your own",
  "a sky you had to stop and photograph",
  "the dish that tastes like home",
  "a first time you'll always remember",
  "the best view from a window",
] as const;

/** Which hour it is, counted from the epoch. */
export function hourOf(t: number): number {
  return Math.floor(t / HOUR_MS);
}

export function promptFor(hour: number): string {
  return PROMPTS[((hour % PROMPTS.length) + PROMPTS.length) % PROMPTS.length];
}

/** When this hour ends, in ms since the epoch. */
export function hourEndsAt(hour: number): number {
  return (hour + 1) * HOUR_MS;
}
