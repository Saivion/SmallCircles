"use node";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { handoff } from "../agentmail";
import { MAX_READ_PASSES, MAX_ROUNDS, READ_BATCH } from "../lib/limits";
import { redactError } from "../lib/redact";
import { findCards } from "./find";
import { followLinks } from "./follow";
import { groupCards } from "./group";
import { readCard } from "./read";
import { sortCards } from "./sort";

/** Cards pulled per read pass. */
const PASS_SIZE = 24;

/**
 * Read every waiting card with READ_BATCH readers working in parallel.
 * A card pasted while this runs is picked up by the next pass.
 */
async function readAll(ctx: ActionCtx, runId: Id<"runs">, round: number) {
  for (let pass = 0; pass < MAX_READ_PASSES; pass++) {
    const ids: Id<"cards">[] = await ctx.runQuery(internal.runs.unreadCards, { runId, limit: PASS_SIZE });
    if (ids.length === 0) return;
    if (pass === 0) await ctx.runMutation(internal.runs.setStage, { runId, stage: "read", round });
    const plan = await ctx.runQuery(internal.runs.getContext, { runId });
    const readerAgent = plan?.agents.find((a) => a.skills.includes("browse"));
    const waveTask = readerAgent
      ? await ctx.runMutation(internal.tasks.begin, {
          runId,
          agentId: readerAgent._id,
          tool: "browse",
          label: `Reading ${ids.length} ${ids.length === 1 ? "page" : "pages"}`,
        })
      : null;
    let next = 0;
    const reader = async () => {
      while (next < ids.length) {
        const cardId = ids[next++];
        await readCard(ctx, { runId, cardId, ...(waveTask ? { parentTaskId: waveTask } : {}) });
      }
    };
    await Promise.all(Array.from({ length: Math.min(READ_BATCH, ids.length) }, reader));
    if (waveTask) {
      await ctx.runMutation(internal.tasks.end, {
        taskId: waveTask,
        state: "done",
        note: `${ids.length} opened`,
      });
    }
  }
}

/**
 * One run over a board, start to finish, in a single action: find (when the
 * board has a prompt), read in parallel, sort, and at most one more round
 * when too few cards are kept. Handoff emails go out alongside the work and
 * never hold it up. Every step writes a task, so the screen shows it live.
 *
 * Not a durable workflow on purpose: queueing each step separately added
 * 4 to 6 idle seconds between steps. If this action dies, the sweep marks
 * the run failed once it stops making progress.
 */
export const execute = internalAction({
  args: { runId: v.id("runs") },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const mails: Promise<void>[] = [];
    const mail = (fromSkill: "search" | "browse" | "sort", toSkill: "browse" | "sort" | "search", kind: "handoff" | "need_more", round: number) =>
      mails.push(handoff(ctx, { runId, fromSkill, toSkill, kind, round }));
    try {
      const plan = await ctx.runQuery(internal.runs.plan, { runId });
      if (!plan) return null;
      // Runs started by pasted links or the unread sweep only read and sort.
      const readOnly = plan.reason === "links added" || plan.reason === "sweep";
      let hints: string[] = [];

      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (plan.hasPrompt && !readOnly) {
          await ctx.runMutation(internal.runs.setStage, { runId, stage: "find", round });
          if (round === 0) {
            await findCards(ctx, { runId, round, hints });
          } else {
            // The "need more" round: Link Follower works alongside Finder's searches.
            await Promise.all([findCards(ctx, { runId, round, hints }), followLinks(ctx, { runId })]);
          }
          mail("search", "browse", "handoff", round);
        }
        await readAll(ctx, runId, round);
        mail("browse", "sort", "handoff", round);
        await ctx.runMutation(internal.runs.setStage, { runId, stage: "sort", round });
        const res = await sortCards(ctx, { runId });
        if (readOnly || !(res.needMore && round === 0 && plan.hasPrompt)) break;
        mail("sort", "search", "need_more", round);
        hints = res.hints;
      }

      // Links pasted while the run was busy.
      const left: Id<"cards">[] = await ctx.runQuery(internal.runs.unreadCards, { runId, limit: 1 });
      if (left.length > 0) {
        await readAll(ctx, runId, MAX_ROUNDS - 1);
        await ctx.runMutation(internal.runs.setStage, { runId, stage: "sort", round: MAX_ROUNDS - 1 });
        await sortCards(ctx, { runId });
      }
      await groupCards(ctx, { runId });
      await Promise.allSettled(mails);
      await ctx.runMutation(internal.runs.finish, { runId });
    } catch (err) {
      await Promise.allSettled(mails);
      await ctx.runMutation(internal.runs.fail, { runId, error: redactError(err) });
    }
    return null;
  },
});
