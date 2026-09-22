"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CircleView } from "@/components/circles/CircleView";
import { Discover } from "@/components/circles/Discover";
import { Home } from "@/components/circles/Home";
import { Intro } from "@/components/circles/Intro";
import { Sheet } from "@/components/circles/Sheet";
import { ConvexRoot } from "@/lib/convexClient";
import { useHeartbeat } from "@/lib/presence";
import { openCircle, useOpenCircle, useView } from "@/lib/route";
import { getServerWorkspaceSlug, getWorkspaceSlug, subscribeWorkspace } from "@/lib/workspace";

const INTRO_SEEN = "smallcircles.intro";

/**
 * The way in plays on a fresh visit to the hour: once per browser session,
 * never on a link straight to a circle or to discover, and always with ?intro=1.
 */
function wantsIntro(): boolean {
  if (typeof window === "undefined") return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get("intro") === "1") return true;
  if (q.has("c") || q.has("v")) return false;
  try {
    return window.sessionStorage.getItem(INTRO_SEEN) !== "1";
  } catch {
    return true;
  }
}

/**
 * Each browser is someone (unguessable `?w=` + localStorage, and a two-word
 * name they pick). No sign-in: knowing the link is being that person.
 */
function App() {
  const slug = useSyncExternalStore(subscribeWorkspace, getWorkspaceSlug, getServerWorkspaceSlug);
  const ensure = useMutation(api.canvases.ensure);
  const exists = useQuery(api.canvases.exists, slug ? { slug } : "skip");
  const asked = useRef<string | null>(null);
  const open = useOpenCircle();
  const view = useView();
  const [intro, setIntro] = useState(wantsIntro);
  useHeartbeat(slug && exists ? slug : null);

  const introDone = useCallback(() => {
    try {
      window.sessionStorage.setItem(INTRO_SEEN, "1");
    } catch {
      /* private mode */
    }
    setIntro(false);
  }, []);

  useEffect(() => {
    if (!slug || exists !== false || asked.current === slug) return;
    asked.current = slug;
    void ensure({ slug }).catch(() => {
      asked.current = null;
    });
  }, [slug, exists, ensure]);

  if (!slug || !exists) {
    // Just the paper while the workspace opens: no loading line flashing before the way in.
    return <main className="view view-home" aria-busy="true" />;
  }
  if (open) {
    return <CircleView key={open} slug={slug} circleId={open as Id<"circles">} onClose={() => openCircle(null)} />;
  }
  if (view === "discover") return <Discover slug={slug} onOpen={(id) => openCircle(id)} />;
  // The hour mounts underneath from the start (its data loads while the way in plays), and the
  // way in fades away on top of it: a crossfade, with no loading line or pop in between.
  return (
    <>
      <Home slug={slug} onOpen={(id) => openCircle(id)} />
      {intro ? <Intro slug={slug} onDone={introDone} /> : null}
    </>
  );
}

function SetupNotice() {
  return (
    <main className="view view-home">
      <h1 className="title">small circles</h1>
      <p>
        This build has no Convex deployment URL. Set <code>NEXT_PUBLIC_CONVEX_URL</code> and rebuild.
      </p>
    </main>
  );
}

const noSubscribe = () => () => {};
const isSheet = () => new URLSearchParams(window.location.search).get("sheet") === "1";

export default function Page() {
  // Read after hydration (server snapshot is false), so the server and first client render agree.
  const sheet = useSyncExternalStore(noSubscribe, isSheet, () => false);
  if (sheet) return <Sheet />;
  return (
    <ConvexRoot fallback={<SetupNotice />}>
      <App />
    </ConvexRoot>
  );
}
