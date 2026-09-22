import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

const PRUNE_BATCH = 200;
const INBOUND_SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
// A circle whose drawing stopped (the action died) is closed with what it has.
crons.interval("sweep circles", { minutes: 2 }, internal.circles.sweep, {});
crons.interval("sweep presence", { minutes: 5 }, internal.people.sweepPresence, {});
crons.daily("prune inbound seen", { hourUTC: 4, minuteUTC: 15 }, internal.crons.pruneInboundSeen, {});
export default crons;
