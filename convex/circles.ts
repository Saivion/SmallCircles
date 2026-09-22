import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  elementFields,
  vCircleStatus,
  vContext,
  vConnectionType,
  vContributionType,
  vElementKind,
  vPhotoMeta,
} from "./lib/circleFields";
import { hourOf, promptFor } from "./lib/hour";
import { makeAlias } from "./lib/names";
import { cityKeyOf, geoCellOf, normalise } from "./lib/match";
import { isDoodleId } from "./lib/vocabulary";
import { requireWorkspace, workspace } from "./lib/access";
import { SAMPLE_PROMPTS } from "./lib/samples";
import { emitCircleReady } from "./agent/store";

/** A circle holds a moment and at most this many things around it (DESIGN.md §10). */
export const MAX_ELEMENTS = 8;
/** What other people added, as shown on the circle: the newest this many. */
export const MAX_SHOWN_CONTRIBUTIONS = 12;
const MAX_CIRCLES_PER_HOUR = 20;
const MAX_CIRCLES_PER_WORKSPACE = 300;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const HOUR = 60 * 60 * 1000;
/** Give to get: visit this many moments before yours goes out (fewer if there aren't that many). */
const GIVE_BEFORE_GET = 3;
/** How far back the shared pool reaches. The hour comes first; earlier moments keep it from ever being empty. */
const POOL_SCAN = 60;

async function ownCircle(ctx: QueryCtx | MutationCtx, slug: string, circleId: Id<"circles">) {
  const ws = await workspace(ctx, slug);
  if (!ws) return null;
  const circle = await ctx.db.get(circleId);
  if (!circle || circle.canvasId !== ws._id) return null;
  return circle;
}

