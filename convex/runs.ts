import { v, type Infer } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  activeRuns,
  agentsOf,
  boardCounts,
  closeRun,
  refreshAgents,
  startRun,
} from "./lib/engine";
import {
  MAIL_TTL_MS,
  RUN_STALE_MS,
  TASK_TTL_MS,
  UNREAD_GRACE_MS,
} from "./lib/limits";
import { vRunPublic, vSkill, vRunReason, vRunStage } from "./lib/validators";

const PRUNE_BATCH = 200;

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** Last 20 runs on a canvas, newest first. */
export const listRecent = query({
  args: { canvasId: v.id("canvases") },
  returns: v.array(vRunPublic),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_canvas_startedAt", (q) => q.eq("canvasId", args.canvasId))
      .order("desc")
      .take(20);
    return rows.map((r) => ({
      _id: r._id,
      boardId: r.boardId,
      round: r.round,
      stage: r.stage,
      reason: r.reason,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      found: r.found,
      read: r.read,
      kept: r.kept,
      error: r.error,
    }));
  },
});

// ---------------------------------------------------------------------------
// Internal: context for agent actions
// ---------------------------------------------------------------------------

const vAgentLite = v.object({
  _id: v.id("agents"),
  name: v.string(),
  skills: v.array(vSkill),
  inboxId: v.optional(v.string()),
  inboxAddress: v.optional(v.string()),
});

export const vRunContext = v.object({
  runId: v.id("runs"),
  canvasId: v.id("canvases"),
  boardId: v.id("boards"),
  title: v.string(),
  prompt: v.string(),
  brief: v.optional(v.string()),
  round: v.number(),
  reason: vRunReason,
  stage: vRunStage,
  agents: v.array(vAgentLite),
});

export type RunContext = Infer<typeof vRunContext>;

export const getContext = internalQuery({
  args: { runId: v.id("runs") },
  returns: v.union(vRunContext, v.null()),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const board = await ctx.db.get(run.boardId);
    if (!board) return null;
    const agents = await agentsOf(ctx, run.canvasId);
    return {
      runId: run._id,
      canvasId: run.canvasId,
      boardId: board._id,
      title: board.title,
      prompt: board.prompt,
      ...(board.brief ? { brief: board.brief } : {}),
      round: run.round,
      reason: run.reason,
      stage: run.stage,
      agents: agents.map((a) => ({
        _id: a._id,
        name: a.name,
        skills: a.skills,
        inboxId: a.inboxId,
        inboxAddress: a.inboxAddress,
      })),
    };
  },
});

/** Titles and urls already on the board (for find: avoid repeats) plus the count. */
export const boardCardsBrief = internalQuery({
  args: { boardId: v.id("boards") },
  returns: v.object({
    count: v.number(),
    titles: v.array(v.string()),
    urls: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_board", (q) => q.eq("boardId", args.boardId))
      .take(300);
    return {
      count: cards.length,
      titles: cards.slice(-40).map((c) => c.title),
      urls: cards.flatMap((c) => (c.url ? [c.url] : [])),
    };
  },
});

/** Cards on the run's board still waiting to be read. */
export const unreadCards = internalQuery({
  args: { runId: v.id("runs"), limit: v.number() },
  returns: v.array(v.id("cards")),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.stage === "done" || run.stage === "failed") return [];
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit) || 1));
    const rows = await ctx.db
      .query("cards")
      .withIndex("by_board_status", (q) => q.eq("boardId", run.boardId).eq("status", "new"))
      .take(limit);
    return rows.map((c) => c._id);
  },
});

/** Run shape the orchestrator needs to decide what to do. */
export const plan = internalQuery({
  args: { runId: v.id("runs") },
  returns: v.union(v.object({ hasPrompt: v.boolean(), reason: vRunReason }), v.null()),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const board = await ctx.db.get(run.boardId);
    if (!board) return null;
    return { hasPrompt: board.prompt.trim().length > 0, reason: run.reason };
  },
});

// ---------------------------------------------------------------------------
// Internal: stage transitions
// ---------------------------------------------------------------------------

