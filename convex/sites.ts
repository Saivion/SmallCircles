import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const BLOCKED_SHOWN = 60;

/** A bare host: lowercase, no "www.", no port. */
export function bareHost(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "");
}

/** True when `host` is `domain` or one of its subdomains. */
export function isBlockedHost(host: string, blocked: ReadonlySet<string>): boolean {
  const h = bareHost(host);
  if (!h) return false;
  if (blocked.has(h)) return true;
  const parts = h.split(".");
  for (let i = 1; i < parts.length - 1; i++) if (blocked.has(parts.slice(i).join("."))) return true;
  return false;
}

/** Remember that a site refused to be read, so Finder can avoid it next time. */
export const markBlocked = internalMutation({
  args: { runId: v.id("runs"), domain: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    const domain = bareHost(args.domain).slice(0, 120);
    if (!run || !domain) return null;
    const now = Date.now();
    const row = await ctx.db
      .query("blockedSites")
      .withIndex("by_canvas_domain", (q) => q.eq("canvasId", run.canvasId).eq("domain", domain))
      .unique();
    if (row) await ctx.db.patch(row._id, { count: row.count + 1, lastSeen: now });
    else await ctx.db.insert("blockedSites", { canvasId: run.canvasId, domain, count: 1, lastSeen: now });
    return null;
  },
});

/** Sites that refused to be read on this run's canvas, most recent first. */
export const blockedDomains = internalQuery({
  args: { runId: v.id("runs") },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return [];
    const rows = await ctx.db
      .query("blockedSites")
      .withIndex("by_canvas_lastSeen", (q) => q.eq("canvasId", run.canvasId))
      .order("desc")
      .take(BLOCKED_SHOWN);
    return rows.map((r) => r.domain);
  },
});
