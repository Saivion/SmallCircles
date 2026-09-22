/**
 * The Circle Agent's state: what woke it, what it connected, what it told people.
 *
 * Every write here is idempotent:
 *   - an event exists once per key, and is processed once;
 *   - a connection exists once per pair of circles, whichever side found it;
 *   - a notification exists once per dedupe key, and a person hears at most
 *     MAX_EMAILS_PER_DAY from us.
 * Events the agent causes carry depth + 1, and nothing deeper than MAX_DEPTH
 * is ever recorded, so the agent can't wake itself in a loop.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { vAgentEventType, vConnectionType, vNotificationType } from "../lib/circleFields";
import { LANDMARK_DRAWINGS, match, neighbourCells, normalise, type MatchProfile } from "../lib/match";

export const MAX_DEPTH = 2;
const MAX_EMAILS_PER_DAY = 5;
const DAY = 24 * 60 * 60 * 1000;
/** How far the agent looks for related moments, per index. */
const CANDIDATES_PER_INDEX = 60;
/** Matches this strong are worth the meaning gate's time; below it the answer is silence. */
const CONSIDER_FROM = 0.35;

type EventType = Doc<"agentEvents">["type"];

/**
 * Record that something happened to a circle and wake its agent. Returns the
 * event id, or null when this exact event already exists or would go too deep.
 */
