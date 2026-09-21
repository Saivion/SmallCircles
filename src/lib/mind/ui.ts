/**
 * UI state kept out of the document store and out of React state: the open
 * card, the search query, the selected circle (board), the command bar's
 * mode, and the studio panel. Each value has its own subscription.
 */
type Listener = () => void;

function createValue<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function readFalse() {
  return false;
}

export function readNull(): string | null {
  return null;
}

/* open card (lightbox) */
const openCardValue = createValue<string | null>(null);
export const getOpenCardId = openCardValue.get;
export const subscribeOpen = openCardValue.subscribe;
export const openCard = (id: string) => openCardValue.set(id);
export const closeCard = () => openCardValue.set(null);

/* search */
const queryValue = createValue("");
export const getQuery = queryValue.get;
export const subscribeQuery = queryValue.subscribe;
export const getServerQuery = () => "";
export const setQuery = (next: string) => queryValue.set(next.trim().toLowerCase());

/* selected circle (board); null is home */
const boardValue = createValue<string | null>(null);
export const getSelectedBoardId = boardValue.get;
export const subscribeSelectedBoard = boardValue.subscribe;
export function selectBoard(id: string | null) {
  queryValue.set("");
  boardValue.set(id);
  if (typeof window !== "undefined") window.scrollTo({ top: 0 });
}

/* studio panel — closed by default; opens on Team / Mail or when a run is live */
export type PanelTab = "team" | "mail";
const panelValue = createValue<PanelTab | null>(null);
export const getPanel = panelValue.get;
export const subscribePanel = panelValue.subscribe;
export const getServerPanel = (): PanelTab | null => null;
export const setPanel = (next: PanelTab | null) => panelValue.set(next);
export const togglePanel = (tab: PanelTab) => panelValue.set(panelValue.get() === tab ? null : tab);
