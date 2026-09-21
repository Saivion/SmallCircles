import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { taskLabel } from "./lib/engine";

/** How often a run's progress heartbeat is written at most. */
const PROGRESS_EVERY_MS = 20_000;
import { TASK_NOTE_MAX } from "./lib/limits";
import { redact } from "./lib/redact";
import { trimText } from "./lib/text";
import { vCrewKey, vTaskPublic, vTaskState, vTool } from "./lib/validators";

const RECENT_MS = 20 * 60 * 1000;
const RUNNING_CAP = 80;
const RECENT_CAP = 150;
const LIST_CAP = 200;

function toPublic(t: Doc<"tasks">) {
  return {
    _id: t._id,
    boardId: t.boardId,
    runId: t.runId,
    agentId: t.agentId,
    tool: t.tool,
    label: t.label,
    cardId: t.cardId,
    url: t.url,
    parentTaskId: t.parentTaskId,
    crew: t.crew,
    state: t.state,
    note: t.note,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
  };
}

/** Running tasks (<= 80) plus tasks started in the last 20 minutes (<= 150), newest first, max 200. */
export const listRecent = query({
  args: { canvasId: v.id("canvases") },
  returns: v.array(vTaskPublic),
  handler: async (ctx, args) => {
    const running = await ctx.db
      .query("tasks")
      .withIndex("by_canvas_state", (q) => q.eq("canvasId", args.canvasId).eq("state", "running"))
      .order("desc")
      .take(RUNNING_CAP);
    const since = Date.now() - RECENT_MS;
    const recent = await ctx.db
      .query("tasks")
      .withIndex("by_canvas_startedAt", (q) => q.eq("canvasId", args.canvasId).gte("startedAt", since))
      .order("desc")
      .take(RECENT_CAP);
    const byId = new Map<string, Doc<"tasks">>();
    for (const t of [...running, ...recent]) byId.set(t._id, t);
    return Array.from(byId.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, LIST_CAP)
      .map(toPublic);
  },
});

/** Start a task: the agent shows as working and the run gets a progress heartbeat. */
export const begin = internalMutation({
  args: {
    runId: v.id("runs"),
    agentId: v.id("agents"),
    tool: vTool,
    label: v.string(),
    cardId: v.optional(v.id("cards")),
    url: v.optional(v.string()),
    parentTaskId: v.optional(v.id("tasks")),
    crew: v.optional(vCrewKey),
  },
  returns: v.id("tasks"),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("run not found");
    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
      canvasId: run.canvasId,
      boardId: run.boardId,
      runId: run._id,
      agentId: args.agentId,
      tool: args.tool,
      label: taskLabel(args.label),
      ...(args.cardId ? { cardId: args.cardId } : {}),
      ...(args.url ? { url: args.url.slice(0, 2000) } : {}),
      ...(args.parentTaskId ? { parentTaskId: args.parentTaskId } : {}),
      ...(args.crew ? { crew: args.crew } : {}),
      state: "running",
      startedAt: now,
    });
    // Heartbeat, throttled: parallel crew steps would otherwise all write the
    // same run document and collide. The screen derives agent state from tasks.
    if (run.stage !== "done" && run.stage !== "failed" && now - run.lastProgressAt > PROGRESS_EVERY_MS) {
      await ctx.db.patch(run._id, { lastProgressAt: now });
    }
    return taskId;
  },
});

export const end = internalMutation({
  args: { taskId: v.id("tasks"), state: vTaskState, note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;
    const now = Date.now();
    // A task already closed by a failed run keeps its state.
    if (task.state === "running") {
      await ctx.db.patch(task._id, {
        state: args.state === "running" ? "done" : args.state,
        ...(args.note ? { note: trimText(redact(args.note, TASK_NOTE_MAX * 2), TASK_NOTE_MAX) } : {}),
        endedAt: now,
      });
    }
    const run = await ctx.db.get(task.runId);
    if (run && run.stage !== "done" && run.stage !== "failed" && now - run.lastProgressAt > PROGRESS_EVERY_MS) {
      await ctx.db.patch(run._id, { lastProgressAt: now });
    }
    return null;
  },
});

/** A task that is recorded already finished (skipped mail, for example). */
export const record = internalMutation({
  args: {
    runId: v.id("runs"),
    agentId: v.id("agents"),
    tool: vTool,
    label: v.string(),
    state: vTaskState,
    note: v.optional(v.string()),
  },
  returns: v.id("tasks"),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("run not found");
    const now = Date.now();
    return await ctx.db.insert("tasks", {
      canvasId: run.canvasId,
      boardId: run.boardId,
      runId: run._id,
      agentId: args.agentId,
      tool: args.tool,
      label: taskLabel(args.label),
      state: args.state,
      ...(args.note ? { note: trimText(redact(args.note, TASK_NOTE_MAX * 2), TASK_NOTE_MAX) } : {}),
      startedAt: now,
      endedAt: now,
    });
  },
});
