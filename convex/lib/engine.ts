import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { islandCell, islandOrigin, isHallwayLayout, constellationPlacement } from "./cells";
import { urlHost, urlTitle } from "./footer";
import {
  BOARD_PROMPT_MAX,
  BOARD_TITLE_MAX,
  HOUR_MS,
  MAX_BOARDS,
  MAX_CARDS_PER_BOARD,
  MAX_RUNNING_RUNS_PER_CANVAS,
  MAX_RUNS_PER_HOUR,
  TASK_LABEL_MAX,
} from "./limits";
import { redact } from "./redact";
import { trimText } from "./text";
import { ACTIVE_STAGES, type RunReason, type Skill } from "./validators";

type Ctx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const DEFAULT_AGENTS = [
  { name: "Finder", color: "rose", skills: ["search", "think", "mail"] },
  { name: "Reader", color: "sky", skills: ["browse", "think", "mail"] },
  { name: "Sorter", color: "amber", skills: ["sort", "think", "mail"] },
] as const;

export async function agentsOf(ctx: Ctx, canvasId: Id<"canvases">): Promise<Doc<"agents">[]> {
  return await ctx.db
    .query("agents")
    .withIndex("by_canvas", (q) => q.eq("canvasId", canvasId))
    .take(20);
}

export function pickAgent(agents: Doc<"agents">[], skill: Skill): Doc<"agents"> | null {
  return agents.find((a) => a.skills.includes(skill)) ?? null;
}

/**
 * Create Finder / Reader / Sorter when the canvas has no agents. Returns
 * whether any agent still needs an inbox.
 */
export async function ensureAgents(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
): Promise<{ created: number; needInbox: boolean }> {
  const existing = await agentsOf(ctx, canvasId);
  if (existing.length > 0) {
    // Agents flagged "error" already failed provisioning; do not retry on every load.
    return { created: 0, needInbox: existing.some((a) => !a.inboxId && a.status !== "error") };
  }
  const now = Date.now();
  for (const spec of DEFAULT_AGENTS) {
    await ctx.db.insert("agents", {
      canvasId,
      name: spec.name,
      color: spec.color,
      skills: [...spec.skills],
      status: "idle",
      lastActiveAt: now,
      createdAt: now,
    });
  }
  return { created: DEFAULT_AGENTS.length, needInbox: true };
}

/** Working while the agent has running tasks on its canvas, idle otherwise. */
export async function refreshAgent(ctx: MutationCtx, agentId: Id<"agents">): Promise<void> {
  const agent = await ctx.db.get(agentId);
  if (!agent) return;
  const running = await ctx.db
    .query("tasks")
    .withIndex("by_canvas_state", (q) => q.eq("canvasId", agent.canvasId).eq("state", "running"))
    .order("desc")
    .take(100);
  const mine = running.filter((t) => t.agentId === agentId);
  const now = Date.now();
  if (mine.length === 0) {
    if (agent.status !== "idle" || agent.statusText !== undefined) {
      await ctx.db.patch(agentId, { status: "idle", statusText: undefined, lastActiveAt: now });
    }
    return;
  }
  const statusText = trimText(mine[0].label, 80);
  await ctx.db.patch(agentId, { status: "working", statusText, lastActiveAt: now });
}

export async function refreshAgents(ctx: MutationCtx, canvasId: Id<"canvases">): Promise<void> {
  for (const a of await agentsOf(ctx, canvasId)) await refreshAgent(ctx, a._id);
}

// ---------------------------------------------------------------------------
// Boards and cards
// ---------------------------------------------------------------------------

export function cleanTitle(text: string, fallback: string): string {
  return trimText(text, BOARD_TITLE_MAX) || trimText(fallback, BOARD_TITLE_MAX) || "links";
}

export async function boardsOf(ctx: Ctx, canvasId: Id<"canvases">): Promise<Doc<"boards">[]> {
  return await ctx.db
    .query("boards")
    .withIndex("by_canvas", (q) => q.eq("canvasId", canvasId))
    .take(100);
}

