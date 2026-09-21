"use node";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAIL_PER_HOUR } from "./lib/limits";
import { describeProviderError, mailClient } from "./lib/providers";
import { redactError } from "./lib/redact";
import { trimText } from "./lib/text";
import type { Skill } from "./lib/validators";
import type { CardBrief } from "./cards";
import type { RunContext } from "./runs";

const MAX_INBOXES = 3;
/**
 * Every outgoing message carries the workspace it belongs to. Three inboxes
 * serve every workspace, so this stamp — not the inbox — is what tells the
 * webhook which workspace a reply belongs to. Email keeps unknown headers,
 * so it survives the round trip between the leads.
 */
const WORKSPACE_HEADER = "X-SmallCircles-Workspace";

/** The same stamp in words, for mail a person may reply to. */
function refLine(canvasId: Id<"canvases">): string {
  return `\n—\nref: ${canvasId}\n`;
}

type AgentLite = { _id: Id<"agents">; name: string; skills: Skill[]; inboxId?: string; inboxAddress?: string };

function pick(agents: AgentLite[], skill: Skill): AgentLite | null {
  return agents.find((a) => a.skills.includes(skill)) ?? null;
}

type CardLine = { title: string; url: string | null; why: string | null };

function listing(cards: CardLine[], withWhy: boolean): string {
  if (cards.length === 0) return "(no cards)";
  return cards
    .map((c, i) => {
      const lines = [`${i + 1}. ${trimText(c.title, 120)}`];
      if (c.url) lines.push(`   ${c.url}`);
      if (withWhy && c.why) lines.push(`   why: ${trimText(c.why, 120)}`);
      return lines.join("\n");
    })
    .join("\n");
}

/**
 * Agent-to-agent handoff by email (Finder -> Reader, Reader -> Sorter,
 * Sorter -> Finder for "need more"). Recorded as a mail row and a mail task.
 * Skipped when an inbox is missing or the hourly mail limit is reached.
 * Never throws: a handoff must not block the run.
 */
export async function handoff(
  ctx: ActionCtx,
  args: { runId: Id<"runs">; fromSkill: Skill; toSkill: Skill; kind: "handoff" | "need_more"; round: number },
): Promise<void> {
  try {
    await sendHandoff(ctx, args);
  } catch (err) {
    console.warn("handoff error:", redactError(err));
  }
}

async function sendHandoff(
  ctx: ActionCtx,
  args: { runId: Id<"runs">; fromSkill: Skill; toSkill: Skill; kind: "handoff" | "need_more"; round: number },
): Promise<void> {
  const run: RunContext | null = await ctx.runQuery(internal.runs.getContext, { runId: args.runId });
  if (!run || run.stage === "done" || run.stage === "failed") return;
  const from = pick(run.agents, args.fromSkill);
  const to = pick(run.agents, args.toSkill);
  if (!from || !to) return;

  const cards: CardBrief[] =
    args.fromSkill === "search"
      ? await ctx.runQuery(internal.cards.listForBoard, { boardId: run.boardId, status: "new", limit: 12 })
      : await ctx.runQuery(internal.cards.listForBoard, {
          boardId: run.boardId,
          status: "ready",
          keptOnly: args.kind === "need_more",
          limit: 12,
        });
  const n = cards.length;
  const board = trimText(run.title, 60);
  const subject =
    args.kind === "need_more"
      ? `[${board}] ${from.name} to ${to.name}: need more like these (${n} kept)`
      : `[${board}] ${from.name} to ${to.name}: ${n} card${n === 1 ? "" : "s"}`;
  const intro =
    args.kind === "need_more"
      ? `Only ${n} kept so far for "${trimText(run.prompt || run.title, 120)}". Please find more like these:`
      : args.fromSkill === "search"
        ? `Found ${n} new page${n === 1 ? "" : "s"} for "${trimText(run.prompt || run.title, 120)}". Please read them:`
        : `Read ${n} page${n === 1 ? "" : "s"}. Please sort them:`;
  const text = `${intro}\n\n${listing(cards, args.kind === "need_more")}\n\n${from.name}\n`;
  const preview = `${intro} ${cards.map((c) => c.title).join("; ")}`;
  const label = `Emailing ${to.name}`;
  const row = {
    canvasId: run.canvasId,
    boardId: run.boardId,
    runId: run.runId,
    fromAgentId: from._id,
    toAgentId: to._id,
    direction: "out" as const,
    kind: args.kind,
    subject,
    preview,
  };

  let skip = "";
  if (!from.inboxId || !to.inboxAddress) skip = "no inbox yet";
  else if ((await ctx.runQuery(internal.mail.sentLastHour, { canvasId: run.canvasId })) >= MAIL_PER_HOUR) {
    skip = `${MAIL_PER_HOUR} emails this hour`;
  }
  if (skip || !from.inboxId || !to.inboxAddress) {
    await ctx.runMutation(internal.mail.insertRow, { ...row, state: "skipped" });
    await ctx.runMutation(internal.tasks.record, {
      runId: run.runId,
      agentId: from._id,
      tool: "mail",
      label,
      state: "skipped",
      note: `Skipped: ${skip}`,
    });
    return;
  }

  const taskId = await ctx.runMutation(internal.tasks.begin, {
    runId: run.runId,
    agentId: from._id,
    tool: "mail",
    label,
  });
  try {
    const sent = await mailClient().inboxes.messages.send(
      from.inboxId,
      { to: [to.inboxAddress], subject, text, headers: { [WORKSPACE_HEADER]: run.canvasId } },
      { idempotencyKey: `handoff-${args.runId}-${args.fromSkill}-${args.toSkill}-${args.round}` },
    );
    await ctx.runMutation(internal.mail.insertRow, {
      ...row,
      state: "sent",
      ...(sent?.messageId ? { messageId: String(sent.messageId) } : {}),
    });
    await ctx.runMutation(internal.tasks.end, { taskId, state: "done", note: `${n} card${n === 1 ? "" : "s"}` });
  } catch (err) {
    const note = describeProviderError(err);
    console.warn("handoff send failed:", note);
    await ctx.runMutation(internal.mail.insertRow, { ...row, state: "failed" });
    await ctx.runMutation(internal.tasks.end, { taskId, state: "failed", note });
  }
}

