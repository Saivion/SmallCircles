import { v } from "convex/values";
import { internalMutation, internalQuery, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  agentsOf,
  boardsOf,
  cleanTitle,
  createBoard,
  insertLinkCards,
  isBoardRunning,
  runsLastHour,
  startRun,
} from "./lib/engine";
import { extractUrls, stripUrls, urlHost } from "./lib/footer";
import { HOUR_MS, MAIL_PREVIEW_MAX, MAX_RUNS_PER_HOUR, SUBMIT_URLS_MAX } from "./lib/limits";
import { redact } from "./lib/redact";
import { isEmailAddress, senderAddress, trimText } from "./lib/text";
import { vMailDirection, vMailKind, vMailPublic, vMailState } from "./lib/validators";

/** Last 30 mail rows on a canvas, newest first. */
export const listByCanvas = query({
  args: { canvasId: v.id("canvases") },
  returns: v.array(vMailPublic),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mail")
      .withIndex("by_canvas_createdAt", (q) => q.eq("canvasId", args.canvasId))
      .order("desc")
      .take(30);
    return rows.map(({ messageId: _messageId, ...rest }) => rest);
  },
});

// ---------------------------------------------------------------------------
// Internal: rows written by the agentmail actions
// ---------------------------------------------------------------------------

/** Outbound mail actually sent on a canvas in the last hour (capped count). */
export const sentLastHour = internalQuery({
  args: { canvasId: v.id("canvases") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mail")
      .withIndex("by_canvas_createdAt", (q) =>
        q.eq("canvasId", args.canvasId).gte("createdAt", Date.now() - HOUR_MS),
      )
      .take(500);
    return rows.filter((m) => m.direction === "out" && m.state === "sent").length;
  },
});

export const insertRow = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    boardId: v.optional(v.id("boards")),
    runId: v.optional(v.id("runs")),
    fromAgentId: v.optional(v.id("agents")),
    toAgentId: v.optional(v.id("agents")),
    direction: vMailDirection,
    kind: vMailKind,
    subject: v.string(),
    preview: v.string(),
    state: vMailState,
    messageId: v.optional(v.string()),
  },
  returns: v.union(v.id("mail"), v.null()),
  handler: async (ctx, args) => {
    // The board may have been removed while the mail was in flight.
    if (args.boardId && !(await ctx.db.get(args.boardId))) return null;
    return await ctx.db.insert("mail", {
      ...args,
      subject: redact(args.subject, 200),
      preview: redact(args.preview, MAIL_PREVIEW_MAX),
      createdAt: Date.now(),
    });
  },
});