/** New board on the next free constellation cell. Throws a ConvexError past MAX_BOARDS when `throwOnLimit`. */
export async function createBoard(
  ctx: MutationCtx,
  args: { canvasId: Id<"canvases">; title: string; prompt: string; replyTo?: string; throwOnLimit: boolean },
): Promise<Doc<"boards"> | null> {
  const boards = await boardsOf(ctx, args.canvasId);
  if (boards.length >= MAX_BOARDS) {
    if (args.throwOnLimit) throw new ConvexError(`You have ${MAX_BOARDS} boards. Remove one first.`);
    return null;
  }
  const cell = islandCell(new Set(boards.map((b) => b.cell)));
  const { originX, originY } = islandOrigin(cell);
  const now = Date.now();
  const id = await ctx.db.insert("boards", {
    canvasId: args.canvasId,
    title: cleanTitle(args.title, "links"),
    prompt: trimText(args.prompt, BOARD_PROMPT_MAX),
    status: "idle",
    cell,
    originX,
    originY,
    found: 0,
    read: 0,
    kept: 0,
    ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    createdAt: now,
    updatedAt: now,
  });
  return await ctx.db.get(id);
}

/**
 * If boards still sit on the legacy single-row hallway, re-place them in a
 * constellation. Safe to call on every ensure: no-ops when already 2D.
 */
export async function reflowHallwayBoards(ctx: MutationCtx, canvasId: Id<"canvases">): Promise<number> {
  const boards = (await boardsOf(ctx, canvasId)).sort((a, b) => a.createdAt - b.createdAt);
  if (!isHallwayLayout(boards.map((b) => b.cell))) return 0;
  const places = constellationPlacement(boards.length);
  const now = Date.now();
  for (let i = 0; i < boards.length; i++) {
    const place = places[i];
    const board = boards[i];
    if (!place || !board) continue;
    if (board.cell === place.cell && board.originX === place.originX && board.originY === place.originY) continue;
    await ctx.db.patch(board._id, {
      cell: place.cell,
      originX: place.originX,
      originY: place.originY,
      updatedAt: now,
    });
  }
  return boards.length;
}

/** Insert raw cards for new URLs on a board (deduped, capped). Returns how many were added. */
export async function insertLinkCards(
  ctx: MutationCtx,
  board: Doc<"boards">,
  urls: string[],
  source: "you" | "email",
): Promise<number> {
  const onBoard = await ctx.db
    .query("cards")
    .withIndex("by_board", (q) => q.eq("boardId", board._id))
    .take(MAX_CARDS_PER_BOARD + 1);
  let room = MAX_CARDS_PER_BOARD - onBoard.length;
  let added = 0;
  const now = Date.now();
  for (const url of urls) {
    if (room <= 0) break;
    const dupe = await ctx.db
      .query("cards")
      .withIndex("by_board_url", (q) => q.eq("boardId", board._id).eq("url", url))
      .first();
    if (dupe) continue;
    await ctx.db.insert("cards", {
      canvasId: board.canvasId,
      boardId: board._id,
      status: "new",
      source,
      kind: "raw",
      title: urlTitle(url),
      body: "",
      url,
      domain: urlHost(url),
      createdAt: now,
      updatedAt: now,
    });
    added++;
    room--;
  }
  if (added > 0) await ctx.db.patch(board._id, { updatedAt: now });
  return added;
}

