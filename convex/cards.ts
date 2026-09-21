import { ConvexError, v, type Infer } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { normalizeUrl, urlHost } from "./lib/footer";
import {
  CAPTION_MAX,
  MAX_CARDS_PER_BOARD,
  MAX_NEW_CARDS_PER_ROUND,
  QUOTE_MAX,
  WHY_MAX,
} from "./lib/limits";
import { redact, redactBody, truncateBody } from "./lib/redact";
import { trimText } from "./lib/text";
import { CARD_TYPES, vCardDoc, vCardView } from "./lib/validators";
import { deleteEmbeddingForCard } from "./searchStore";

const MAX_LIST_CARDS = 600;
const LIST_BODY_MAX = 600;
/** Stored body: the summary plus enough page text to embed. Larger bodies were reread on every card change. */
const BODY_MAX = 1500;

export function toCardView(card: Doc<"cards">) {
  return {
    ...card,
    body: truncateBody(card.body, LIST_BODY_MAX),
    bodyLength: card.body.length,
  };
}

/** Queue a re-embed for semantic search after a text-changing write. Never throws. */
export async function scheduleEmbed(ctx: MutationCtx, cardId: Id<"cards">): Promise<void> {
  try {
    await ctx.scheduler.runAfter(0, internal.search.embedCard, { cardId });
  } catch (err) {
    console.warn("embed schedule skipped:", redact(err instanceof Error ? err.message : String(err)));
  }
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** Newest 600 cards on a canvas, bodies cut to 600 chars (bodyLength has the full size). */
export const listByCanvas = query({
  args: { canvasId: v.id("canvases") },
  returns: v.array(vCardView),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("cards")
      .withIndex("by_canvas_createdAt", (q) => q.eq("canvasId", args.canvasId))
      .order("desc")
      .take(MAX_LIST_CARDS);
    return rows.map(toCardView);
  },
});

export const get = query({
  args: { cardId: v.id("cards") },
  returns: v.union(vCardDoc, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.cardId);
  },
});

export const archive = mutation({
  args: { cardId: v.id("cards") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) throw new ConvexError("card not found");
    await ctx.db.patch(card._id, { kind: "archived", inFocus: false, updatedAt: Date.now() });
    await scheduleEmbed(ctx, card._id);
    return null;
  },
});

/** Back to "source" (or "raw" if it was never read), kept. */
export const restore = mutation({
  args: { cardId: v.id("cards") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) throw new ConvexError("card not found");
    const read = card.status === "ready" || card.type !== undefined || card.focusScore !== undefined;
    await ctx.db.patch(card._id, { kind: read ? "source" : "raw", inFocus: true, updatedAt: Date.now() });
    await scheduleEmbed(ctx, card._id);
    return null;
  },
});

