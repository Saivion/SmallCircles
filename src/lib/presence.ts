/**
 * Being here: each open page (a tab, a window, another app) has its own
 * session, says hello every 20 seconds, and says goodbye when it's closed or
 * put in the background.
 */
"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";

const BEAT_MS = 20_000;
/** Soft leave waits this long so Strict Mode remounts / effect re-runs don't delete then recreate the row (the count flicker). */
const LEAVE_GRACE_MS = 1_500;
/** Coarse clock for the here-query: avoids Date.now() inside Convex queries. */
const HERE_TICK_MS = 10_000;

type Here = { count: number; people: number; names: string[] };

/** One id per page load: this tab, not this person. */
let session: string | null = null;
function sessionId(): string {
  if (!session) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    session = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  return session;
}

function bucketNow(ms = Date.now()): number {
  return Math.floor(ms / HERE_TICK_MS) * HERE_TICK_MS;
}

/** Keep this page counted as here while it's open and visible. */
export function useHeartbeat(slug: string | null) {
  const beat = useMutation(api.people.beat);
  const leave = useMutation(api.people.leave);
  useEffect(() => {
    if (!slug) return;
    const id = sessionId();
    let leaveTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelLeave = () => {
      if (leaveTimer === null) return;
      clearTimeout(leaveTimer);
      leaveTimer = null;
    };

    const hello = () => {
      cancelLeave();
      void beat({ slug, sessionId: id }).catch(() => {});
    };

    /** Soft by default: a remount within the grace window cancels the leave. Hard on pagehide. */
    const bye = (hard = false) => {
      cancelLeave();
      if (hard) {
        void leave({ sessionId: id }).catch(() => {});
        return;
      }
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        void leave({ sessionId: id }).catch(() => {});
      }, LEAVE_GRACE_MS);
    };

    const onVisibility = () => (document.visibilityState === "visible" ? hello() : bye());
    const onHide = () => bye(true);

    if (document.visibilityState === "visible") hello();
    const timer = window.setInterval(() => document.visibilityState === "visible" && hello(), BEAT_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      bye();
    };
  }, [slug, beat, leave]);
}

/** Who's here: live, re-run by every page's heartbeat and goodbye. */
export function useHere(slug: string): Here | undefined {
  const [now, setNow] = useState(bucketNow);
  useEffect(() => {
    const tick = () => setNow(bucketNow());
    const t = window.setInterval(tick, HERE_TICK_MS);
    return () => window.clearInterval(t);
  }, []);

  const live = useQuery(api.people.here, { slug, now });
  // Keep the last answer while args change, so the label doesn't flash "1" for a frame.
  // (Adjusted while rendering, React's pattern for state that follows a prop, rather than in an effect.)
  const [held, setHeld] = useState<Here | undefined>(undefined);
  if (live !== undefined && live !== held) setHeld(live);
  return live ?? held;
}