function seedFrom(id: string, now: number): number {
  let h = 2166136261 ^ now;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Where a circle was, as keys to match other moments on. Distances only ever come
 * from the photo's own GPS: a place guessed from the picture ("paris") gives a city,
 * never a point, so two guesses can't look like the same street corner.
 */
export function placeKeys(place: NonNullable<Doc<"circles">["context"]["place"]>, metadata: Doc<"circles">["metadata"]) {
  const exact = typeof metadata.lat === "number" && typeof metadata.lng === "number";
  const cityKey = cityKeyOf(place.city ?? place.name, place.country);
  const spotKey = normalise(place.spot);
  const hoodKey = normalise(place.neighbourhood);
  return {
    ...(cityKey ? { cityKey } : {}),
    ...(spotKey ? { spotKey } : {}),
    ...(hoodKey ? { hoodKey } : {}),
    ...(exact ? { gps: { lat: metadata.lat!, lng: metadata.lng! }, geoCell: geoCellOf(metadata.lat!, metadata.lng!) } : {}),
  };
}

/** The name someone goes by here, minting one if they've never had one. */
export async function aliasOf(ctx: MutationCtx, ws: Doc<"canvases">): Promise<string> {
  if (ws.alias) return ws.alias;
  const alias = makeAlias();
  await ctx.db.patch(ws._id, { alias });
  return alias;
}

/** Released moments by other people that someone could still visit. */
/**
 * Other people's moments this person could still visit for the first time, up to
 * `cap`. Give-to-get never asks for more visits than there are new moments to
 * give them to.
 */
async function othersInPool(ctx: QueryCtx | MutationCtx, canvasId: Id<"canvases">, cap: number): Promise<number> {
  const recent = await ctx.db
    .query("circles")
    .withIndex("by_released_createdAt", (q) => q.eq("released", true))
    .order("desc")
    .take(POOL_SCAN);
  let n = 0;
  for (const c of recent) {
    if (n >= cap) break;
    if (c.canvasId === canvasId || c.status === "failed") continue;
    const seen = await ctx.db
      .query("circleViews")
      .withIndex("by_circle_viewer", (q) => q.eq("circleId", c._id).eq("viewerId", canvasId))
      .first();
    if (!seen) n++;
  }
  return n;
}

/**
 * Start a circle from a stored photo. Every new circle answers the hour's
 * prompt and is public once released.
 */
export async function startCircle(
  ctx: MutationCtx,
  args: {
    canvasId: Id<"canvases">;
    storageId: Id<"_storage">;
    contentType?: string;
    metadata: Doc<"circles">["metadata"];
    note?: string;
  },
): Promise<Id<"circles">> {
  const now = Date.now();
  const ws = await ctx.db.get(args.canvasId);
  if (!ws) throw new ConvexError("unknown workspace");
  const recent = await ctx.db
    .query("circles")
    .withIndex("by_canvas_createdAt", (q) => q.eq("canvasId", args.canvasId).gt("createdAt", now - HOUR))
    .take(MAX_CIRCLES_PER_HOUR);
  if (recent.length >= MAX_CIRCLES_PER_HOUR) {
    throw new ConvexError("That's a lot of moments for one hour. Try again in a little while.");
  }
  const all = await ctx.db
    .query("circles")
    .withIndex("by_canvas_createdAt", (q) => q.eq("canvasId", args.canvasId))
    .take(MAX_CIRCLES_PER_WORKSPACE);
  if (all.length >= MAX_CIRCLES_PER_WORKSPACE) throw new ConvexError("This page is full.");

  const hour = hourOf(now);
  const owed = ws.house ? 0 : await othersInPool(ctx, args.canvasId, GIVE_BEFORE_GET);
  const circleId = await ctx.db.insert("circles", {
    canvasId: args.canvasId,
    title: "a moment",
    primaryMedia: { storageId: args.storageId, ...(args.contentType ? { contentType: args.contentType } : {}) },
    metadata: args.metadata,
    context: {},
    status: "drawing",
    generationSeed: seedFrom(args.storageId, now),
    ...(args.note ? { note: args.note.slice(0, 1000) } : {}),
    createdAt: now,
    hour,
    // A starter moment answers the prompt it was picked for; everyone else answers the hour's.
    prompt: (ws.house && args.note ? SAMPLE_PROMPTS[args.note] : undefined) ?? promptFor(hour),
    author: await aliasOf(ctx, ws),
    released: owed === 0,
    owed,
    views: 0,
    contributionCount: 0,
    unseen: 0,
    ...(ws.house ? { seeded: true } : {}),
  });
  await ctx.scheduler.runAfter(0, internal.moments.draw.run, { circleId });
  return circleId;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** A one-time URL the browser uploads the photo to. */
export const uploadUrl = mutation({
  args: { slug: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.slug);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Share a moment: the photo becomes the centre of a new circle, answering this hour's prompt. */
export const create = mutation({
  args: {
    slug: v.string(),
    storageId: v.id("_storage"),
    metadata: vPhotoMeta,
    note: v.optional(v.string()),
  },
  returns: v.id("circles"),
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx, args.slug);
    const file = await ctx.db.system.get(args.storageId);
    if (!file) throw new ConvexError("The photo didn't arrive. Try again?");
    if (file.size > MAX_PHOTO_BYTES) throw new ConvexError("That photo is too large (15 MB at most).");
    if (file.contentType && !file.contentType.startsWith("image/")) {
      throw new ConvexError("Small Circles needs a photo.");
    }
    const note = args.note?.replace(/\s+/g, " ").trim().slice(0, 140);
    return await startCircle(ctx, {
      canvasId: ws._id,
      storageId: args.storageId,
      ...(file.contentType ? { contentType: file.contentType } : {}),
      metadata: args.metadata,
      ...(note ? { note } : {}),
    });
  },
});

const vElementOut = v.object({
  _id: v.id("circleElements"),
  order: v.number(),
  kind: vElementKind,
  illustration: v.string(),
  label: v.string(),
  semanticMeaning: v.string(),
  importance: v.number(),
  detail: v.union(v.string(), v.null()),
  source: v.union(v.object({ url: v.string(), title: v.string() }), v.null()),
  pointsAt: v.union(v.object({ x: v.number(), y: v.number() }), v.null()),
  geo: v.union(v.object({ lat: v.number(), lng: v.number() }), v.null()),
  createdAt: v.number(),
});

function elementOut(e: Doc<"circleElements">, isMine: boolean) {
  return {
    _id: e._id,
    order: e.order,
    kind: e.kind,
    illustration: e.illustration,
    label: e.label,
    semanticMeaning: e.semanticMeaning,
    importance: e.importance,
    detail: e.detail ?? null,
    source: e.source ?? null,
    pointsAt: e.pointsAt ?? null,
    // Exact coordinates are the author's alone; everyone else gets the words.
    geo: isMine ? (e.geo ?? null) : null,
    createdAt: e.createdAt,
  };
}

/** A moment this one crossed paths with, as the page shows it. */
const vConnectionOut = v.object({
  _id: v.id("circleConnections"),
  type: vConnectionType,
  reason: v.string(),
  createdAt: v.number(),
  other: v.object({
    _id: v.id("circles"),
    title: v.string(),
    author: v.union(v.string(), v.null()),
    photoUrl: v.union(v.string(), v.null()),
    generationSeed: v.number(),
    illustrations: v.array(v.string()),
    isMine: v.boolean(),
    dateLabel: v.union(v.string(), v.null()),
  }),
});

/** Connections both ways, newest first, only to moments this viewer is allowed to open. */
async function connectionsOf(ctx: QueryCtx, c: Doc<"circles">, viewerId: Id<"canvases"> | null) {
  const [asSource, asTarget] = await Promise.all([
    ctx.db.query("circleConnections").withIndex("by_source", (q) => q.eq("sourceCircleId", c._id)).order("desc").take(6),
    ctx.db.query("circleConnections").withIndex("by_target", (q) => q.eq("targetCircleId", c._id)).order("desc").take(6),
  ]);
  const out = [];
  for (const k of [...asSource, ...asTarget].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4)) {
    const other = await ctx.db.get(k.sourceCircleId === c._id ? k.targetCircleId : k.sourceCircleId);
    if (!other) continue;
    const otherIsMine = viewerId !== null && other.canvasId === viewerId;
    if (!otherIsMine && other.released !== true) continue;
    const els = await ctx.db
      .query("circleElements")
      .withIndex("by_circle", (q) => q.eq("circleId", other._id))
      .take(4);
    out.push({
      _id: k._id,
      type: k.type,
      reason: k.reason,
      createdAt: k.createdAt,
      other: {
        _id: other._id,
        title: other.title,
        author: other.author ?? null,
        photoUrl: await ctx.storage.getUrl(other.primaryMedia.storageId),
        generationSeed: other.generationSeed,
        illustrations: els.map((e) => e.illustration),
        isMine: otherIsMine,
        dateLabel: other.dateLabel ?? null,
      },
    });
  }
  return out;
}

const vContributionOut = v.object({
  _id: v.id("contributions"),
  by: v.string(),
  type: vContributionType,
  text: v.union(v.string(), v.null()),
  illustration: v.string(),
  label: v.string(),
  photoUrl: v.union(v.string(), v.null()),
  state: v.union(v.literal("reading"), v.literal("ok")),
  isMine: v.boolean(),
  createdAt: v.number(),
});

async function contributionOut(ctx: QueryCtx, c: Doc<"contributions">, viewerId: Id<"canvases"> | null) {
  return {
    _id: c._id,
    by: c.by,
    type: c.type,
    text: c.text ?? null,
    illustration: c.illustration,
    label: c.label,
    photoUrl: c.storageId ? await ctx.storage.getUrl(c.storageId) : null,
    state: c.state,
    isMine: viewerId !== null && c.canvasId === viewerId,
    createdAt: c.createdAt,
  };
}

const vCircleSummary = v.object({
  _id: v.id("circles"),
  title: v.string(),
  subtitle: v.union(v.string(), v.null()),
  dateLabel: v.union(v.string(), v.null()),
  status: vCircleStatus,
  photoUrl: v.union(v.string(), v.null()),
  generationSeed: v.number(),
  illustrations: v.array(v.string()),
  createdAt: v.number(),
  author: v.union(v.string(), v.null()),
  prompt: v.union(v.string(), v.null()),
  hour: v.union(v.number(), v.null()),
  isMine: v.boolean(),
  released: v.boolean(),
  owed: v.number(),
  views: v.number(),
  contributionCount: v.number(),
  connectionCount: v.number(),
  unseen: v.number(),
  seeded: v.boolean(),
});

async function summaryOf(ctx: QueryCtx, c: Doc<"circles">, viewerId: Id<"canvases"> | null) {
  const els = await ctx.db
    .query("circleElements")
    .withIndex("by_circle", (q) => q.eq("circleId", c._id))
    .take(MAX_ELEMENTS);
  const isMine = viewerId !== null && c.canvasId === viewerId;
  return {
    _id: c._id,
    title: c.title,
    subtitle: c.subtitle ?? null,
    dateLabel: c.dateLabel ?? null,
    status: c.status,
    photoUrl: await ctx.storage.getUrl(c.primaryMedia.storageId),
    generationSeed: c.generationSeed,
    illustrations: els.map((e) => e.illustration),
    createdAt: c.createdAt,
    author: c.author ?? null,
    prompt: c.prompt ?? null,
    hour: c.hour ?? null,
    isMine,
    released: c.released === true,
    owed: c.owed ?? 0,
    views: c.views ?? 0,
    contributionCount: c.contributionCount ?? 0,
    connectionCount: c.connectionCount ?? 0,
    // Only the author is told what's new on their own circle.
    unseen: isMine ? (c.unseen ?? 0) : 0,
    seeded: c.seeded === true,
  };
}

/** Your own circles, newest first. */
export const list = query({
  args: { slug: v.string() },
  returns: v.array(vCircleSummary),
  handler: async (ctx, args) => {
    const ws = await workspace(ctx, args.slug);
    if (!ws) return [];
    const circles = await ctx.db
      .query("circles")
      .withIndex("by_canvas_createdAt", (q) => q.eq("canvasId", ws._id))
      .order("desc")
      .take(60);
    return await Promise.all(circles.map((c) => summaryOf(ctx, c, ws._id)));
  },
});

/**
 * The shared pool, for the ring on the home page: everyone's released moments,
 * this hour's first. Earlier hours fill in behind them, so the ring is never
 * empty, even in a quiet hour.
 */
export const pool = query({
  args: { slug: v.string(), hour: v.number(), limit: v.optional(v.number()) },
  returns: v.array(vCircleSummary),
  handler: async (ctx, args) => {
    const ws = await workspace(ctx, args.slug);
    const limit = Math.max(1, Math.min(16, args.limit ?? 10));
    const recent = await ctx.db
      .query("circles")
      .withIndex("by_released_createdAt", (q) => q.eq("released", true))
      .order("desc")
      .take(POOL_SCAN);
    // This hour first (newest first), then everyone else's earlier moments, then the house.
    const rank = (c: Doc<"circles">) => (c.seeded ? 2 : c.hour === args.hour ? 0 : 1);
    const picked = recent
      .filter((c) => c.status !== "failed")
      .sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt)
      .slice(0, limit);
    return await Promise.all(picked.map((c) => summaryOf(ctx, c, ws?._id ?? null)));
  },
});