export const remove = mutation({
  args: { cardId: v.id("cards") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (card) {
      await deleteEmbeddingForCard(ctx, card._id);
      await ctx.db.delete(card._id);
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Internal: find
// ---------------------------------------------------------------------------

/**
 * Insert found cards (already normalised) on the run's board: deduped by
 * board + url, capped per round and per board. Returns created ids and how
 * many were new per query.
 */
export const insertFound = internalMutation({
  args: {
    runId: v.id("runs"),
    items: v.array(
      v.object({
        url: v.string(),
        title: v.string(),
        description: v.string(),
        query: v.string(),
        // Set when the hit came from an image search: the picture itself, known to be large.
        imageUrl: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    cardIds: v.array(v.id("cards")),
    perQuery: v.array(v.object({ query: v.string(), added: v.number() })),
  }),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    const empty = { cardIds: [], perQuery: [] };
    if (!run || run.stage === "done" || run.stage === "failed") return empty;
    const board = await ctx.db.get(run.boardId);
    if (!board) return empty;
    const onBoard = await ctx.db
      .query("cards")
      .withIndex("by_board", (q) => q.eq("boardId", board._id))
      .take(MAX_CARDS_PER_BOARD + 1);
    let room = Math.min(MAX_NEW_CARDS_PER_ROUND, MAX_CARDS_PER_BOARD - onBoard.length);
    const now = Date.now();
    const cardIds: Id<"cards">[] = [];
    const perQuery = new Map<string, number>();
    for (const item of args.items.slice(0, 60)) {
      if (!perQuery.has(item.query)) perQuery.set(item.query, 0);
      if (room <= 0) continue;
      const url = normalizeUrl(item.url);
      if (!url) continue;
      const dupe = await ctx.db
        .query("cards")
        .withIndex("by_board_url", (q) => q.eq("boardId", board._id).eq("url", url))
        .first();
      if (dupe) continue;
      const id = await ctx.db.insert("cards", {
        canvasId: board.canvasId,
        boardId: board._id,
        runId: run._id,
        status: "new",
        source: "found",
        query: trimText(item.query, 200),
        kind: "raw",
        title: trimText(redactBody(item.title), 200) || urlHost(url) || url.slice(0, 200),
        body: truncateBody(redactBody(item.description.trim()), 600),
        url,
        domain: urlHost(url),
        ...(item.imageUrl && /^https?:\/\//i.test(item.imageUrl) ? { imageUrl: item.imageUrl.slice(0, 2000) } : {}),
        createdAt: now,
        updatedAt: now,
      });
      cardIds.push(id);
      perQuery.set(item.query, (perQuery.get(item.query) ?? 0) + 1);
      room--;
    }
    return { cardIds, perQuery: Array.from(perQuery, ([query, added]) => ({ query, added })) };
  },
});

// ---------------------------------------------------------------------------
// Internal: read
// ---------------------------------------------------------------------------

/** Claim a card for reading. Null when it is gone, not waiting, or its run ended. */
export const markReading = internalMutation({
  args: { runId: v.id("runs"), cardId: v.id("cards") },
  returns: v.union(
    v.object({
      url: v.union(v.string(), v.null()),
      title: v.string(),
      domain: v.string(),
      description: v.string(),
      hasImage: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.stage === "done" || run.stage === "failed") return null;
    const card = await ctx.db.get(args.cardId);
    if (!card || card.boardId !== run.boardId || card.status !== "new") return null;
    await ctx.db.patch(card._id, { status: "reading", runId: run._id, updatedAt: Date.now() });
    return {
      url: card.url ?? null,
      title: card.title,
      domain: card.domain ?? (card.url ? urlHost(card.url) : ""),
      description: (card.body ?? "").slice(0, 600),
      hasImage: Boolean(card.imageUrl),
    };
  },
});

export const applyRead = internalMutation({
  args: {
    cardId: v.id("cards"),
    title: v.string(),
    caption: v.string(),
    type: v.string(),
    quote: v.string(),
    body: v.string(),
    imageUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) return null;
    const type = (CARD_TYPES as readonly string[]).includes(args.type) ? args.type : "other";
    const caption = redact(args.caption.replace(/\s+/g, " ").trim(), CAPTION_MAX);
    const quote = redact(args.quote.replace(/\s+/g, " ").trim(), QUOTE_MAX);
    const imageUrl =
      args.imageUrl && /^https?:\/\//i.test(args.imageUrl) ? args.imageUrl.slice(0, 2000) : undefined;
    await ctx.db.patch(card._id, {
      status: "ready",
      // Never un-archive a card the human archived.
      kind: card.kind === "archived" ? "archived" : "source",
      title: trimText(redactBody(args.title), 120) || card.title,
      caption: caption || undefined,
      type,
      quote: quote || undefined,
      body: truncateBody(redactBody(args.body), BODY_MAX),
      // A picture found by image search is the one that matched; it beats the page's og image.
      imageUrl: card.imageUrl ?? imageUrl,
      domain: card.url ? urlHost(card.url) : card.domain,
      updatedAt: Date.now(),
    });
    await scheduleEmbed(ctx, card._id);
    return null;
  },
});

export const markFailed = internalMutation({
  args: { cardId: v.id("cards") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card || card.status === "ready") return null;
    await ctx.db.patch(card._id, { status: "failed", updatedAt: Date.now() });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Internal: sort, mail
// ---------------------------------------------------------------------------

const vCardBrief = v.object({
  _id: v.id("cards"),
  title: v.string(),
  url: v.union(v.string(), v.null()),
  caption: v.union(v.string(), v.null()),
  type: v.union(v.string(), v.null()),
  domain: v.union(v.string(), v.null()),
  quote: v.union(v.string(), v.null()),
  summary: v.string(),
  hasImage: v.boolean(),
  inFocus: v.boolean(),
  why: v.union(v.string(), v.null()),
});

export type CardBrief = Infer<typeof vCardBrief>;

function brief(c: Doc<"cards">): CardBrief {
  return {
    _id: c._id,
    title: c.title,
    url: c.url ?? null,
    caption: c.caption ?? null,
    type: c.type ?? null,
    domain: c.domain ?? null,
    quote: c.quote ?? null,
    summary: trimText(c.body.split("\n\n")[0] ?? "", 300),
    hasImage: Boolean(c.imageUrl),
    inFocus: c.inFocus === true,
    why: c.focusReason ?? null,
  };
}

/** Cards on a board with a status (not archived, not twins), newest first. */
export const listForBoard = internalQuery({
  args: {
    boardId: v.id("boards"),
    status: v.union(v.literal("new"), v.literal("ready")),
    keptOnly: v.optional(v.boolean()),
    limit: v.number(),
  },
  returns: v.array(vCardBrief),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(60, Math.floor(args.limit) || 1));
    const rows = await ctx.db
      .query("cards")
      .withIndex("by_board_status", (q) => q.eq("boardId", args.boardId).eq("status", args.status))
      .order("desc")
      .take(MAX_CARDS_PER_BOARD);
    return rows
      .filter((c) => c.kind !== "archived" && !c.twinOf && (!args.keptOnly || c.inFocus === true))
      .slice(0, limit)
      .map(brief);
  },
});

/** Sorter's verdicts. Returns how many ready cards on the board are kept afterwards. */
export const applyVerdicts = internalMutation({
  args: {
    boardId: v.id("boards"),
    verdicts: v.array(v.object({ cardId: v.id("cards"), fit: v.number(), keep: v.boolean(), why: v.string() })),
  },
  returns: v.object({ kept: v.number(), total: v.number() }),
  handler: async (ctx, args) => {
    for (const verdict of args.verdicts.slice(0, 60)) {
      const card = await ctx.db.get(verdict.cardId);
      if (!card || card.boardId !== args.boardId) continue;
      const fit = Number.isFinite(verdict.fit) ? Math.max(0, Math.min(1, verdict.fit)) : 0;
      await ctx.db.patch(card._id, {
        focusScore: fit,
        inFocus: card.kind === "archived" ? false : verdict.keep,
        focusReason: redact(verdict.why.replace(/\s+/g, " ").trim(), WHY_MAX),
      });
    }
    const ready = await ctx.db
      .query("cards")
      .withIndex("by_board_status", (q) => q.eq("boardId", args.boardId).eq("status", "ready"))
      .take(300);
    const live = ready.filter((c) => c.kind !== "archived");
    return { kept: live.filter((c) => c.inFocus === true).length, total: live.length };
  },
});

// ---------------------------------------------------------------------------
// Internal: crew (twin spotter, grouper, link follower)
// ---------------------------------------------------------------------------

/** Ready, non-archived cards on a board, oldest first, with the fields twin checks need. */
export const twinCandidates = internalQuery({
  args: { boardId: v.id("boards") },
  returns: v.array(
    v.object({
      _id: v.id("cards"),
      title: v.string(),
      url: v.union(v.string(), v.null()),
      domain: v.union(v.string(), v.null()),
      imageUrl: v.union(v.string(), v.null()),
      twinOf: v.union(v.id("cards"), v.null()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("cards")
      .withIndex("by_board_status", (q) => q.eq("boardId", args.boardId).eq("status", "ready"))
      .take(MAX_CARDS_PER_BOARD);
    return rows
      .filter((c) => c.kind !== "archived")
      .sort((a, b) => a.createdAt - b.createdAt || a._creationTime - b._creationTime)
      .map((c) => ({
        _id: c._id,
        title: c.title,
        url: c.url ?? null,
        domain: c.domain ?? null,
        imageUrl: c.imageUrl ?? null,
        twinOf: c.twinOf ?? null,
        createdAt: c.createdAt,
      }));
  },
});

/** Mark newer cards as twins of older ones: set aside, with a reason. */
export const markTwins = internalMutation({
  args: {
    boardId: v.id("boards"),
    twins: v.array(v.object({ cardId: v.id("cards"), twinOf: v.id("cards"), reason: v.string() })),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    let marked = 0;
    for (const t of args.twins.slice(0, MAX_CARDS_PER_BOARD)) {
      if (t.cardId === t.twinOf) continue;
      const card = await ctx.db.get(t.cardId);
      const older = await ctx.db.get(t.twinOf);
      if (!card || !older || card.boardId !== args.boardId || older.boardId !== args.boardId) continue;
      await ctx.db.patch(card._id, {
        twinOf: older._id,
        inFocus: false,
        focusReason: redact(t.reason.replace(/\s+/g, " ").trim(), WHY_MAX),
        section: undefined,
        updatedAt: Date.now(),
      });
      marked++;
    }
    return marked;
  },
});

const SECTION_MAX = 24;

/** Set the grouper's sections on kept cards; clear sections on every other card on the board. */
export const applySections = internalMutation({
  args: {
    boardId: v.id("boards"),
    groups: v.array(v.object({ cardId: v.id("cards"), section: v.string() })),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const wanted = new Map<string, string>();
    for (const g of args.groups.slice(0, MAX_CARDS_PER_BOARD)) {
      const name = g.section.replace(/\s+/g, " ").trim().slice(0, SECTION_MAX).trim();
      if (name) wanted.set(g.cardId, name);
    }
    const rows = await ctx.db
      .query("cards")
      .withIndex("by_board", (q) => q.eq("boardId", args.boardId))
      .take(300);
    let set = 0;
    for (const c of rows) {
      const kept = c.status === "ready" && c.inFocus === true && c.kind !== "archived" && !c.twinOf;
      const next = kept ? wanted.get(c._id) : undefined;
      if (next === c.section) {
        if (next) set++;
        continue;
      }
      await ctx.db.patch(c._id, { section: next });
      if (next) set++;
    }
    return set;
  },
});

/** Up to `limit` kept cards with a url and a body, highest fit first, with their full body. */
export const followSources = internalQuery({
  args: { boardId: v.id("boards"), limit: v.number() },
  returns: v.array(
    v.object({ _id: v.id("cards"), title: v.string(), url: v.string(), body: v.string() }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(10, Math.floor(args.limit) || 1));
    const rows = await ctx.db
      .query("cards")
      .withIndex("by_board_status", (q) => q.eq("boardId", args.boardId).eq("status", "ready"))
      .take(MAX_CARDS_PER_BOARD);
    return rows
      .filter((c) => c.inFocus === true && c.kind !== "archived" && !c.twinOf && c.url && c.body.trim())
      .sort((a, b) => (b.focusScore ?? 0) - (a.focusScore ?? 0))
      .slice(0, limit)
      .map((c) => ({ _id: c._id, title: c.title, url: c.url as string, body: c.body }));
  },
});