export async function emitEvent(
  ctx: MutationCtx,
  e: { circleId: Id<"circles">; type: EventType; key: string; depth?: number; ref?: string; quiet?: boolean; delayMs?: number },
): Promise<Id<"agentEvents"> | null> {
  const depth = e.depth ?? 0;
  if (depth > MAX_DEPTH) return null;
  const seen = await ctx.db
    .query("agentEvents")
    .withIndex("by_key", (q) => q.eq("key", e.key))
    .first();
  if (seen) return null;
  const id = await ctx.db.insert("agentEvents", {
    circleId: e.circleId,
    type: e.type,
    key: e.key,
    depth,
    ...(e.ref ? { ref: e.ref } : {}),
    ...(e.quiet ? { quiet: true } : {}),
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(e.delayMs ?? 0, internal.agent.run.evaluate, { eventId: id });
  return id;
}

/** A circle is drawn and out in the world: the first time that's true, its agent looks around. */
export async function emitCircleReady(ctx: MutationCtx, c: Doc<"circles">) {
  if (c.released !== true || c.hour === undefined) return;
  const created = await emitEvent(ctx, { circleId: c._id, type: "circle_created", key: `created:${c._id}` });
  // Drawn again later (a redraw): look again, but connections found this way email nobody.
  if (!created && c.finishedAt) {
    await emitEvent(ctx, { circleId: c._id, type: "circle_updated", key: `updated:${c._id}:${c.finishedAt}`, quiet: true });
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const event = internalQuery({
  args: { eventId: v.id("agentEvents") },
  returns: v.union(
    v.object({
      _id: v.id("agentEvents"),
      circleId: v.id("circles"),
      type: vAgentEventType,
      key: v.string(),
      depth: v.number(),
      ref: v.union(v.string(), v.null()),
      quiet: v.boolean(),
      processed: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, { eventId }) => {
    const e = await ctx.db.get(eventId);
    if (!e) return null;
    return { _id: e._id, circleId: e.circleId, type: e.type, key: e.key, depth: e.depth, ref: e.ref ?? null, quiet: e.quiet === true, processed: e.processedAt !== undefined };
  },
});

/** Claim an event for processing: true the first time only, so a retry can't act twice. */
export const claimEvent = internalMutation({
  args: { eventId: v.id("agentEvents") },
  returns: v.boolean(),
  handler: async (ctx, { eventId }) => {
    const e = await ctx.db.get(eventId);
    if (!e || e.processedAt !== undefined) return false;
    await ctx.db.patch(eventId, { processedAt: Date.now(), result: "working" });
    return true;
  },
});

export const finishEvent = internalMutation({
  args: { eventId: v.id("agentEvents"), result: v.string() },
  returns: v.null(),
  handler: async (ctx, { eventId, result }) => {
    await ctx.db.patch(eventId, { result: result.slice(0, 500) });
    return null;
  },
});

/** Let the agent schedule the one follow-up it's allowed: a batch window for new contributions. */
export const emitFollowUp = internalMutation({
  args: { circleId: v.id("circles"), type: vAgentEventType, key: v.string(), depth: v.number(), delayMs: v.number() },
  returns: v.boolean(),
  handler: async (ctx, a) => (await emitEvent(ctx, { circleId: a.circleId, type: a.type, key: a.key, depth: a.depth, delayMs: a.delayMs })) !== null,
});

// ---------------------------------------------------------------------------
// Finding related moments
// ---------------------------------------------------------------------------

async function profileOf(ctx: QueryCtx, c: Doc<"circles">): Promise<MatchProfile> {
  const els = await ctx.db
    .query("circleElements")
    .withIndex("by_circle", (q) => q.eq("circleId", c._id))
    .take(12);
  const landmarks = new Set<string>();
  const things = new Set<string>();
  for (const e of els) {
    const label = normalise(e.label);
    if (!label) continue;
    if (e.kind === "subject" || e.kind === "discovered") things.add(label);
    if (LANDMARK_DRAWINGS.has(e.illustration) && e.kind !== "time" && e.kind !== "weather") landmarks.add(label);
    if (e.kind === "discovered" && e.source?.url) landmarks.add(`src:${e.source.url.replace(/[?#].*$/, "").toLowerCase()}`);
  }
  if (c.spotKey) landmarks.add(c.spotKey);
  return {
    gps: c.gps ?? null,
    spotKey: c.spotKey ?? null,
    hoodKey: c.hoodKey ?? null,
    cityKey: c.cityKey ?? null,
    takenAt: c.metadata.takenAt ?? null,
    kind: c.context.kind ?? null,
    landmarks: [...landmarks],
    things: [...things],
    spot: c.context.place?.spot ?? null,
    hood: c.context.place?.neighbourhood ?? null,
    city: c.context.place?.city ?? c.context.place?.name ?? null,
  };
}

const vFacts = v.object({
  circleId: v.id("circles"),
  title: v.string(),
  reading: v.union(v.string(), v.null()),
  place: v.union(v.string(), v.null()),
  when: v.union(v.string(), v.null()),
  things: v.array(v.string()),
  author: v.union(v.string(), v.null()),
  createdAt: v.number(),
});

function factsOf(c: Doc<"circles">, p: MatchProfile) {
  const pl = c.context.place;
  return {
    circleId: c._id,
    title: c.title,
    reading: c.context.reading ?? null,
    place: pl ? [pl.spot, pl.neighbourhood, pl.city ?? pl.name, pl.country].filter(Boolean).join(", ") : null,
    when: c.dateLabel ?? null,
    things: p.things.slice(0, 6),
    author: c.author ?? null,
    createdAt: c.createdAt,
  };
}

/**
 * Other people's moments that may relate to this one, strongest first. Looks
 * only where a relation could be (the same GPS cells, spot or city), scores
 * each on structured context, and returns only what's worth a second look.
 */
export const candidates = internalQuery({
  args: { circleId: v.id("circles") },
  returns: v.union(
    v.object({
      self: vFacts,
      matches: v.array(
        v.object({ other: vFacts, score: v.number(), type: vConnectionType, signals: v.array(v.string()), reason: v.string(), alreadyConnected: v.boolean() }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, { circleId }) => {
    const c = await ctx.db.get(circleId);
    if (!c || c.released !== true || c.status !== "done") return null;
    const pool = new Map<Id<"circles">, Doc<"circles">>();
    const add = (rows: Doc<"circles">[]) => rows.forEach((r) => pool.set(r._id, r));
    if (c.geoCell) {
      for (const cell of neighbourCells(c.geoCell)) {
        add(await ctx.db.query("circles").withIndex("by_geoCell", (q) => q.eq("geoCell", cell)).take(CANDIDATES_PER_INDEX));
      }
    }
    if (c.spotKey) add(await ctx.db.query("circles").withIndex("by_spotKey", (q) => q.eq("spotKey", c.spotKey)).take(CANDIDATES_PER_INDEX));
    if (c.cityKey) add(await ctx.db.query("circles").withIndex("by_cityKey", (q) => q.eq("cityKey", c.cityKey)).take(CANDIDATES_PER_INDEX));

    const me = await profileOf(ctx, c);
    const out = [];
    for (const o of pool.values()) {
      // Another person's moment, out in the world, finished. Never your own, never a house starter.
      if (o._id === c._id || o.canvasId === c.canvasId || o.released !== true || o.status !== "done" || o.seeded || c.seeded) continue;
      const them = await profileOf(ctx, o);
      const m = match(me, them);
      if (m.score < CONSIDER_FROM) continue;
      const pairKey = [c._id, o._id].sort().join(":");
      const existing = await ctx.db
        .query("circleConnections")
        .withIndex("by_pair", (q) => q.eq("pairKey", pairKey))
        .first();
      out.push({ other: factsOf(o, them), score: m.score, type: m.type, signals: m.signals, reason: m.reason, alreadyConnected: existing !== null });
    }
    out.sort((a, b) => b.score - a.score);
    return { self: factsOf(c, me), matches: out.slice(0, 3) };
  },
});

/** Make the connection. Once per pair, ever; both circles learn they've crossed paths. */
export const connect = internalMutation({
  args: {
    circleId: v.id("circles"),
    otherId: v.id("circles"),
    type: vConnectionType,
    reason: v.string(),
    confidence: v.number(),
    signals: v.array(v.string()),
  },
  returns: v.union(v.id("circleConnections"), v.null()),
  handler: async (ctx, a) => {
    const [x, y] = await Promise.all([ctx.db.get(a.circleId), ctx.db.get(a.otherId)]);
    if (!x || !y || x.canvasId === y.canvasId) return null;
    const pairKey = [x._id, y._id].sort().join(":");
    const existing = await ctx.db
      .query("circleConnections")
      .withIndex("by_pair", (q) => q.eq("pairKey", pairKey))
      .first();
    if (existing) return null;
    const [source, target] = x.createdAt <= y.createdAt ? [x, y] : [y, x];
    const id = await ctx.db.insert("circleConnections", {
      sourceCircleId: source._id,
      targetCircleId: target._id,
      pairKey,
      type: a.type,
      reason: a.reason.replace(/\s+/g, " ").trim().slice(0, 220),
      confidence: Math.max(0, Math.min(1, a.confidence)),
      signals: a.signals.slice(0, 8),
      createdAt: Date.now(),
    });
    // Both owners see it as something new on their circle.
    for (const c of [x, y]) {
      await ctx.db.patch(c._id, { connectionCount: (c.connectionCount ?? 0) + 1, unseen: (c.unseen ?? 0) + 1 });
    }
    return id;
  },
});

// ---------------------------------------------------------------------------
// People to tell
// ---------------------------------------------------------------------------

const vOwner = v.object({
  canvasId: v.id("canvases"),
  slug: v.string(),
  alias: v.union(v.string(), v.null()),
  email: v.union(v.string(), v.null()),
  house: v.boolean(),
});

/** The person behind a circle, and whether there's an address to reach them at. */
export const owner = internalQuery({
  args: { circleId: v.id("circles") },
  returns: v.union(v.object({ circle: v.object({ title: v.string(), createdAt: v.number() }), owner: vOwner }), v.null()),
  handler: async (ctx, { circleId }) => {
    const c = await ctx.db.get(circleId);
    if (!c) return null;
    const ws = await ctx.db.get(c.canvasId);
    if (!ws) return null;
    return {
      circle: { title: c.title, createdAt: c.createdAt },
      owner: { canvasId: ws._id, slug: ws.slug, alias: ws.alias ?? null, email: ws.emailFrom ?? null, house: ws.house === true },
    };
  },
});

/**
 * Reserve a notification before sending it. Null when this exact message was
 * already sent (or is being sent), or when the person has heard enough from us today.
 */
export const claimNotification = internalMutation({
  args: {
    circleId: v.id("circles"),
    recipientId: v.id("canvases"),
    to: v.string(),
    type: vNotificationType,
    reason: v.string(),
    dedupeKey: v.string(),
    subject: v.string(),
  },
  returns: v.union(v.object({ id: v.id("agentNotifications") }), v.object({ skipped: v.string() })),
  handler: async (ctx, a) => {
    const dup = await ctx.db
      .query("agentNotifications")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", a.dedupeKey))
      .first();
    // Sent (or sending) means never again. A failed one may be tried again, a couple of times.
    if (dup && dup.status !== "failed") return { skipped: "already sent" };
    if (dup) {
      const tries = (dup.attempts ?? 1) + 1;
      if (tries > 3) return { skipped: "gave up after three tries" };
      await ctx.db.patch(dup._id, { status: "sending", attempts: tries, subject: a.subject.slice(0, 200) });
      return { id: dup._id };
    }
    const today = await ctx.db
      .query("agentNotifications")
      .withIndex("by_recipient", (q) => q.eq("recipientId", a.recipientId).gt("createdAt", Date.now() - DAY))
      .take(MAX_EMAILS_PER_DAY + 1);
    if (today.filter((n) => n.status !== "failed").length >= MAX_EMAILS_PER_DAY) return { skipped: "enough email today" };
    const id = await ctx.db.insert("agentNotifications", {
      circleId: a.circleId,
      recipientId: a.recipientId,
      to: a.to,
      type: a.type,
      reason: a.reason.slice(0, 400),
      dedupeKey: a.dedupeKey,
      status: "sending",
      subject: a.subject.slice(0, 200),
      createdAt: Date.now(),
    });
    return { id };
  },
});

export const markNotification = internalMutation({
  args: {
    id: v.id("agentNotifications"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    await ctx.db.patch(a.id, {
      status: a.status,
      ...(a.threadId ? { threadId: a.threadId } : {}),
      ...(a.messageId ? { messageId: a.messageId } : {}),
      ...(a.error ? { error: a.error.slice(0, 300) } : {}),
      ...(a.status === "sent" ? { sentAt: Date.now() } : {}),
    });
    return null;
  },
});

/** A reply to one of our emails belongs to the circle that email was about. */
export const circleForThread = internalQuery({
  args: { threadId: v.string() },
  returns: v.union(v.id("circles"), v.null()),
  handler: async (ctx, { threadId }) => {
    const n = await ctx.db
      .query("agentNotifications")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .first();
    return n?.circleId ?? null;
  },
});

// ---------------------------------------------------------------------------
// Contributions, batched
// ---------------------------------------------------------------------------

/** One contribution, and whether its author is the circle's own owner. */
export const contribution = internalQuery({
  args: { contributionId: v.string() },
  returns: v.union(v.object({ type: v.string(), byOwner: v.boolean(), settled: v.boolean() }), v.null()),
  handler: async (ctx, { contributionId }) => {
    const id = ctx.db.normalizeId("contributions", contributionId);
    const k = id ? await ctx.db.get(id) : null;
    if (!k) return null;
    const c = await ctx.db.get(k.circleId);
    return { type: k.type, byOwner: c?.canvasId === k.canvasId, settled: k.state === "ok" };
  },
});

/** Who added what (and whether it's worth an email), since the owner last heard. */
export const digest = internalQuery({
  args: { circleId: v.id("circles") },
  returns: v.union(
    v.object({
      title: v.string(),
      since: v.number(),
      items: v.array(v.object({ by: v.string(), type: v.string(), text: v.union(v.string(), v.null()), label: v.string() })),
    }),
    v.null(),
  ),
  handler: async (ctx, { circleId }) => {
    const c = await ctx.db.get(circleId);
    if (!c) return null;
    const since = c.grewNotifiedAt ?? 0;
    const rows = await ctx.db
      .query("contributions")
      .withIndex("by_circle", (q) => q.eq("circleId", circleId).gt("createdAt", since))
      .take(40);
    return {
      title: c.title,
      since,
      // Only settled things other people added: the owner's own words never email the owner.
      items: rows
        .filter((k) => k.state === "ok" && k.canvasId !== c.canvasId)
        .map((k) => ({ by: k.by, type: k.type, text: k.text ?? null, label: k.label })),
    };
  },
});

export const markGrewNotified = internalMutation({
  args: { circleId: v.id("circles"), at: v.number() },
  returns: v.null(),
  handler: async (ctx, { circleId, at }) => {
    await ctx.db.patch(circleId, { grewNotifiedAt: at });
    return null;
  },
});

// ---------------------------------------------------------------------------
// For people running the demo: what the agent decided, newest first.
//   npx convex run agent/store:recent
// ---------------------------------------------------------------------------

export const recent = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object({ at: v.string(), circle: v.string(), type: v.string(), result: v.string() })),
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("agentEvents")
      .withIndex("by_createdAt")
      .order("desc")
      .take(Math.min(50, limit ?? 20));
    const out = [];
    for (const e of rows) {
      const c = await ctx.db.get(e.circleId);
      out.push({ at: new Date(e.createdAt).toISOString(), circle: c?.title ?? "(removed)", type: e.type, result: e.result ?? "waiting" });
    }
    return out;
  },
});

/** Reword a connection's shared sentence (for fixing one by hand). */
export const reword = internalMutation({
  args: { connectionId: v.id("circleConnections"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, a) => {
    await ctx.db.patch(a.connectionId, { reason: a.reason.slice(0, 220) });
    return null;
  },
});
