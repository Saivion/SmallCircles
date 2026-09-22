"use node";
/**
 * The Circle Agent. It never runs on a loop: an event wakes it, it looks at the
 * circle, and it does one of four things:
 *
 *   DO NOTHING        (the default, and the most common outcome)
 *   ADD CONTEXT       (the drawing pipeline in moments/draw.ts does this as a circle is made)
 *   CREATE CONNECTION (two people's moments crossed paths)
 *   NOTIFY A HUMAN    (only when someone genuinely benefits from knowing)
 *
 * Every action outside the circle passes the meaning gate first: why, who
 * benefits, what changes, and does it need an email or can the circle itself
 * show it? Hard rules come before the model and can only say no.
 *
 * It never emails another agent, never emails itself, never answers an email
 * with an email, and never tells anyone the same thing twice.
 */
import { generateObject } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { CONNECTION_THRESHOLD } from "../lib/match";
import { createHash } from "node:crypto";
import { describeProviderError, FAST, getModel, mailClient, withTimeout } from "../lib/providers";
import { redactError } from "../lib/redact";

/** New contributions wait this long, so several become one email instead of many. */
const BATCH_MS = 3 * 60 * 1000;
/** Without the gate's say-so (the model is down), only a match this strong is connected, and quietly. */
const CONNECT_WITHOUT_GATE = 0.7;
const GATE_TIMEOUT_MS = 25_000;

type Event = { _id: Id<"agentEvents">; circleId: Id<"circles">; type: string; key: string; depth: number; ref: string | null; quiet: boolean };

export const evaluate = internalAction({
  args: { eventId: v.id("agentEvents") },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    const e = await ctx.runQuery(internal.agent.store.event, { eventId });
    if (!e || e.processed) return null;
    // Claimed once: a retried or duplicated run finds it taken and stops here.
    if (!(await ctx.runMutation(internal.agent.store.claimEvent, { eventId }))) return null;
    let result: string;
    try {
      if (e.type === "circle_created" || e.type === "circle_updated") result = await lookForConnections(ctx, e);
      else if (e.type === "contribution_added") result = await onContribution(ctx, e);
      else if (e.type === "circle_grew") result = await onGrew(ctx, e);
      else result = "nothing: nothing to do for this kind of event";
    } catch (err) {
      result = `nothing: stopped safely (${redactError(err).slice(0, 120)})`;
    }
    await ctx.runMutation(internal.agent.store.finishEvent, { eventId, result });
    return null;
  },
});

// ---------------------------------------------------------------------------
// The meaning gate
// ---------------------------------------------------------------------------

const Gate = z.object({
  why: z.string().describe("Why this action matters, in one sentence. If it doesn't, say so."),
  whoBenefits: z.string().describe("Which human benefits from it, and how. 'nobody' is a valid answer."),
  whatChanges: z.string().describe("What becomes different for them or their moment."),
  proceed: z.boolean().describe("True only if the action adds real meaning. The default is false: silence is a good outcome."),
  emailNecessary: z
    .boolean()
    .describe("True only if this person would genuinely want an email about it now, rather than just seeing it next time they open Small Circles."),
  line: z
    .string()
    .describe(
      "If proceeding: one specific, warm sentence to the person being told, stating the actual fact (the place, the landmark, the day, what was added). Lowercase, under 140 characters, no exclamation marks. Never mention agents, AI, searching, checking, processing or 'something interesting'. Empty if not proceeding.",
    ),
  shared: z
    .string()
    .describe(
      "For a connection only: the same fact as one neutral sentence both people will see on their own moment, so no 'you' or 'your' ('both taken at dōgenzaka 2, months apart'). Lowercase, under 100 characters. Empty otherwise.",
    ),
});
type GateT = z.infer<typeof Gate>;

/** Anything that sounds like a bot talking about itself never reaches a person. */
const HOLLOW = /\b(agent|agents|ai|i found|we found something|interesting|processing|checking|hello|hi there|would you like|potential connection|as an)\b/i;

function cleanLine(line: string, fallback: string): string {
  const l = line.replace(/\s+/g, " ").trim().replace(/!+/g, ".");
  return l && l.length <= 160 && !HOLLOW.test(l) ? l : fallback;
}

