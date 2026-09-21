import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { cleanTitle, closeRun, createBoard, insertLinkCards, isBoardRunning, refreshAgents, startRun } from "./lib/engine";
import { extractUrls, stripUrls, urlHost } from "./lib/footer";
import { SUBMIT_TEXT_MAX, SUBMIT_URLS_MAX } from "./lib/limits";
import { vBoardPublic } from "./lib/validators";
import { deleteEmbeddingForCard } from "./searchStore";

const REMOVE_BATCH = 200;

/** Remember how the prompt was read, so later runs widen the same way. */
export const setBrief = internalMutation({
  args: { boardId: v.id("boards"), brief: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.boardId);
    if (!board) return null;
    await ctx.db.patch(args.boardId, { brief: args.brief.slice(0, 2000) });
    return null;
  },
});

function toPublic(b: Doc<"boards">) {
  // The reply address and the model's reading of the prompt stay on the server.
  const { replyTo: _replyTo, brief: _brief, ...rest } = b;
  return rest;
}

/** Every board on a canvas, oldest first. */
export const listByCanvas = query({
  args: { canvasId: v.id("canvases") },
  returns: v.array(vBoardPublic),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("boards")
      .withIndex("by_canvas", (q) => q.eq("canvasId", args.canvasId))
      .take(100);
    return rows.sort((a, b) => a.createdAt - b.createdAt).map(toPublic);
  },
});

/**
 * The composer. Words start a new board with that prompt. Links go into the
 * given board (or a new one titled from the other words) and are read by a
 * run, or by the run already in progress on that board.
 */
export const submit = mutation({
  args: { canvasId: v.id("canvases"), text: v.string(), boardId: v.optional(v.id("boards")) },
  returns: v.object({ boardId: v.id("boards"), added: v.number(), started: v.boolean() }),
  handler: async (ctx, args) => {
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) throw new ConvexError("Canvas not found.");
    if (args.text.length > SUBMIT_TEXT_MAX) {
      throw new ConvexError(`Keep it under ${SUBMIT_TEXT_MAX} characters.`);
    }
    const text = args.text.trim();
    if (!text) throw new ConvexError("Type what you are looking for, or paste a link.");
    const urls = extractUrls(text, SUBMIT_URLS_MAX);

    if (urls.length > 0) {
      let board: Doc<"boards"> | null = null;
      if (args.boardId) {
        board = await ctx.db.get(args.boardId);
        if (!board || board.canvasId !== canvas._id) throw new ConvexError("Board not found.");
      } else {
        board = await createBoard(ctx, {
          canvasId: canvas._id,
          title: cleanTitle(stripUrls(text, 200), urlHost(urls[0]) || "links"),
          prompt: "",
          throwOnLimit: true,
        });
        if (!board) throw new ConvexError("Could not create a board.");
      }
      const added = await insertLinkCards(ctx, board, urls, "you");
      if (added === 0) return { boardId: board._id, added, started: false };
      if (await isBoardRunning(ctx, board)) return { boardId: board._id, added, started: false };
      const res = await startRun(ctx, board, "links added", { throwOnLimit: true });
      return { boardId: board._id, added, started: res.started };
    }

    const board = await createBoard(ctx, {
      canvasId: canvas._id,
      title: text,
      prompt: text,
      throwOnLimit: true,
    });
    if (!board) throw new ConvexError("Could not create a board.");
    const res = await startRun(ctx, board, "new board", { throwOnLimit: true });
    return { boardId: board._id, added: 0, started: res.started };
  },
});

/** Run the team over a board again (find runs when the board has a prompt). */
export const run = mutation({
  args: { boardId: v.id("boards") },
  returns: v.object({ started: v.boolean() }),
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.boardId);
    if (!board) throw new ConvexError("Board not found.");
    if (await isBoardRunning(ctx, board)) return { started: false };
    // Cards that failed to open get another try in this run.
    const failed = await ctx.db
      .query("cards")
      .withIndex("by_board_status", (q) => q.eq("boardId", board._id).eq("status", "failed"))
      .take(60);
    const now = Date.now();
    for (const card of failed) if (card.url) await ctx.db.patch(card._id, { status: "new", updatedAt: now });
    const res = await startRun(ctx, board, "again", { throwOnLimit: true });
    return { started: res.started };
  },
});

/** Delete one batch of a removed board's rows. Returns true when more remain. */
async function removeBatch(ctx: MutationCtx, boardId: Id<"boards">): Promise<boolean> {
  let more = false;
  const cards = await ctx.db
    .query("cards")
    .withIndex("by_board", (q) => q.eq("boardId", boardId))
    .take(REMOVE_BATCH);
  for (const c of cards) {
    await deleteEmbeddingForCard(ctx, c._id);
    await ctx.db.delete(c._id);
  }
  if (cards.length === REMOVE_BATCH) more = true;

  let taskBudget = REMOVE_BATCH;
  const runs = await ctx.db
    .query("runs")
    .withIndex("by_board", (q) => q.eq("boardId", boardId))
    .take(50);
  for (const r of runs) {
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_run", (q) => q.eq("runId", r._id))
      .take(taskBudget + 1);
    const batch = tasks.slice(0, taskBudget);
    for (const t of batch) await ctx.db.delete(t._id);
    taskBudget -= batch.length;
    if (tasks.length > batch.length) {
      more = true;
      break;
    }
    await ctx.db.delete(r._id);
    if (taskBudget <= 0) {
      more = true;
      break;
    }
  }
  if (runs.length === 50) more = true;

  const mail = await ctx.db
    .query("mail")
    .withIndex("by_board", (q) => q.eq("boardId", boardId))
    .take(REMOVE_BATCH);
  for (const m of mail) await ctx.db.delete(m._id);
  if (mail.length === REMOVE_BATCH) more = true;
  return more;
}

/** Remove a board with its cards, runs, tasks and mail. Large boards finish in the background. */
export const remove = mutation({
  args: { boardId: v.id("boards") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.boardId);
    if (!board) return null;
    // Stop a run in progress; its action sees the closed run and stops at its next step.
    if (board.lastRunId) await closeRun(ctx, board.lastRunId, { stage: "failed", error: "Board removed." });
    // The board disappears at once; its rows follow.
    await ctx.db.delete(board._id);
    const more = await removeBatch(ctx, board._id);
    if (more) await ctx.scheduler.runAfter(0, internal.boards.removeContinue, { boardId: board._id });
    await refreshAgents(ctx, board.canvasId);
    return null;
  },
});

export const removeContinue = internalMutation({
  args: { boardId: v.id("boards") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const more = await removeBatch(ctx, args.boardId);
    if (more) await ctx.scheduler.runAfter(0, internal.boards.removeContinue, { boardId: args.boardId });
    return null;
  },
});

/** Board fields the digest action needs. */
export const getForMail = internalQuery({
  args: { boardId: v.id("boards") },
  returns: v.union(v.object({ canvasId: v.id("canvases"), title: v.string(), prompt: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const b = await ctx.db.get(args.boardId);
    return b ? { canvasId: b.canvasId, title: b.title, prompt: b.prompt } : null;
  },
});
