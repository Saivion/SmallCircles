/**
 * Starter moments. A new visitor in a quiet hour should still find a ring
 * of real circles to open and add to, so the house shares a few photos of
 * its own (public-domain and CC samples, see public/samples/CREDITS.md).
 * They're labelled as the house's, sit behind everyone else's in the pool,
 * and are drawn by the same pipeline as any other moment.
 *
 *   node scripts/seed-samples.mjs          (runs both steps below)
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { HOUSE_ALIAS } from "./lib/names";
import { PRIVATE_SLUG } from "./lib/access";
import { SAMPLE_PROMPTS } from "./lib/samples";

/** Make a workspace the house: its moments go straight out, under the house's name. */
export const house = internalMutation({
  args: { slug: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const slug = args.slug.trim();
    if (!PRIVATE_SLUG.test(slug)) throw new Error("not a workspace slug");
    const ws = await ctx.db
      .query("canvases")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!ws) throw new Error("open the workspace first (canvases:ensure)");
    await ctx.db.patch(ws._id, { house: true, alias: HOUSE_ALIAS, aliasChosen: true });
    return null;
  },
});

/** Take the house's moments down (to re-share them), with everything added to them. */
export const clearHouse = internalMutation({
  args: {},
  returns: v.object({ removed: v.number() }),
  handler: async (ctx) => {
    const recent = await ctx.db
      .query("circles")
      .withIndex("by_released_createdAt", (q) => q.eq("released", true))
      .order("desc")
      .take(200);
    let removed = 0;
    for (const c of recent) {
      if (!c.seeded) continue;
      for (const e of await ctx.db.query("circleElements").withIndex("by_circle", (q) => q.eq("circleId", c._id)).take(50)) await ctx.db.delete(e._id);
      for (const n of await ctx.db.query("circleNotes").withIndex("by_circle", (q) => q.eq("circleId", c._id)).take(100)) await ctx.db.delete(n._id);
      for (const k of await ctx.db.query("contributions").withIndex("by_circle", (q) => q.eq("circleId", c._id)).take(200)) {
        if (k.storageId) await ctx.storage.delete(k.storageId);
        await ctx.db.delete(k._id);
      }
      for (const w of await ctx.db.query("circleViews").withIndex("by_circle_viewer", (q) => q.eq("circleId", c._id)).take(500)) await ctx.db.delete(w._id);
      await ctx.storage.delete(c.primaryMedia.storageId);
      await ctx.db.delete(c._id);
      removed++;
    }
    return { removed };
  },
});

/** Give each house moment the prompt it was shared for. */
export const tidy = internalMutation({
  args: {},
  returns: v.object({ updated: v.number() }),
  handler: async (ctx) => {
    const recent = await ctx.db
      .query("circles")
      .withIndex("by_released_createdAt", (q) => q.eq("released", true))
      .order("desc")
      .take(200);
    let updated = 0;
    for (const c of recent) {
      if (!c.seeded || !c.note) continue;
      const prompt = SAMPLE_PROMPTS[c.note];
      if (prompt && c.prompt !== prompt) {
        await ctx.db.patch(c._id, { prompt });
        updated++;
      }
    }
    return { updated };
  },
});

/**
 * Draw one circle again from its photo (after the vocabulary grows, say).
 * Keeps the photo, prompt, author and everything people added; replaces the
 * drawing and its margin notes.
 *   npx convex run seed:redraw '{"circleId":"..."}'
 */
export const redraw = internalMutation({
  args: { circleId: v.id("circles") },
  returns: v.null(),
  handler: async (ctx, { circleId }) => {
    const c = await ctx.db.get(circleId);
    if (!c) throw new Error("no such circle");
    for (const e of await ctx.db.query("circleElements").withIndex("by_circle", (q) => q.eq("circleId", c._id)).take(50)) await ctx.db.delete(e._id);
    for (const n of await ctx.db.query("circleNotes").withIndex("by_circle", (q) => q.eq("circleId", c._id)).take(100)) await ctx.db.delete(n._id);
    await ctx.db.patch(c._id, { status: "drawing", title: "a moment", context: {}, finishedAt: undefined, subtitle: undefined, dateLabel: undefined });
    await ctx.scheduler.runAfter(0, internal.moments.draw.run, { circleId: c._id });
    return null;
  },
});
