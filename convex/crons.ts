import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { INBOUND_SEEN_TTL_MS } from "./lib/limits";

const PRUNE_BATCH = 200;

/** Retention: drop inboundSeen rows older than 7 days, 200 per call, rescheduling until done. */
export const pruneInboundSeen = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), done: v.boolean() }),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("inboundSeen")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", Date.now() - INBOUND_SEEN_TTL_MS))
      .take(PRUNE_BATCH);
    for (const r of rows) await ctx.db.delete(r._id);
    const more = rows.length === PRUNE_BATCH;
    if (more) await ctx.scheduler.runAfter(0, internal.crons.pruneInboundSeen, {});
    return { deleted: rows.length, done: !more };
  },
});

const crons = cronJobs();
// Stalled runs fail; idle boards with unread cards start a run.
crons.interval("sweep runs", { minutes: 2 }, internal.runs.sweep, {});
// Tasks older than 24 h, mail older than 30 days.
crons.daily("prune tasks and mail", { hourUTC: 4, minuteUTC: 0 }, internal.runs.prune, {});
crons.daily("prune inbound seen", { hourUTC: 4, minuteUTC: 15 }, internal.crons.pruneInboundSeen, {});
export default crons;
