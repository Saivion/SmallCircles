import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/** Private workspace slugs: unguessable, no auth. Knowing the slug is being that person. */
export const PRIVATE_SLUG = /^[A-Za-z0-9_-]{20,48}$/;

/** The workspace (the person) behind a slug, or null. */
export async function workspace(ctx: QueryCtx | MutationCtx, slug: string): Promise<Doc<"canvases"> | null> {
  const clean = slug.trim().slice(0, 48);
  if (!PRIVATE_SLUG.test(clean)) return null;
  return await ctx.db
    .query("canvases")
    .withIndex("by_slug", (q) => q.eq("slug", clean))
    .unique();
}

export async function requireWorkspace(ctx: QueryCtx | MutationCtx, slug: string): Promise<Doc<"canvases">> {
  const ws = await workspace(ctx, slug);
  if (!ws) throw new ConvexError("unknown workspace");
  return ws;
}