export async function boardCounts(
  ctx: Ctx,
  boardId: Id<"boards">,
): Promise<{ found: number; read: number; kept: number }> {
  const cards = await ctx.db
    .query("cards")
    .withIndex("by_board", (q) => q.eq("boardId", boardId))
    .take(300);
  let read = 0;
  let kept = 0;
  for (const c of cards) {
    if (c.status === "ready") read++;
    if (c.status === "ready" && c.inFocus === true && c.kind !== "archived") kept++;
  }
  return { found: cards.length, read, kept };
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function activeRuns(ctx: Ctx, canvasId: Id<"canvases">): Promise<Doc<"runs">[]> {
  const out: Doc<"runs">[] = [];
  for (const stage of ACTIVE_STAGES) {
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_canvas_stage", (q) => q.eq("canvasId", canvasId).eq("stage", stage))
      .take(50);
    out.push(...rows);
  }
  return out;
}

export async function runsLastHour(ctx: Ctx, canvasId: Id<"canvases">): Promise<number> {
  const since = Date.now() - HOUR_MS;
  const rows = await ctx.db
    .query("runs")
    .withIndex("by_canvas_startedAt", (q) => q.eq("canvasId", canvasId).gte("startedAt", since))
    .take(MAX_RUNS_PER_HOUR + 1);
  return rows.length;
}

export async function isBoardRunning(ctx: Ctx, board: Doc<"boards">): Promise<boolean> {
  if (!board.lastRunId) return false;
  const run = await ctx.db.get(board.lastRunId);
  return !!run && (ACTIVE_STAGES as readonly string[]).includes(run.stage);
}

/**
 * Start a run over a board. Public callers get a plain ConvexError past a
 * limit; internal callers (`throwOnLimit: false`) get `{ started: false }`.
 */
export async function startRun(
  ctx: MutationCtx,
  board: Doc<"boards">,
  reason: RunReason,
  opts: { throwOnLimit: boolean },
): Promise<{ started: boolean; runId?: Id<"runs"> }> {
  if (await isBoardRunning(ctx, board)) return { started: false };
  const refuse = (msg: string) => {
    if (opts.throwOnLimit) throw new ConvexError(msg);
    return { started: false };
  };
  if ((await activeRuns(ctx, board.canvasId)).length >= MAX_RUNNING_RUNS_PER_CANVAS) {
    return refuse(`${MAX_RUNNING_RUNS_PER_CANVAS} boards are already running. Try again in a moment.`);
  }
  if ((await runsLastHour(ctx, board.canvasId)) >= MAX_RUNS_PER_HOUR) {
    return refuse(`${MAX_RUNS_PER_HOUR} runs in the last hour. Try again later.`);
  }
  const now = Date.now();
  const counts = await boardCounts(ctx, board._id);
  const runId = await ctx.db.insert("runs", {
    canvasId: board.canvasId,
    boardId: board._id,
    round: 0,
    stage: board.prompt && reason !== "links added" && reason !== "sweep" ? "find" : "read",
    reason,
    startedAt: now,
    lastProgressAt: now,
    ...counts,
  });
  await ctx.db.patch(board._id, {
    status: "running",
    lastRunId: runId,
    error: undefined,
    ...counts,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.agents.team.execute, { runId });
  return { started: true, runId };
}

/**
 * End a run (done or failed): counts, board status, leftover running tasks
 * and half-read cards, agent status. Idempotent.
 */
export async function closeRun(
  ctx: MutationCtx,
  runId: Id<"runs">,
  outcome: { stage: "done" } | { stage: "failed"; error: string },
): Promise<Doc<"runs"> | null> {
  const run = await ctx.db.get(runId);
  if (!run || run.stage === "done" || run.stage === "failed") return null;
  const now = Date.now();
  const error = outcome.stage === "failed" ? redact(outcome.error, 200) : undefined;

  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .take(300);
  for (const t of tasks) {
    if (t.state !== "running") continue;
    await ctx.db.patch(t._id, {
      state: "failed",
      note: outcome.stage === "failed" ? trimText(error, 200) : "stopped",
      endedAt: now,
    });
  }
  const reading = await ctx.db
    .query("cards")
    .withIndex("by_board_status", (q) => q.eq("boardId", run.boardId).eq("status", "reading"))
    .take(100);
  for (const c of reading) await ctx.db.patch(c._id, { status: "failed", updatedAt: now });

  const counts = await boardCounts(ctx, run.boardId);
  await ctx.db.patch(runId, {
    stage: outcome.stage,
    endedAt: now,
    lastProgressAt: now,
    ...(error ? { error } : {}),
    ...counts,
  });
  const board = await ctx.db.get(run.boardId);
  if (board && board.lastRunId === runId) {
    await ctx.db.patch(board._id, {
      status: outcome.stage,
      ...(error ? { error } : { error: undefined }),
      ...counts,
      updatedAt: now,
    });
  }
  await refreshAgents(ctx, run.canvasId);
  return await ctx.db.get(runId);
}

export function taskLabel(text: string): string {
  return trimText(redact(text, TASK_LABEL_MAX * 2), TASK_LABEL_MAX);
}
