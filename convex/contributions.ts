/**
 * Adding to someone else's circle: a note, a memory, a photo of your own, or
 * a reaction. Each one becomes a small thing drawn on the circle's outer ring,
 * so the circle visibly grows because of you. Small Circles reads notes and
 * photos first (to pick a drawing, and to keep out anything unkind).
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { aliasOf } from "./circles";
import { workspace } from "./lib/access";
import { vContributionType } from "./lib/circleFields";
import { FIRST_DRAWING, reactionFor } from "./lib/reactions";
import { isDoodleId } from "./lib/vocabulary";
import { emitEvent } from "./agent/store";

const MAX_PER_PERSON_PER_CIRCLE = 3;
const MAX_PER_PERSON_PER_HOUR = 30;
const MAX_PER_CIRCLE = 60;
const MAX_TEXT = 120;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const HOUR = 60 * 60 * 1000;

/** First few words, for the label under a drawing until Small Circles writes a better one. */
function firstWords(text: string): string {
  return text.split(" ").slice(0, 3).join(" ").slice(0, 28);
}

export const add = mutation({
  args: {
    slug: v.string(),
    circleId: v.id("circles"),
    type: vContributionType,
    text: v.optional(v.string()),
    /** A reaction's drawing. */
    reaction: v.optional(v.string()),
    /** A related photo, already uploaded. */
    storageId: v.optional(v.id("_storage")),
  },
  returns: v.id("contributions"),
  handler: async (ctx, args) => {
    const ws = await workspace(ctx, args.slug);
    if (!ws) throw new ConvexError("open small circles again to add to this.");
    const circle = await ctx.db.get(args.circleId);
    if (!circle || circle.released !== true) throw new ConvexError("this moment isn't here any more.");
    if (circle.canvasId === ws._id) throw new ConvexError("this one's yours. other people add to it.");

    const now = Date.now();
    const mineHere = await ctx.db
      .query("contributions")
      .withIndex("by_circle_canvas", (q) => q.eq("circleId", circle._id).eq("canvasId", ws._id))
      .take(MAX_PER_PERSON_PER_CIRCLE);
    if (mineHere.length >= MAX_PER_PERSON_PER_CIRCLE) throw new ConvexError("you've added plenty to this one. find another?");
    const lastHour = await ctx.db
      .query("contributions")
      .withIndex("by_canvas", (q) => q.eq("canvasId", ws._id).gt("createdAt", now - HOUR))
      .take(MAX_PER_PERSON_PER_HOUR);
    if (lastHour.length >= MAX_PER_PERSON_PER_HOUR) throw new ConvexError("that's a lot for one hour. come back in a bit.");
    if ((circle.contributionCount ?? 0) >= MAX_PER_CIRCLE) throw new ConvexError("this circle is full.");

    const text = args.text?.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) ?? "";
    let illustration: string;
    let label: string;
    let state: "reading" | "ok" = "reading";
    let storageId: typeof args.storageId;

    if (args.type === "reaction") {
      const r = args.reaction ? reactionFor(args.reaction) : null;
      if (!r) throw new ConvexError("pick one of the drawings.");
      illustration = r.id;
      label = r.word;
      state = "ok"; // nothing to read: the drawing and the word are ours
    } else if (args.type === "photo") {
      if (!args.storageId) throw new ConvexError("the photo didn't arrive. try again?");
      const file = await ctx.db.system.get(args.storageId);
      if (!file) throw new ConvexError("the photo didn't arrive. try again?");
      if (file.size > MAX_PHOTO_BYTES) throw new ConvexError("that photo is too large (15 MB at most).");
      if (file.contentType && !file.contentType.startsWith("image/")) throw new ConvexError("that needs to be a photo.");
      storageId = args.storageId;
      illustration = FIRST_DRAWING.photo;
      label = text ? firstWords(text) : "a photo";
    } else {
      if (!text) throw new ConvexError("write a few words first.");
      illustration = FIRST_DRAWING[args.type];
      label = firstWords(text);
    }

    const id = await ctx.db.insert("contributions", {
      circleId: circle._id,
      canvasId: ws._id,
      by: await aliasOf(ctx, ws),
      type: args.type,
      ...(text ? { text } : {}),
      illustration,
      label: label.toLowerCase(),
      ...(storageId ? { storageId } : {}),
      state,
      createdAt: now,
    });
    await ctx.db.patch(circle._id, {
      contributionCount: (circle.contributionCount ?? 0) + 1,
      unseen: (circle.unseen ?? 0) + 1,
    });
    if (state === "reading") await ctx.scheduler.runAfter(0, internal.moments.contribute.read, { contributionId: id });
    // A reaction is settled already; anything else tells the circle's agent once it's been read.
    else await emitEvent(ctx, { circleId: circle._id, type: "contribution_added", key: `contrib:${id}`, ref: id });
    return id;
  },
});

