/**
 * Where you are lives in the URL, next to the workspace `?w=…`:
 *   ?c=<circle>     a circle is open (a link from the email reply opens straight onto it)
 *   ?v=discover     visiting other people's moments
 * Both can be set at once: a circle opened from discover goes back to discover.
 * The back button walks back through them.
 */
import { useSyncExternalStore } from "react";

const CIRCLE = "c";
const VIEW = "v";
export type View = "home" | "discover";

const listeners = new Set<() => void>();

function readCircle(): string | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get(CIRCLE);
  return v && /^[a-z0-9]{10,64}$/i.test(v) ? v : null;
}

function readView(): View {
  if (typeof window === "undefined") return "home";
  return new URLSearchParams(window.location.search).get(VIEW) === "discover" ? "discover" : "home";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("popstate", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("popstate", cb);
  };
}

export function useOpenCircle(): string | null {
  return useSyncExternalStore(subscribe, readCircle, () => null);
}

export function useView(): View {
  return useSyncExternalStore(subscribe, readView, () => "home");
}

function go(mutate: (p: URLSearchParams) => void) {
  const url = new URL(window.location.href);
  mutate(url.searchParams);
  window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  listeners.forEach((l) => l());
  window.scrollTo({ top: 0 });
}

export function openCircle(id: string | null) {
  go((p) => (id ? p.set(CIRCLE, id) : p.delete(CIRCLE)));
}

/** Change view; opening a view closes any open circle. */
export function openView(view: View) {
  go((p) => {
    p.delete(CIRCLE);
    if (view === "home") p.delete(VIEW);
    else p.set(VIEW, view);
  });
}
