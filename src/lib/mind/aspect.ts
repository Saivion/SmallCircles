/**
 * Measured image aspect ratios (width / height), learned as pictures load.
 * The layout reads them to size image cards: wide pictures span both board
 * columns, tall ones get a tall tile, square ones a square. Unknown ratios
 * fall back to a portrait tile until the image arrives.
 */
type Listener = () => void;

const ratios = new Map<string, number>();
const listeners = new Set<Listener>();
let version = 0;
let pending = 0;

export function getAspect(cardId: string) {
  return ratios.get(cardId);
}

export function getAspectVersion() {
  return version;
}

export function subscribeAspect(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Coalesce many image loads into one layout pass per frame. */
export function setAspect(cardId: string, ratio: number) {
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  const rounded = Math.round(ratio * 100) / 100;
  if (ratios.get(cardId) === rounded) return;
  ratios.set(cardId, rounded);
  if (pending) return;
  // A timer, not an animation frame: hidden tabs still need the layout to
  // settle so the board is right when the user comes back.
  pending = window.setTimeout(() => {
    pending = 0;
    version += 1;
    for (const l of listeners) l();
  }, 40);
}

/** Pictures that failed to load: those cards fall back to a link card. */
const broken = new Set<string>();

export function isBroken(cardId: string) {
  return broken.has(cardId);
}

export function markBroken(cardId: string) {
  if (broken.has(cardId)) return;
  broken.add(cardId);
  version += 1;
  for (const l of listeners) l();
}