/**
 * Three moments to visit. The rule is fairness, not engagement: the ones
 * fewest people have seen come first, this hour's before earlier ones, and
 * never one you've already opened or your own.
 */
export const discover = query({
  args: { slug: v.string(), hour: v.number() },
  returns: v.object({
    moments: v.array(vCircleSummary),
    /** How many more visits before your waiting moment goes out (0 when nothing waits). */
    owed: v.number(),
    /** How many you've visited in total. */
    visited: v.number(),
    revisits: v.array(v.id("circles")),
  }),
  handler: async (ctx, args) => {
    const ws = await workspace(ctx, args.slug);
    if (!ws) return { moments: [], owed: 0, visited: 0, revisits: [] };
    const recent = await ctx.db
      .query("circles")
      .withIndex("by_released_createdAt", (q) => q.eq("released", true))
      .order("desc")
      .take(POOL_SCAN);
    const candidates: Doc<"circles">[] = [];
    const seenBefore: Doc<"circles">[] = [];
    for (const c of recent) {
      if (c.canvasId === ws._id || c.status === "failed") continue;
      const seen = await ctx.db
        .query("circleViews")
        .withIndex("by_circle_viewer", (q) => q.eq("circleId", c._id).eq("viewerId", ws._id))
        .first();
      (seen ? seenBefore : candidates).push(c);
    }
    const rank = (c: Doc<"circles">) => (c.seeded ? 2 : c.hour === args.hour ? 0 : 1);
    candidates.sort((a, b) => rank(a) - rank(b) || (a.views ?? 0) - (b.views ?? 0) || b.createdAt - a.createdAt);
    // Always three: when there aren't three new ones, the rest are ones you've opened
    // before, the least interacted with first (fewest people seen, fewest things added).
    const quiet = (c: Doc<"circles">) => (c.views ?? 0) + (c.contributionCount ?? 0);
    seenBefore.sort((a, b) => quiet(a) - quiet(b) || b.createdAt - a.createdAt);
    const three = [...candidates.slice(0, 3), ...seenBefore.slice(0, Math.max(0, 3 - candidates.length))];
    const mine = await ctx.db
      .query("circles")
      .withIndex("by_canvas_createdAt", (q) => q.eq("canvasId", ws._id))
      .order("desc")
      .take(20);
    const owed = Math.max(0, ...mine.filter((c) => c.released === false).map((c) => c.owed ?? 0));
    const visited = (
      await ctx.db
        .query("circleViews")
        .withIndex("by_viewer", (q) => q.eq("viewerId", ws._id))
        .take(200)
    ).length;
    return {
      moments: await Promise.all(three.map((c) => summaryOf(ctx, c, ws._id))),
      /** Which of the three you've opened before. */
      revisits: three.filter((c) => seenBefore.includes(c)).map((c) => c._id),
      owed,
      visited,
    };
  },
});

