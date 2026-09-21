"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useMemo, type ReactNode } from "react";

export const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * One client per page. The URL is inlined at build time (static export), so
 * a missing value is a build/config problem, not a runtime one: production
 * shows a setup notice. In development a placeholder client lets the canvas
 * engine run offline for stress tests (`?stress=500`); queries stay pending.
 */
export function ConvexRoot({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const client = useMemo(() => {
    if (CONVEX_URL && /^https?:\/\//.test(CONVEX_URL)) {
      return new ConvexReactClient(CONVEX_URL, { unsavedChangesWarning: false });
    }
    if (process.env.NODE_ENV !== "production") {
      return new ConvexReactClient("https://offline-placeholder-000.convex.cloud", {
        unsavedChangesWarning: false,
        skipConvexDeploymentUrlCheck: true,
      });
    }
    return null;
  }, []);
  if (!client) return <>{fallback}</>;
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