/** Sorter's inbox sends a board's kept cards (title, url, why). Never throws. */
export const digest = internalAction({
  args: { boardId: v.id("boards"), to: v.string(), mailId: v.optional(v.id("mail")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const board: { canvasId: Id<"canvases">; title: string; prompt: string } | null = await ctx.runQuery(internal.boards.getForMail, { boardId: args.boardId });
    if (!board) {
      if (args.mailId) await ctx.runMutation(internal.mail.updateRow, { mailId: args.mailId, state: "failed", preview: "Board was removed." });
      return null;
    }
    const agents: AgentLite[] = await ctx.runQuery(internal.agents.listWithInboxes, { canvasId: board.canvasId });
    const sorter = pick(agents, "sort");
    const kept: CardBrief[] = await ctx.runQuery(internal.cards.listForBoard, {
      boardId: args.boardId,
      status: "ready",
      keptOnly: true,
      limit: 30,
    });
    const n = kept.length;
    const subject = trimText(`${board.title}: ${n} kept card${n === 1 ? "" : "s"}`, 200);
    const preview = n ? `${n} kept: ${kept.map((c) => c.title).join("; ")}` : "Nothing kept yet.";
    const text =
      `${n ? `Kept for "${trimText(board.prompt || board.title, 120)}":` : `Nothing is kept on "${trimText(board.title, 60)}" yet.`}\n\n` +
      (n ? listing(kept, true) : "") +
      `\n\n${sorter?.name ?? "Sorter"}\n` +
      refLine(board.canvasId);

    const record = async (state: "sent" | "failed", messageId?: string, note?: string) => {
      const p = note ?? preview;
      if (args.mailId) {
        await ctx.runMutation(internal.mail.updateRow, { mailId: args.mailId, state, preview: p, ...(messageId ? { messageId } : {}) });
      } else {
        await ctx.runMutation(internal.mail.insertRow, {
          canvasId: board.canvasId,
          boardId: args.boardId,
          ...(sorter ? { fromAgentId: sorter._id } : {}),
          direction: "out",
          kind: "digest",
          subject,
          preview: p,
          state,
          ...(messageId ? { messageId } : {}),
        });
      }
    };

    if (!sorter?.inboxId) {
      await record("failed", undefined, "Sorter has no inbox.");
      return null;
    }
    try {
      const sent = await mailClient().inboxes.messages.send(
        sorter.inboxId,
        { to: [args.to], subject, text, headers: { [WORKSPACE_HEADER]: board.canvasId } },
        { idempotencyKey: `digest-${args.mailId ?? `${args.boardId}-${Math.floor(Date.now() / 600_000)}`}` },
      );
      await record("sent", sent?.messageId ? String(sent.messageId) : undefined);
    } catch (err) {
      const note = describeProviderError(err);
      console.warn("digest send failed:", note);
      await record("failed", undefined, "Send failed.");
    }
    return null;
  },
});

/**
 * Give every lead on a canvas an inbox, with three inboxes for the whole
 * account: one for the Finder, one for the Reader, one for the Sorter. Every
 * workspace's leads share those three by role, so a new workspace is on mail
 * from its first run. Inbound mail is routed by the workspace stamped on the
 * message (see the header below), never by who holds the inbox.
 */
export const ensureInboxes = internalAction({
  args: { canvasId: v.id("canvases") },
  returns: v.object({ assigned: v.number(), missing: v.number() }),
  handler: async (ctx, args): Promise<{ assigned: number; missing: number }> => {
    const agents: AgentLite[] = await ctx.runQuery(internal.agents.listWithInboxes, { canvasId: args.canvasId });
    const client = mailClient();
    let assigned = 0;
    const rename = async (inboxId: string, name: string) => {
      try {
        await client.inboxes.update(inboxId, { displayName: name });
      } catch {
        /* display name is cosmetic */
      }
    };

    const stillPending = agents.filter((a) => !a.inboxId);
    if (stillPending.length === 0) return { assigned, missing: 0 };

    let listed: { inboxId: string; email: string; displayName?: string }[] = [];
    try {
      const res = await client.inboxes.list({ limit: 50 });
      listed = (res.inboxes ?? []).map((i) => ({
        inboxId: String(i.inboxId),
        email: String(i.email),
        ...(i.displayName ? { displayName: String(i.displayName) } : {}),
      }));
    } catch (err) {
      console.error("inbox list failed:", describeProviderError(err));
      return { assigned, missing: stillPending.length };
    }
    // The inbox for a role: the one already named after that lead, else the
    // one in the account's own order, so every workspace lands on the same
    // three addresses.
    const ROLES: Skill[] = ["search", "browse", "sort"];
    const roleOf = (a: AgentLite) => ROLES.find((r) => a.skills.includes(r));
    const byName = (name: string) => listed.find((i) => (i.displayName ?? "").toLowerCase() === name.toLowerCase());

    let total = listed.length;
    let missing = 0;
    for (const agent of stillPending) {
      const role = roleOf(agent);
      const slot = role ? ROLES.indexOf(role) : -1;
      let inbox = byName(agent.name) ?? (slot >= 0 ? listed[slot] : undefined);

      if (!inbox && total < MAX_INBOXES) {
        try {
          const created = await client.inboxes.create({ displayName: agent.name });
          total++;
          inbox = { inboxId: String(created.inboxId), email: String(created.email), displayName: agent.name };
          listed.push(inbox);
        } catch (err) {
          console.error("inbox create failed:", describeProviderError(err));
        }
      }

      const done = inbox
        ? await ctx.runMutation(internal.agents.setInbox, { agentId: agent._id, inboxId: inbox.inboxId, inboxAddress: inbox.email })
        : false;
      if (done && inbox && (inbox.displayName ?? "") !== agent.name) {
        await rename(inbox.inboxId, agent.name);
        inbox.displayName = agent.name;
      }
      if (done) assigned++;
      else {
        missing++;
        await ctx.runMutation(internal.agents.setError, { agentId: agent._id, statusText: "no inbox" });
      }
    }
    return { assigned, missing };
  },
});

/**
 * One-time setup per deployment: register the Convex webhook URL with
 * AgentMail. Idempotent: an existing webhook for the same URL is reused.
 * Run: npx convex run agentmail:registerWebhook '{"url":"https://<deployment>.convex.site/agentmail/webhook"}'
 */
export const registerWebhook = internalAction({
  args: { url: v.string() },
  returns: v.object({ webhookId: v.string(), secret: v.string(), reused: v.boolean() }),
  handler: async (_ctx, { url }) => {
    if (!/^https:\/\/.+\/agentmail\/webhook$/.test(url)) {
      throw new Error("url must be https://<deployment>.convex.site/agentmail/webhook");
    }
    const client = mailClient();
    const existing = await client.webhooks.list({ limit: 50 });
    const match = existing.webhooks?.find((w) => w.url === url);
    if (match) return { webhookId: match.webhookId, secret: match.secret, reused: true };
    const hook = await client.webhooks.create({ url, eventTypes: ["message.received"] });
    return { webhookId: hook.webhookId, secret: hook.secret, reused: false };
  },
});