export const updateRow = internalMutation({
  args: {
    mailId: v.id("mail"),
    state: vMailState,
    preview: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.mailId);
    if (!row) return null;
    await ctx.db.patch(row._id, {
      state: args.state,
      ...(args.preview !== undefined ? { preview: redact(args.preview, MAIL_PREVIEW_MAX) } : {}),
      ...(args.messageId ? { messageId: args.messageId } : {}),
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Inbound (called by the AgentMail webhook after signature verification)
// ---------------------------------------------------------------------------

async function markHandoffReceived(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
  toAgentId: Id<"agents">,
  messageId: string,
  subject: string,
): Promise<boolean> {
  const byId = await ctx.db
    .query("mail")
    .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
    .first();
  let row: Doc<"mail"> | null = byId && byId.canvasId === canvasId ? byId : null;
  if (!row) {
    const recent = await ctx.db
      .query("mail")
      .withIndex("by_canvas_createdAt", (q) => q.eq("canvasId", canvasId))
      .order("desc")
      .take(50);
    const want = redact(subject, 200).trim().toLowerCase();
    row =
      recent.find(
        (m) =>
          m.direction === "out" &&
          m.state === "sent" &&
          m.toAgentId === toAgentId &&
          m.subject.trim().toLowerCase() === want,
      ) ?? null;
  }
  if (!row) return false;
  await ctx.db.patch(row._id, { state: "received" });
  return true;
}

/**
 * Which workspace an inbound message belongs to. The three inboxes are shared
 * by every workspace's leads, so the message itself has to say: the stamp we
 * put on what we sent (a header, or the "ref:" line a person replies under).
 * Failing that, the newest workspace, which is the one being worked in.
 */
async function canvasForInbound(
  ctx: MutationCtx,
  args: { workspace?: string; subject: string; text: string; inboxId: string },
): Promise<Id<"canvases"> | null> {
  const stamped = args.workspace ?? `${args.text}\n${args.subject}`.match(/ref:\s*([a-z0-9]{20,40})/i)?.[1];
  if (stamped) {
    const id = ctx.db.normalizeId("canvases", stamped.trim());
    if (id && (await ctx.db.get(id))) return id;
  }
  const holder = await ctx.db
    .query("agents")
    .withIndex("by_inbox", (q) => q.eq("inboxId", args.inboxId))
    .first();
  if (holder) return holder.canvasId;
  const newest = await ctx.db.query("canvases").order("desc").first();
  return newest?._id ?? null;
}

export const ingestInbound = internalMutation({
  args: {
    inboxId: v.string(),
    messageId: v.string(),
    from: v.optional(v.string()),
    subject: v.string(),
    text: v.string(),
    workspace: v.optional(v.string()),
  },
  returns: v.object({ action: v.string() }),
  handler: async (ctx, args) => {
    const canvasId = await canvasForInbound(ctx, args);
    if (!canvasId) return { action: "no workspace" };
    const here = await agentsOf(ctx, canvasId);
    const agent = here.find((a) => a.inboxId === args.inboxId) ?? here[0];
    if (!agent) return { action: "no agent for inbox" };

    const seen = await ctx.db
      .query("inboundSeen")
      .withIndex("by_canvas_messageId", (q) => q.eq("canvasId", canvasId).eq("messageId", args.messageId))
      .first();
    if (seen) return { action: "duplicate" };
    await ctx.db.insert("inboundSeen", { canvasId, messageId: args.messageId, createdAt: Date.now() });

    const agents = await agentsOf(ctx, canvasId);
    const sender = senderAddress(args.from);
    const teammate = agents.find((a) => a.inboxAddress && a.inboxAddress.toLowerCase() === sender);
    if (teammate) {
      const matched = await markHandoffReceived(ctx, canvasId, agent._id, args.messageId, args.subject);
      return { action: matched ? "handoff received" : "handoff received (no row)" };
    }

    // Human mail.
    if ((await runsLastHour(ctx, canvasId)) >= MAX_RUNS_PER_HOUR) {
      console.log("inbound ignored: hourly run limit reached");
      return { action: "ignored: run limit" };
    }
    const subject = args.subject.replace(/\s+/g, " ").trim();
    const urls = extractUrls(`${args.text}\n${subject}`, SUBMIT_URLS_MAX);
    let board: Doc<"boards"> | null = null;
    let action = "ignored: empty";

    if (urls.length > 0) {
      const boards = await boardsOf(ctx, canvasId);
      const lower = subject.toLowerCase();
      board =
        boards.find((b) => b.title.length >= 3 && lower.includes(b.title.toLowerCase())) ??
        boards.sort((a, b) => b.createdAt - a.createdAt)[0] ??
        null;
      if (!board) {
        board = await createBoard(ctx, {
          canvasId,
          title: cleanTitle(stripUrls(subject, 200), urlHost(urls[0]) || "links"),
          prompt: "",
          throwOnLimit: false,
        });
      }
      if (board) {
        const added = await insertLinkCards(ctx, board, urls, "email");
        action = `links: ${added} added`;
        if (added > 0 && !(await isBoardRunning(ctx, board))) {
          const res = await startRun(ctx, board, "email", { throwOnLimit: false });
          action += res.started ? ", run started" : ", run waits for the sweep";
        }
      } else {
        action = "ignored: board limit";
      }
    } else if (subject) {
      board = await createBoard(ctx, {
        canvasId,
        title: subject,
        prompt: subject,
        ...(isEmailAddress(sender) ? { replyTo: sender } : {}),
        throwOnLimit: false,
      });
      if (board) {
        const res = await startRun(ctx, board, "email", { throwOnLimit: false });
        action = res.started ? "new board, run started" : "new board, run waits";
      } else {
        action = "ignored: board limit";
      }
    }

    await ctx.db.insert("mail", {
      canvasId,
      ...(board ? { boardId: board._id } : {}),
      toAgentId: agent._id,
      direction: "in",
      kind: "human",
      subject: redact(subject || "(no subject)", 200),
      preview: redact(trimText(args.text, MAIL_PREVIEW_MAX * 2), MAIL_PREVIEW_MAX),
      state: "received",
      messageId: args.messageId,
      createdAt: Date.now(),
    });
    return { action };
  },
});
