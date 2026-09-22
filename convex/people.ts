/**
 * Who's here. No accounts and no profiles: each browser is someone with a
 * two-word name they picked, and each open page says it's still here every
 * 20 seconds (and says goodbye when it closes). That's all a person is in
 * Small Circles.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { workspace, requireWorkspace } from "./lib/access";
import { isAlias } from "./lib/names";

/** A page that hasn't said hello in this long has gone (it beats every 20s). */
const HERE_MS = 50 * 1000;
const SESSION = /^[A-Za-z0-9_-]{8,40}$/;

/** You, as you're known here. */
export const me = query({
  args: { slug: v.string() },
  returns: v.union(v.object({ alias: v.string(), chosen: v.boolean() }), v.null()),
  handler: async (ctx, args) => {
    const ws = await workspace(ctx, args.slug);
    if (!ws) return null;
    return { alias: ws.alias ?? "someone", chosen: ws.aliasChosen === true };
  },
});

/** Pick the name you'll go by. Only names Small Circles made up are allowed. */
export const chooseAlias = mutation({
  args: { slug: v.string(), alias: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx, args.slug);
    const alias = args.alias.trim().toLowerCase();
    if (!isAlias(alias)) throw new ConvexError("pick one of the names on the page.");
    await ctx.db.patch(ws._id, { alias, aliasChosen: true });
    return null;
  },
});

/** An open page, still here. One row per page, so two apps are two pages. */
export const beat = mutation({
  args: { slug: v.string(), sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!SESSION.test(args.sessionId)) return null;
    const ws = await workspace(ctx, args.slug);
    if (!ws) return null;
    const now = Date.now();
    const row = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    const alias = ws.alias ?? "someone";
    if (row) await ctx.db.patch(row._id, { lastSeenAt: now, alias, canvasId: ws._id });
    else await ctx.db.insert("presence", { sessionId: args.sessionId, canvasId: ws._id, alias, lastSeenAt: now });
    return null;
  },
});

/** The page closed, or went to the background: it stops counting straight away. */
export const leave = mutation({
  args: { sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!SESSION.test(args.sessionId)) return null;
    const row = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

/**
 * Who's here right now: how many pages are open on the hour, and the names of
 * the other people behind them. Every open page writes a heartbeat every 20s
 * (and a goodbye when it closes), so this re-runs often enough to stay true.
 * `now` comes from the client (coarse) — queries must not call Date.now().
 */
export const here = query({
  args: { slug: v.string(), now: v.number() },
  returns: v.object({ count: v.number(), people: v.number(), names: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const ws = await workspace(ctx, args.slug);
    const pages = await ctx.db
      .query("presence")
      .withIndex("by_lastSeenAt", (q) => q.gt("lastSeenAt", args.now - HERE_MS))
      .take(300);
    const people = new Set(pages.map((p) => p.canvasId));
    const names: string[] = [];
    for (const p of pages.sort((a, b) => b.lastSeenAt - a.lastSeenAt)) {
      if (p.canvasId === ws?._id || names.includes(p.alias)) continue;
      names.push(p.alias);
    }
    return { count: Math.max(1, pages.length), people: Math.max(1, people.size), names: names.slice(0, 6) };
  },
});

/** Pages that closed without saying so: their rows go after a few minutes. */
export const sweepPresence = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("presence")
      .withIndex("by_lastSeenAt", (q) => q.lt("lastSeenAt", Date.now() - 5 * 60 * 1000))
      .take(200);
    for (const p of stale) await ctx.db.delete(p._id);
    return stale.length;
  },
});
