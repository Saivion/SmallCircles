"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { api } from "@convex/_generated/api";
import { Studio } from "@/components/studio/Studio";
import { ConvexRoot } from "@/lib/convexClient";
import { getServerWorkspaceSlug, getWorkspaceSlug, subscribeWorkspace } from "@/lib/workspace";

/**
 * Each browser gets a private workspace (unguessable `?w=` + localStorage).
 * No sign-in: knowing the link is knowing the workspace.
 */
function App() {
  // Browser-only: the key comes from the URL and localStorage, so the server
  // render has none and the client fills it in on its first read.
  const slug = useSyncExternalStore(subscribeWorkspace, getWorkspaceSlug, getServerWorkspaceSlug);
  const ensure = useMutation(api.canvases.ensure);
  const asked = useRef<string | null>(null);

  const canvas = useQuery(api.canvases.getBySlug, slug ? { slug } : "skip");

  useEffect(() => {
    if (!slug || canvas !== null || asked.current === slug) return;
    asked.current = slug;
    void ensure({ slug }).catch(() => {
      asked.current = null;
    });
  }, [slug, canvas, ensure]);

  const ready = slug !== null && canvas !== undefined && canvas !== null;

  return <Studio canvasId={canvas?._id ?? null} loaded={ready} />;
}

function SetupNotice() {
  return (
    <main className="setup-notice">
      <h1>SmallCircles</h1>
      <p>
        This build has no Convex deployment URL. Set <code>NEXT_PUBLIC_CONVEX_URL</code> and rebuild.
      </p>
    </main>
  );
}

export default function Page() {
  return (
    <ConvexRoot fallback={<SetupNotice />}>
      <App />
    </ConvexRoot>
  );
}