/** A contributor takes back what they added. */
export const remove = mutation({
  args: { slug: v.string(), contributionId: v.id("contributions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ws = await workspace(ctx, args.slug);
    const k = await ctx.db.get(args.contributionId);
    if (!ws || !k || k.canvasId !== ws._id) return null;
    await drop(ctx, k._id);
    return null;
  },
});

/** A one-time URL for a related photo. */
export const uploadUrl = mutation({
  args: { slug: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const ws = await workspace(ctx, args.slug);
    if (!ws) throw new ConvexError("unknown workspace");
    return await ctx.storage.generateUploadUrl();
  },
});

// ---------------------------------------------------------------------------
// Internal: Small Circles reading what was added.
// ---------------------------------------------------------------------------

export const forRead = internalQuery({
  args: { contributionId: v.id("contributions") },
  returns: v.union(
    v.object({
      type: vContributionType,
      text: v.union(v.string(), v.null()),
      photoUrl: v.union(v.string(), v.null()),
      circle: v.object({ title: v.string(), reading: v.union(v.string(), v.null()), prompt: v.union(v.string(), v.null()) }),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const k = await ctx.db.get(args.contributionId);
    if (!k) return null;
    const c = await ctx.db.get(k.circleId);
    if (!c) return null;
    return {
      type: k.type,
      text: k.text ?? null,
      photoUrl: k.storageId ? await ctx.storage.getUrl(k.storageId) : null,
      circle: { title: c.title, reading: c.context.reading ?? null, prompt: c.prompt ?? null },
    };
  },
});

/** Read and fine: draw it with the chosen doodle and label. */
export const settle = internalMutation({
  args: { contributionId: v.id("contributions"), illustration: v.optional(v.string()), label: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const k = await ctx.db.get(args.contributionId);
    if (!k) return null;
    const label = args.label?.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 28);
    await ctx.db.patch(k._id, {
      state: "ok",
      ...(args.illustration && isDoodleId(args.illustration) ? { illustration: args.illustration } : {}),
      ...(label ? { label } : {}),
    });
    // Read and kind: now it's part of the circle, and the circle's agent hears about it.
    if (k.state !== "ok") await emitEvent(ctx, { circleId: k.circleId, type: "contribution_added", key: `contrib:${k._id}`, ref: k._id });
    return null;
  },
});

/** Not kind, or not safe: it never reaches the circle. */
export const reject = internalMutation({
  args: { contributionId: v.id("contributions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await drop(ctx, args.contributionId);
    return null;
  },
});

async function drop(ctx: MutationCtx, id: Id<"contributions">) {
  const k = await ctx.db.get(id);
  if (!k) return;
  if (k.storageId) await ctx.storage.delete(k.storageId);
  await ctx.db.delete(k._id);
  const c = await ctx.db.get(k.circleId);
  if (c) {
    await ctx.db.patch(c._id, {
      contributionCount: Math.max(0, (c.contributionCount ?? 1) - 1),
      unseen: Math.max(0, (c.unseen ?? 1) - 1),
    });
  }
}

// ---------------------------------------------------------------------------
// By email: a reply to one of our messages about a circle.
// ---------------------------------------------------------------------------

/**
 * Add what someone emailed to a circle. Called only for replies to our own
 * notification threads, after Small Circles has read the email. The owner may
 * add to their own circle this way (a correction, a memory of their own).
 */
export const fromEmail = internalMutation({
  args: {
    circleId: v.id("circles"),
    canvasId: v.id("canvases"),
    type: v.union(v.literal("memory"), v.literal("note"), v.literal("photo")),
    emailKind: v.string(),
    text: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
  },
  returns: v.union(v.id("contributions"), v.null()),
  handler: async (ctx, a) => {
    const [circle, ws] = await Promise.all([ctx.db.get(a.circleId), ctx.db.get(a.canvasId)]);
    if (!circle || !ws) return null;
    const isOwner = circle.canvasId === ws._id;
    if (!isOwner && circle.released !== true) return null;
    const mine = await ctx.db
      .query("contributions")
      .withIndex("by_circle_canvas", (q) => q.eq("circleId", circle._id).eq("canvasId", ws._id))
      .take(MAX_PER_PERSON_PER_CIRCLE + 2);
    if (mine.length >= MAX_PER_PERSON_PER_CIRCLE + (isOwner ? 2 : 0)) return null;
    if ((circle.contributionCount ?? 0) >= MAX_PER_CIRCLE) return null;
    const text = a.text?.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) ?? "";
    if (!text && !a.storageId) return null;
    const id = await ctx.db.insert("contributions", {
      circleId: circle._id,
      canvasId: ws._id,
      by: await aliasOf(ctx, ws),
      type: a.type,
      ...(text ? { text } : {}),
      illustration: FIRST_DRAWING[a.type],
      label: (text ? firstWords(text) : "a photo").toLowerCase(),
      ...(a.storageId ? { storageId: a.storageId } : {}),
      state: "reading",
      via: "email",
      emailKind: a.emailKind.slice(0, 20),
      createdAt: Date.now(),
    });
    await ctx.db.patch(circle._id, {
      contributionCount: (circle.contributionCount ?? 0) + 1,
      ...(isOwner ? {} : { unseen: (circle.unseen ?? 0) + 1 }),
    });
    // Read (and kept kind) before it's drawn; the circle's agent hears once it settles.
    await ctx.scheduler.runAfter(0, internal.moments.contribute.read, { contributionId: id });
    return id;
  },
});