/**
 * One circle, everything the renderer and the explore card need. Live while it
 * draws and while people add to it. Anyone can open a released circle; only
 * its author sees where exactly the photo was taken.
 */
export const get = query({
  args: { slug: v.string(), circleId: v.id("circles") },
  returns: v.union(
    v.object({
      _id: v.id("circles"),
      title: v.string(),
      subtitle: v.union(v.string(), v.null()),
      dateLabel: v.union(v.string(), v.null()),
      status: vCircleStatus,
      photoUrl: v.union(v.string(), v.null()),
      metadata: vPhotoMeta,
      context: vContext,
      generationSeed: v.number(),
      note: v.union(v.string(), v.null()),
      error: v.union(v.string(), v.null()),
      elements: v.array(vElementOut),
      notes: v.array(v.object({ _id: v.id("circleNotes"), text: v.string(), createdAt: v.number() })),
      contributions: v.array(vContributionOut),
      connections: v.array(vConnectionOut),
      createdAt: v.number(),
      author: v.union(v.string(), v.null()),
      prompt: v.union(v.string(), v.null()),
      hour: v.union(v.number(), v.null()),
      isMine: v.boolean(),
      released: v.boolean(),
      owed: v.number(),
      views: v.number(),
      contributionCount: v.number(),
      seeded: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const ws = await workspace(ctx, args.slug);
    const c = await ctx.db.get(args.circleId);
    if (!c) return null;
    const isMine = ws !== null && c.canvasId === ws._id;
    if (!isMine && c.released !== true) return null;
    const [els, notes, contribs] = await Promise.all([
      ctx.db
        .query("circleElements")
        .withIndex("by_circle", (q) => q.eq("circleId", c._id))
        .take(MAX_ELEMENTS),
      ctx.db
        .query("circleNotes")
        .withIndex("by_circle", (q) => q.eq("circleId", c._id))
        .take(40),
      ctx.db
        .query("contributions")
        .withIndex("by_circle", (q) => q.eq("circleId", c._id))
        .order("desc")
        .take(MAX_SHOWN_CONTRIBUTIONS * 2),
    ]);
    // Everyone sees what's settled; you also see your own while it's still being read.
    const shown = contribs
      .filter((k) => k.state === "ok" || (ws !== null && k.canvasId === ws._id))
      .slice(0, MAX_SHOWN_CONTRIBUTIONS)
      .reverse();
    return {
      _id: c._id,
      title: c.title,
      subtitle: c.subtitle ?? null,
      dateLabel: c.dateLabel ?? null,
      status: c.status,
      photoUrl: await ctx.storage.getUrl(c.primaryMedia.storageId),
      metadata: isMine ? c.metadata : {},
      context: isMine ? c.context : stripPlace(c.context),
      generationSeed: c.generationSeed,
      note: c.note ?? null,
      error: c.error ?? null,
      elements: els.map((e) => elementOut(e, isMine)),
      notes: notes.map((n) => ({ _id: n._id, text: n.text, createdAt: n.createdAt })),
      contributions: await Promise.all(shown.map((k) => contributionOut(ctx, k, ws?._id ?? null))),
      connections: await connectionsOf(ctx, c, ws?._id ?? null),
      createdAt: c.createdAt,
      author: c.author ?? null,
      prompt: c.prompt ?? null,
      hour: c.hour ?? null,
      isMine,
      released: c.released === true,
      owed: c.owed ?? 0,
      views: c.views ?? 0,
      contributionCount: c.contributionCount ?? 0,
      seeded: c.seeded === true,
    };
  },
});

/** For everyone but the author: the place in words, never the coordinates. */
function stripPlace(context: Doc<"circles">["context"]): Doc<"circles">["context"] {
  if (!context.place) return context;
  const { lat: _lat, lng: _lng, ...place } = context.place;
  return { ...context, place };
}

/**
 * Someone opened a circle. For a visitor it counts once per person, and pays
 * down give-to-get on their own waiting moment. For the author it clears what's new.
 */
export const seen = mutation({
  args: { slug: v.string(), circleId: v.id("circles") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ws = await workspace(ctx, args.slug);
    const c = await ctx.db.get(args.circleId);
    if (!ws || !c) return null;
    if (c.canvasId === ws._id) {
      if ((c.unseen ?? 0) > 0) await ctx.db.patch(c._id, { unseen: 0 });
      return null;
    }
    if (c.released !== true) return null;
    const already = await ctx.db
      .query("circleViews")
      .withIndex("by_circle_viewer", (q) => q.eq("circleId", c._id).eq("viewerId", ws._id))
      .first();
    if (already) {
      // Seen before. It only counts toward give-to-get when there's nothing new left to
      // see, so a waiting moment can never get stuck with no way out.
      if ((await othersInPool(ctx, ws._id, 1)) === 0) await payDown(ctx, ws._id);
      return null;
    }
    await ctx.db.insert("circleViews", { circleId: c._id, viewerId: ws._id, createdAt: Date.now() });
    await ctx.db.patch(c._id, { views: (c.views ?? 0) + 1 });
    await payDown(ctx, ws._id);
    return null;
  },
});

/** One visit given: every moment of theirs that's waiting to go out gets one closer. */
async function payDown(ctx: MutationCtx, canvasId: Id<"canvases">) {
  const mine = await ctx.db
    .query("circles")
    .withIndex("by_canvas_createdAt", (q) => q.eq("canvasId", canvasId))
    .order("desc")
    .take(20);
  for (const m of mine) {
    if (m.released !== false) continue;
    const owed = Math.max(0, (m.owed ?? 0) - 1);
    await ctx.db.patch(m._id, { owed, ...(owed === 0 ? { released: true } : {}) });
    // Featured now: if it's also finished drawing, its agent can look for moments it crossed paths with.
    if (owed === 0 && m.status === "done") {
      const out = await ctx.db.get(m._id);
      if (out) await emitCircleReady(ctx, out);
    }
  }
}

/** Remove one of your own circles, with everything added to it. */
export const remove = mutation({
  args: { slug: v.string(), circleId: v.id("circles") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const c = await ownCircle(ctx, args.slug, args.circleId);
    if (!c) return null;
    for (const e of await ctx.db
      .query("circleElements")
      .withIndex("by_circle", (q) => q.eq("circleId", c._id))
      .take(50)) {
      await ctx.db.delete(e._id);
    }
    for (const n of await ctx.db
      .query("circleNotes")
      .withIndex("by_circle", (q) => q.eq("circleId", c._id))
      .take(100)) {
      await ctx.db.delete(n._id);
    }
    for (const k of await ctx.db
      .query("contributions")
      .withIndex("by_circle", (q) => q.eq("circleId", c._id))
      .take(200)) {
      if (k.storageId) await ctx.storage.delete(k.storageId);
      await ctx.db.delete(k._id);
    }
    // Its crossed paths go too, and the other side no longer counts them.
    for (const k of [
      ...(await ctx.db.query("circleConnections").withIndex("by_source", (q) => q.eq("sourceCircleId", c._id)).take(100)),
      ...(await ctx.db.query("circleConnections").withIndex("by_target", (q) => q.eq("targetCircleId", c._id)).take(100)),
    ]) {
      const otherId = k.sourceCircleId === c._id ? k.targetCircleId : k.sourceCircleId;
      const other = await ctx.db.get(otherId);
      if (other) {
        await ctx.db.patch(other._id, {
          connectionCount: Math.max(0, (other.connectionCount ?? 1) - 1),
          unseen: Math.max(0, (other.unseen ?? 0) - 1),
        });
      }
      await ctx.db.delete(k._id);
    }
    for (const view of await ctx.db
      .query("circleViews")
      .withIndex("by_circle_viewer", (q) => q.eq("circleId", c._id))
      .take(500)) {
      await ctx.db.delete(view._id);
    }
    await ctx.storage.delete(c.primaryMedia.storageId);
    await ctx.db.delete(c._id);
    return null;
  },
});

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Where Small Circles writes to this person when their moments connect or grow (null: nowhere yet). */
export const inbox = query({
  args: { slug: v.string() },
  returns: v.object({ from: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    const ws = await workspace(ctx, args.slug);
    return { from: ws?.emailFrom ?? null };
  },
});

/** "Email me when my moments connect": the address the Circle Agent's notes go to. */
export const setEmailFrom = mutation({
  args: { slug: v.string(), email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx, args.slug);
    const email = args.email.trim().toLowerCase().slice(0, 254);
    if (!EMAIL.test(email)) throw new ConvexError("That doesn't look like an email address.");
    await ctx.db.patch(ws._id, { emailFrom: email });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Internal: the drawing pipeline writes through these.
// ---------------------------------------------------------------------------

export const forDraw = internalQuery({
  args: { circleId: v.id("circles") },
  returns: v.union(
    v.object({
      circle: v.object({
        _id: v.id("circles"),
        title: v.string(),
        status: vCircleStatus,
        metadata: vPhotoMeta,
        context: vContext,
        note: v.union(v.string(), v.null()),
        canvasId: v.id("canvases"),
        prompt: v.union(v.string(), v.null()),
      }),
      photoUrl: v.union(v.string(), v.null()),
      elementCount: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.circleId);
    if (!c) return null;
    const els = await ctx.db
      .query("circleElements")
      .withIndex("by_circle", (q) => q.eq("circleId", c._id))
      .take(MAX_ELEMENTS);
    return {
      circle: {
        _id: c._id,
        title: c.title,
        status: c.status,
        metadata: c.metadata,
        context: c.context,
        note: c.note ?? null,
        canvasId: c.canvasId,
        prompt: c.prompt ?? null,
      },
      photoUrl: await ctx.storage.getUrl(c.primaryMedia.storageId),
      elementCount: els.length,
    };
  },
});

/** A handwritten margin note: what the page is noticing right now. */
export const note = internalMutation({
  args: { circleId: v.id("circles"), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const text = args.text.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!text) return null;
    await ctx.db.insert("circleNotes", { circleId: args.circleId, text, createdAt: Date.now() });
    return null;
  },
});

export const patch = internalMutation({
  args: {
    circleId: v.id("circles"),
    title: v.optional(v.string()),
    subtitle: v.optional(v.string()),
    dateLabel: v.optional(v.string()),
    context: v.optional(vContext),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.circleId);
    if (!c) return null;
    await ctx.db.patch(c._id, {
      ...(args.title ? { title: args.title.toLowerCase().slice(0, 40) } : {}),
      ...(args.subtitle ? { subtitle: args.subtitle.toLowerCase().slice(0, 60) } : {}),
      ...(args.dateLabel ? { dateLabel: args.dateLabel.toLowerCase().slice(0, 40) } : {}),
      // Context accumulates: each step adds what it learned.
      ...(args.context ? { context: { ...c.context, ...args.context } } : {}),
      // Once it knows where, it can be matched with other moments there.
      ...(args.context?.place ? placeKeys(args.context.place, c.metadata) : {}),
    });
    return null;
  },
});

const { circleId: _c, order: _o, createdAt: _t, ...elementInput } = elementFields;

/**
 * Add one thing to the circle. Never more than MAX_ELEMENTS, never the same
 * drawing with the same label twice. Returns null when it did not fit.
 */
export const addElement = internalMutation({
  args: { circleId: v.id("circles"), element: v.object(elementInput) },
  returns: v.union(v.id("circleElements"), v.null()),
  handler: async (ctx, args) => {
    const e = args.element;
    if (!isDoodleId(e.illustration)) return null;
    const existing = await ctx.db
      .query("circleElements")
      .withIndex("by_circle", (q) => q.eq("circleId", args.circleId))
      .take(MAX_ELEMENTS + 1);
    if (existing.length >= MAX_ELEMENTS) return null;
    const label = e.label.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 32);
    // One of each drawing, and never the same thing twice under another name.
    const words = (t: string) => t.replace(/[^a-z0-9 ]/g, "").trim();
    if (existing.some((x) => x.illustration === e.illustration || words(x.label) === words(label))) return null;
    if (e.kind === "discovered" && existing.some((x) => x.kind === "place" && (words(x.semanticMeaning).includes(words(label)) || words(x.detail ?? "").includes(words(label))))) {
      return null;
    }
    return await ctx.db.insert("circleElements", {
      ...e,
      label,
      semanticMeaning: e.semanticMeaning.slice(0, 200),
      importance: Math.max(0, Math.min(1, e.importance)),
      ...(e.detail ? { detail: e.detail.slice(0, 600) } : {}),
      circleId: args.circleId,
      order: existing.length,
      createdAt: Date.now(),
    });
  },
});

/** Fill in what was found later: the explore card's words and its source. */
export const enrichElement = internalMutation({
  args: {
    elementId: v.id("circleElements"),
    detail: v.optional(v.string()),
    source: v.optional(v.object({ url: v.string(), title: v.string() })),
    label: v.optional(v.string()),
    importance: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const e = await ctx.db.get(args.elementId);
    if (!e) return null;
    await ctx.db.patch(e._id, {
      ...(args.detail ? { detail: args.detail.slice(0, 600) } : {}),
      ...(args.source ? { source: { url: args.source.url.slice(0, 1000), title: args.source.title.slice(0, 160) } } : {}),
      ...(args.label ? { label: args.label.toLowerCase().slice(0, 32) } : {}),
      ...(args.importance !== undefined ? { importance: Math.max(0, Math.min(1, args.importance)) } : {}),
    });
    return null;
  },
});

export const listElements = internalQuery({
  args: { circleId: v.id("circles") },
  returns: v.array(v.object({ _id: v.id("circleElements"), illustration: v.string(), label: v.string(), kind: vElementKind })),
  handler: async (ctx, args) => {
    const els = await ctx.db
      .query("circleElements")
      .withIndex("by_circle", (q) => q.eq("circleId", args.circleId))
      .take(MAX_ELEMENTS);
    return els.map((e) => ({ _id: e._id, illustration: e.illustration, label: e.label, kind: e.kind }));
  },
});

export const finish = internalMutation({
  args: { circleId: v.id("circles"), status: v.union(v.literal("done"), v.literal("failed")), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.circleId);
    if (!c || c.status !== "drawing") return null;
    await ctx.db.patch(c._id, {
      status: args.status,
      finishedAt: Date.now(),
      ...(args.error ? { error: args.error.slice(0, 200) } : {}),
    });
    // Drawn, and (if it's already out in the world) its agent takes a look around.
    const done = await ctx.db.get(c._id);
    if (done && done.status === "done") await emitCircleReady(ctx, done);
    return null;
  },
});

/** A circle stuck drawing (the action died) is closed with what it has. */
export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("circles")
      .withIndex("by_status", (q) => q.eq("status", "drawing"))
      .take(50);
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const c of stale) {
      if (c.createdAt < cutoff) {
        await ctx.db.patch(c._id, { status: "done", finishedAt: Date.now() });
        const done = await ctx.db.get(c._id);
        if (done) await emitCircleReady(ctx, done);
      }
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Internal: replies to our emails (see moments/inbox.ts).
// ---------------------------------------------------------------------------

function randomSlug(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let i = 0; i < 22; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/**
 * Who someone is, from the address they replied to one of our emails from.
 * A reply from someone new gets a name of their own, so what they add is theirs.
 * Also the idempotency check: one message id is only ever handled once.
 */
export const workspaceForSender = internalMutation({
  args: { email: v.string(), messageId: v.string() },
  returns: v.union(v.object({ canvasId: v.id("canvases"), slug: v.string(), isNew: v.boolean(), duplicate: v.boolean() }), v.null()),
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!EMAIL.test(email)) return null;
    let ws = await ctx.db
      .query("canvases")
      .withIndex("by_emailFrom", (q) => q.eq("emailFrom", email))
      .order("desc")
      .first();
    let isNew = false;
    if (!ws) {
      const id = await ctx.db.insert("canvases", {
        slug: randomSlug(),
        emailFrom: email,
        alias: makeAlias(),
        createdAt: Date.now(),
      });
      ws = await ctx.db.get(id);
      isNew = true;
    }
    if (!ws) return null;
    const seen = await ctx.db
      .query("inboundSeen")
      .withIndex("by_canvas_messageId", (q) => q.eq("canvasId", ws._id).eq("messageId", args.messageId))
      .first();
    if (seen) return { canvasId: ws._id, slug: ws.slug, isNew, duplicate: true };
    await ctx.db.insert("inboundSeen", { canvasId: ws._id, messageId: args.messageId, createdAt: Date.now() });
    return { canvasId: ws._id, slug: ws.slug, isNew, duplicate: false };
  },
});
