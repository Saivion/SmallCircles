import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { ensureAgents, reflowHallwayBoards } from "./lib/engine";
import { vCanvasDoc } from "./lib/validators";

const DEFAULT_TITLE = "SmallCircles";
const DEFAULT_FOCUS = "design";
/** Soft ceiling so a runaway client cannot mint forever. */
const MAX_CANVASES = 5000;
/**
 * Private workspace slugs: unguessable, no auth. Knowledge of the slug is
 * access. "demo" remains readable for old bookmarks but is not creatable.
 */
const PRIVATE_SLUG = /^[A-Za-z0-9_-]{20,48}$/;

function assertPrivateSlug(raw: string): string {
  const slug = raw.trim().slice(0, 48);
  if (!PRIVATE_SLUG.test(slug)) throw new ConvexError("invalid workspace");
  if (slug === "demo") throw new ConvexError("invalid workspace");
  return slug;
}

export const getBySlug = query({
  args: { slug: v.string() },
  returns: v.union(vCanvasDoc, v.null()),
  handler: async (ctx, args) => {
    const slug = args.slug.trim().slice(0, 48);
    if (!slug) return null;
    // Allow reading legacy "demo"; private slugs must look like keys.
    if (slug !== "demo" && !PRIVATE_SLUG.test(slug)) return null;
    return await ctx.db
      .query("canvases")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
  },
});

/**
 * Idempotent: returns the canvas id, creating the canvas and its team
 * (Finder, Reader, Sorter) when missing. Slug must be a private key the
 * client minted (URL + localStorage). Agents without an inbox get one
 * provisioned in the background.
 */
export const ensure = mutation({
  args: { slug: v.string() },
  returns: v.id("canvases"),
  handler: async (ctx, args) => {
    const slug = assertPrivateSlug(args.slug);
    let canvas = await ctx.db
      .query("canvases")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!canvas) {
      // Cheap existence probe: if we already have many rows, refuse new ones.
      const sample = await ctx.db.query("canvases").take(MAX_CANVASES);
      if (sample.length >= MAX_CANVASES) throw new ConvexError("workspace limit reached");
      const id = await ctx.db.insert("canvases", {
        slug,
        title: DEFAULT_TITLE,
        focus: DEFAULT_FOCUS,
        createdAt: Date.now(),
      });
      canvas = await ctx.db.get(id);
      if (!canvas) throw new ConvexError("workspace not created");
    }
    const { needInbox } = await ensureAgents(ctx, canvas._id);
    await reflowHallwayBoards(ctx, canvas._id);
    if (needInbox) {
      await ctx.scheduler.runAfter(0, internal.agentmail.ensureInboxes, { canvasId: canvas._id });
    }
    return canvas._id;
  },
});
