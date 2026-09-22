import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { makeAlias } from "./lib/names";

/** Soft ceiling so a runaway client cannot mint forever. */
const MAX_CANVASES = 5000;
/** Private workspace slugs: unguessable, no auth. Knowing the slug is access. */
const PRIVATE_SLUG = /^[A-Za-z0-9_-]{20,48}$/;

function assertPrivateSlug(raw: string): string {
  const slug = raw.trim().slice(0, 48);
  if (!PRIVATE_SLUG.test(slug)) throw new ConvexError("invalid workspace");
  return slug;
}

/** Whether this browser's workspace exists yet. */
export const exists = query({
  args: { slug: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const slug = args.slug.trim().slice(0, 48);
    if (!PRIVATE_SLUG.test(slug)) return false;
    const ws = await ctx.db
      .query("canvases")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    return ws !== null;
  },
});

/** Idempotent: the workspace for a private slug the browser minted. */
export const ensure = mutation({
  args: { slug: v.string() },
  returns: v.id("canvases"),
  handler: async (ctx, args) => {
    const slug = assertPrivateSlug(args.slug);
    const existing = await ctx.db
      .query("canvases")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existing) return existing._id;
    const sample = await ctx.db.query("canvases").take(MAX_CANVASES);
    if (sample.length >= MAX_CANVASES) throw new ConvexError("workspace limit reached");
    return await ctx.db.insert("canvases", { slug, alias: makeAlias(), createdAt: Date.now() });
  },
});