async function gate(action: string, facts: string): Promise<GateT | null> {
  try {
    const { object } = await withTimeout(
      generateObject({
        model: getModel(),
        schema: Gate,
        providerOptions: FAST,
        prompt:
          "You decide whether Small Circles should act. Small Circles lets people share small moments (a photo each) and quietly " +
          "finds meaningful connections between them. Acting costs people's attention, so the default is to do nothing, " +
          "and silence is a good outcome.\n\n" +
          "Worth acting on (and worth an email to the person it's about, who may not be looking at the app):\n" +
          "- their moment genuinely crossed paths with another person's: the same place, landmark or spot, even on a different day;\n" +
          "- other people added real words or photos to their moment (a memory, a note, a photo), especially several at once;\n" +
          "- something concrete and new was learned about the place in their photo.\n" +
          "Not worth it: weak or generic links (the same big city, both 'food', a similar mood), a single small reaction, " +
          "anything they already know, or anything said just to show activity. Never email for those.\n\n" +
          `The proposed action: ${action}\n\n${facts}`,
      }),
      GATE_TIMEOUT_MS,
      "the meaning gate",
    );
    return object;
  } catch (err) {
    console.warn("meaning gate unavailable:", redactError(err));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Circle created: look for other people's moments it crossed paths with
// ---------------------------------------------------------------------------

type Facts = { circleId: Id<"circles">; title: string; reading: string | null; place: string | null; when: string | null; things: string[]; author: string | null; createdAt: number };

function describe(f: Facts, who: string): string {
  return [
    `${who}: "${f.title}"${f.author ? ` shared by ${f.author}` : ""}`,
    f.reading ? `  what's in it: ${f.reading}` : null,
    f.place ? `  where: ${f.place}` : null,
    f.when ? `  when: ${f.when}` : null,
    f.things.length ? `  drawn around it: ${f.things.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function lookForConnections(ctx: ActionCtx, e: Event): Promise<string> {
  const found = await ctx.runQuery(internal.agent.store.candidates, { circleId: e.circleId });
  if (!found) return "nothing: not out in the world yet";
  if (found.matches.length === 0) return "nothing: no other person's moment is close enough to this one";

  const outcomes: string[] = [];
  for (const m of found.matches) {
    if (m.alreadyConnected) {
      outcomes.push(`already connected to "${m.other.title}"`);
      continue;
    }
    if (m.score < CONNECTION_THRESHOLD) {
      outcomes.push(`"${m.other.title}" scored ${m.score} (${m.signals.join(", ")}): below the bar, left alone`);
      continue;
    }
    // The person who already had their moment out there is the one who might want to hear;
    // whoever just shared this one is on the page and sees it there.
    const earlier = m.other.createdAt <= found.self.createdAt ? m.other : found.self;
    const later = earlier === m.other ? found.self : m.other;
    const g = await gate(
      `connect two people's moments (confidence ${m.score}: ${m.signals.join(", ")}), and decide whether to email the person who shared "${earlier.title}" about it`,
      `${describe(earlier, "their moment (the one who'd be emailed)")}\n${describe(later, "the other person's moment")}\n\nThe plain facts: ${m.reason}.`,
    );
    const proceed = g ? g.proceed : m.score >= CONNECT_WITHOUT_GATE;
    if (!proceed) {
      outcomes.push(`declined "${m.other.title}"${g ? `: ${g.why}` : ""}`);
      continue;
    }
    // What both circles show is neutral; what the email says is to its reader.
    const reason = cleanLine(g?.shared ?? "", m.reason).replace(/\byour?\b/gi, "").replace(/\s+/g, " ").trim() || m.reason;
    const toThem = cleanLine(g?.line ?? "", reason);
    const connectionId = await ctx.runMutation(internal.agent.store.connect, {
      circleId: found.self.circleId,
      otherId: m.other.circleId,
      type: m.type,
      reason,
      confidence: m.score,
      signals: m.signals,
    });
    if (!connectionId) {
      outcomes.push(`already connected to "${m.other.title}"`);
      continue;
    }
    let told = "no email";
    if (e.quiet) told = "no email (a quiet look)";
    else if (!g) told = "no email (the gate couldn't be asked, so nobody is interrupted)";
    else if (!g.emailNecessary) told = `no email: ${g.whoBenefits}`;
    else told = await tellAboutConnection(ctx, { connectionId, recipientCircle: earlier, otherCircle: later, line: toThem, why: g.why });
    outcomes.push(`connected to "${m.other.title}" (${m.type}, ${m.score}); ${told}`);
  }
  return outcomes.some((o) => o.startsWith("connected")) ? `connected: ${outcomes.join(" | ")}` : `nothing: ${outcomes.join(" | ")}`;
}

// ---------------------------------------------------------------------------
// Contributions: never one email per reaction; wait, then decide once
// ---------------------------------------------------------------------------

async function onContribution(ctx: ActionCtx, e: Event): Promise<string> {
  const k = e.ref ? await ctx.runQuery(internal.agent.store.contribution, { contributionId: e.ref }) : null;
  if (!k) return "nothing: it's gone";
  if (k.byOwner) return "nothing: the owner's own words don't need telling to the owner";
  const window = Math.floor(Date.now() / BATCH_MS);
  const scheduled = await ctx.runMutation(internal.agent.store.emitFollowUp, {
    circleId: e.circleId,
    type: "circle_grew",
    key: `grew:${e.circleId}:${window}`,
    depth: e.depth + 1,
    delayMs: BATCH_MS,
  });
  return scheduled ? `waiting: batched with anything else added in the next ${BATCH_MS / 60000} minutes` : "waiting: already batched with what came just before";
}

const WORD: Record<string, string> = { memory: "a memory", photo: "a photo", note: "a note", reaction: "a reaction" };

async function onGrew(ctx: ActionCtx, e: Event): Promise<string> {
  const d = await ctx.runQuery(internal.agent.store.digest, { circleId: e.circleId });
  if (!d || d.items.length === 0) return "nothing: nothing new from other people";
  const words = d.items.filter((i) => i.type !== "reaction");
  const reactions = d.items.length - words.length;
  // A reaction or two is exactly what the circle is for showing; it isn't news.
  if (words.length === 0 && reactions < 3) return `nothing: ${reactions} reaction${reactions === 1 ? "" : "s"}, shown on the circle`;
  const people = new Set(d.items.map((i) => i.by)).size;
  const list = d.items.map((i) => `- ${WORD[i.type] ?? i.type} from ${i.by}${i.text ? `: "${i.text}"` : ` (${i.label})`}`).join("\n");
  const g = await gate(
    `email the person who shared "${d.title}" that their moment grew`,
    `Added to "${d.title}" since they last heard from us, by ${people} ${people === 1 ? "person" : "people"}:\n${list}`,
  );
  if (!g) return "nothing: the gate couldn't be asked, so nobody is interrupted";
  if (!g.proceed || !g.emailNecessary) return `nothing: ${g.why}`;
  const who = await ctx.runQuery(internal.agent.store.owner, { circleId: e.circleId });
  if (!who) return "nothing: no one to tell";
  const line = cleanLine(g.line, people > 1 ? `${people} people added something to your moment.` : `someone added ${WORD[words[0]?.type ?? "note"] ?? "something"} to your moment.`);
  const told = await notify(ctx, {
    circleId: e.circleId,
    owner: who.owner,
    type: "grew",
    dedupeKey: e.key,
    why: g.why,
    subject: people > 1 ? `${people} people added to your moment` : "your circle grew",
    lead: line,
    items: d.items.map((i) => `${WORD[i.type] ?? i.type} from ${i.by}${i.text ? `: “${i.text}”` : ""}`),
    title: d.title,
  });
  if (told.startsWith("emailed")) await ctx.runMutation(internal.agent.store.markGrewNotified, { circleId: e.circleId, at: Date.now() });
  return told.startsWith("emailed") ? `notified: ${told}` : `nothing: ${told}`;
}

// ---------------------------------------------------------------------------
// Telling a human (AgentMail: the bridge to people, never to other agents)
// ---------------------------------------------------------------------------

async function tellAboutConnection(
  ctx: ActionCtx,
  a: { connectionId: Id<"circleConnections">; recipientCircle: Facts; otherCircle: Facts; line: string; why: string },
): Promise<string> {
  const who = await ctx.runQuery(internal.agent.store.owner, { circleId: a.recipientCircle.circleId });
  if (!who) return "no one to tell";
  return await notify(ctx, {
    circleId: a.recipientCircle.circleId,
    owner: who.owner,
    type: "connection",
    dedupeKey: `connection:${a.connectionId}:${a.recipientCircle.circleId}`,
    why: a.why,
    subject: "your moment crossed paths with someone else's",
    lead: a.line,
    items: [`your moment: ${a.recipientCircle.title}`, `theirs: ${a.otherCircle.title}${a.otherCircle.author ? `, shared by ${a.otherCircle.author}` : ""}`],
    title: a.recipientCircle.title,
  });
}

function siteUrl(): string {
  return (process.env.SITE_URL ?? process.env.CONVEX_SITE_URL ?? "").replace(/\/$/, "");
}

function ourAddress(email: string): boolean {
  const e = email.toLowerCase();
  const own = (process.env.MOMENTS_INBOX_ADDRESS ?? "").toLowerCase();
  return e === own || e.endsWith("@agentmail.to");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

async function notify(
  ctx: ActionCtx,
  n: {
    circleId: Id<"circles">;
    owner: { canvasId: Id<"canvases">; slug: string; email: string | null; house: boolean };
    type: "connection" | "grew";
    dedupeKey: string;
    why: string;
    subject: string;
    lead: string;
    items: string[];
    title: string;
  },
): Promise<string> {
  // Hard rules: a person, with an address, that isn't us.
  if (n.owner.house) return "a starter moment: nobody to tell";
  if (!n.owner.email) return "shown in the app (they haven't given an email address)";
  if (ourAddress(n.owner.email)) return "never emails Small Circles itself";
  const inbox = process.env.MOMENTS_INBOX_ADDRESS ?? process.env.AGENTMAIL_INBOX_ID;
  if (!inbox) return "shown in the app (no inbox configured)";

  const claim = await ctx.runMutation(internal.agent.store.claimNotification, {
    circleId: n.circleId,
    recipientId: n.owner.canvasId,
    to: n.owner.email,
    type: n.type,
    reason: n.why,
    dedupeKey: n.dedupeKey,
    subject: n.subject,
  });
  if ("skipped" in claim) return `not emailed: ${claim.skipped}`;

  const link = `${siteUrl()}/?w=${encodeURIComponent(n.owner.slug)}&c=${encodeURIComponent(n.circleId)}`;
  const cta = n.type === "connection" ? "see the connection" : "see what it became";
  const text =
    `${n.lead}\n\n` +
    n.items.map((i) => `· ${i}`).join("\n") +
    `\n\n${cta}: ${link}\n\n` +
    `reply to this email with a memory or a photo, and it's added to "${n.title}".`;
  const html =
    `<div style="font-family:Georgia,serif;color:#1f1c18;background:#f3ede2;padding:26px">` +
    `<p style="margin:0 0 6px;font:12px monospace;letter-spacing:.08em;text-transform:uppercase;color:#6d665c">small circles</p>` +
    `<p style="font-size:24px;font-style:italic;line-height:1.2;margin:0">${esc(n.lead)}</p>` +
    `<ul style="margin:16px 0 0;padding:0 0 0 18px;font-size:15px;line-height:1.6">${n.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` +
    `<p style="margin:22px 0 0"><a href="${esc(link)}" style="background:#1f1c18;color:#f3ede2;padding:10px 18px;border-radius:999px;text-decoration:none;font-family:sans-serif;font-size:14px">${cta}</a></p>` +
    `<p style="margin:18px 0 0;font-size:13px;color:#6d665c">reply to this email with a memory or a photo, and it's added to “${esc(n.title)}”.</p></div>`;

  try {
    // The dedupe key doubles as AgentMail's idempotency key: even a retried send can't go out twice.
    const idempotencyKey = createHash("sha256").update(n.dedupeKey).digest("hex").slice(0, 32);
    const sent = await mailClient().inboxes.messages.send(inbox, { to: [n.owner.email], subject: n.subject, text, html }, { idempotencyKey });
    await ctx.runMutation(internal.agent.store.markNotification, { id: claim.id, status: "sent", threadId: sent.threadId, messageId: sent.messageId });
    return `emailed ${n.type === "connection" ? "about the connection" : "that it grew"}`;
  } catch (err) {
    const why = describeProviderError(err);
    await ctx.runMutation(internal.agent.store.markNotification, { id: claim.id, status: "failed", error: why });
    return `the email failed (${why.slice(0, 120)})`;
  }
}