async function progress(
  ctx: Parameters<typeof boardCounts>[0],
  run: Doc<"runs">,
): Promise<{ found: number; read: number; kept: number }> {
  return await boardCounts(ctx, run.boardId);
}

export const setStage = internalMutation({
  args: {
    runId: v.id("runs"),
    stage: v.union(v.literal("find"), v.literal("read"), v.literal("sort")),
    round: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.stage === "done" || run.stage === "failed") return null;
    const counts = await progress(ctx, run);
    const now = Date.now();
    await ctx.db.patch(run._id, { stage: args.stage, round: args.round, lastProgressAt: now, ...counts });
    const board = await ctx.db.get(run.boardId);
    if (board && board.lastRunId === run._id) {
      await ctx.db.patch(board._id, { ...counts, updatedAt: now });
    }
    return null;
  },
});

/**
 * Progress heartbeat, throttled. Counts are not recomputed here: that read
 * every card on the board after every page. The screen counts live from the
 * cards; stored counts refresh at stage changes and when the run closes.
 */
export const touch = internalMutation({
  args: { runId: v.id("runs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.stage === "done" || run.stage === "failed") return null;
    const now = Date.now();
    if (now - run.lastProgressAt > 20_000) await ctx.db.patch(run._id, { lastProgressAt: now });
    return null;
  },
});

export const finish = internalMutation({
  args: { runId: v.id("runs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await closeRun(ctx, args.runId, { stage: "done" });
    if (!run) return null;
    const board = await ctx.db.get(run.boardId);
    if (board?.replyTo && run.reason === "email") {
      await ctx.scheduler.runAfter(0, internal.agentmail.digest, { boardId: board._id, to: board.replyTo });
      await ctx.db.patch(board._id, { replyTo: undefined });
    }
    return null;
  },
});

export const fail = internalMutation({
  args: { runId: v.id("runs"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await closeRun(ctx, args.runId, { stage: "failed", error: args.error });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Sweep + prune (crons)
// ---------------------------------------------------------------------------

/**
 * Every 2 minutes: fail runs with no progress for RUN_STALE_MS, and start a
 * run for any idle board holding cards left unread past UNREAD_GRACE_MS.
 */
export const sweep = internalMutation({
  args: {},
  returns: v.object({ failed: v.number(), started: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    let failed = 0;
    let started = 0;
    const canvases = await ctx.db.query("canvases").take(200);
    for (const canvas of canvases) {
      for (const run of await activeRuns(ctx, canvas._id)) {
        if (now - run.lastProgressAt < RUN_STALE_MS) continue;
        await closeRun(ctx, run._id, { stage: "failed", error: "Stopped making progress." });
        failed++;
      }
      const boards = await ctx.db
        .query("boards")
        .withIndex("by_canvas", (q) => q.eq("canvasId", canvas._id))
        .take(100);
      for (const board of boards) {
        if (board.status === "running") continue;
        const waiting = await ctx.db
          .query("cards")
          .withIndex("by_board_status", (q) => q.eq("boardId", board._id).eq("status", "new"))
          .first();
        if (!waiting || now - waiting.createdAt < UNREAD_GRACE_MS) continue;
        const res = await startRun(ctx, board, "sweep", { throwOnLimit: false });
        if (res.started) started++;
        else break; // at a limit: the next sweep tries again
      }
      await refreshAgents(ctx, canvas._id);
    }
    return { failed, started };
  },
});

/** Daily: tasks older than 24 h, mail older than 30 days, inboundSeen older than 7 days. 200 per table per call. */
export const prune = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), done: v.boolean() }),
  handler: async (ctx) => {
    const now = Date.now();
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", now - TASK_TTL_MS))
      .take(PRUNE_BATCH);
    for (const t of tasks) await ctx.db.delete(t._id);
    const mail = await ctx.db
      .query("mail")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", now - MAIL_TTL_MS))
      .take(PRUNE_BATCH);
    for (const m of mail) await ctx.db.delete(m._id);
    const more = tasks.length === PRUNE_BATCH || mail.length === PRUNE_BATCH;
    if (more) await ctx.scheduler.runAfter(0, internal.runs.prune, {});
    return { deleted: tasks.length + mail.length, done: !more };
  },
});
