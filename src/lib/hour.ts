/**
 * The hour on the page: which prompt is up and how long it has left. The
 * clock runs here, from the same list the backend stamps moments with, so
 * the prompt turns over on the hour without asking the server.
 */
"use client";

import { useEffect, useState } from "react";
import { hourEndsAt, hourOf, promptFor } from "@convex/lib/hour";

export type Hour = { hour: number; prompt: string; minutesLeft: number };

function now(): Hour {
  const t = Date.now();
  const hour = hourOf(t);
  return { hour, prompt: promptFor(hour), minutesLeft: Math.max(1, Math.ceil((hourEndsAt(hour) - t) / 60000)) };
}

export function useHour(): Hour {
  const [h, setH] = useState(now);
  useEffect(() => {
    const id = window.setInterval(() => setH(now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return h;
}

/** "new topic in 23 min": how long this hour's topic has left. */
export function leftLabel(minutes: number): string {
  return minutes <= 1 ? "new topic in a minute" : `new topic in ${minutes} min`;
}
