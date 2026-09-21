import { v, type Infer } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { vCardDoc } from "./lib/validators";

/** Newest cards scanned per stale sweep (bounded read). */
const STALE_SCAN = 500;
/** Stale cards returned per sweep: one embedMany call. */
const STALE_MAX = 50;
const IDS_MAX = 64;

const vEmbeddingDoc = v.object({
  _id: v.id("cardEmbeddings"),
  _creationTime: v.number(),
  canvasId: v.id("canvases"),
  cardId: v.id("cards"),
  hash: v.string(),
  embedding: v.array(v.float64()),
  updatedAt: v.number(),
});

/** Card plus its board title and prompt : everything `search.embedCard` needs. */
export const vCardForEmbedding = v.object({
  card: vCardDoc,
  boardTitle: v.union(v.string(), v.null()),
  boardPrompt: v.union(v.string(), v.null()),
});
export type CardForEmbedding = Infer<typeof vCardForEmbedding>;

/** Compact card returned to the search action for reranking and display. */
export const vSearchCard = v.object({
  _id: v.id("cards"),
  title: v.string(),
  caption: v.union(v.string(), v.null()),
  type: v.union(v.string(), v.null()),
  domain: v.union(v.string(), v.null()),
  quote: v.union(v.string(), v.null()),
  kind: v.string(),
  imageUrl: v.union(v.string(), v.null()),
  boardId: v.union(v.id("boards"), v.null()),
  inFocus: v.boolean(),
});
export type SearchCard = Infer<typeof vSearchCard>;

/** Board title + prompt for a card. */
async function boardText(
  ctx: QueryCtx,
  card: Doc<"cards">,
): Promise<{ boardTitle: string | null; boardPrompt: string | null }> {
  if (card.boardId) {
    const board = await ctx.db.get(card.boardId);
    if (board) return { boardTitle: board.title, boardPrompt: board.prompt || null };
  }
  return { boardTitle: null, boardPrompt: null };
}

function toSearchCard(c: Doc<"cards">): SearchCard {
  return {
    _id: c._id,
    title: c.title,
    caption: c.caption ?? null,
    type: c.type ?? null,
    domain: c.domain ?? null,
    quote: c.quote ?? null,
    kind: c.kind,
    imageUrl: c.imageUrl ?? null,
    boardId: c.boardId ?? null,
    inFocus: c.inFocus ?? false,
  };
}

/** Delete a card's embedding row (if any). Never throws; safe to call on every card delete. */
export async function deleteEmbeddingForCard(ctx: MutationCtx, cardId: Id<"cards">): Promise<void> {
  const row = await ctx.db
    .query("cardEmbeddings")
    .withIndex("by_card", (q) => q.eq("cardId", cardId))
    .first();
  if (row) await ctx.db.delete(row._id);
}

export const getCardForEmbedding = internalQuery({
  args: { cardId: v.id("cards") },
  returns: v.union(vCardForEmbedding, v.null()),
  handler: async (ctx, args): Promise<CardForEmbedding | null> => {
    const card = await ctx.db.get(args.cardId);
    if (!card) return null;
    return { card, ...(await boardText(ctx, card)) };
  },
});

export const getEmbeddingByCard = internalQuery({
  args: { cardId: v.id("cards") },
  returns: v.union(vEmbeddingDoc, v.null()),
  handler: async (ctx, args): Promise<Doc<"cardEmbeddings"> | null> => {
    return await ctx.db
      .query("cardEmbeddings")
      .withIndex("by_card", (q) => q.eq("cardId", args.cardId))
      .first();
  },
});

/** Insert or replace the embedding for a card (one row per card). */
export const upsertEmbedding = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    cardId: v.id("cards"),
    hash: v.string(),
    embedding: v.array(v.float64()),
    updatedAt: v.number(),
  },
  returns: v.id("cardEmbeddings"),
  handler: async (ctx, args): Promise<Id<"cardEmbeddings">> => {
    const existing = await ctx.db
      .query("cardEmbeddings")
      .withIndex("by_card", (q) => q.eq("cardId", args.cardId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        canvasId: args.canvasId,
        hash: args.hash,
        embedding: args.embedding,
        updatedAt: args.updatedAt,
      });
      return existing._id;
    }
    return await ctx.db.insert("cardEmbeddings", args);
  },
});

/** Bump updatedAt when the text hash is unchanged so the card stops showing as stale. */
export const touchEmbedding = internalMutation({
  args: { cardId: v.id("cards"), updatedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query("cardEmbeddings")
      .withIndex("by_card", (q) => q.eq("cardId", args.cardId))
      .first();
    if (existing) await ctx.db.patch(existing._id, { updatedAt: args.updatedAt });
    return null;
  },
});

export const deleteEmbeddingByCard = internalMutation({
  args: { cardId: v.id("cards") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await deleteEmbeddingForCard(ctx, args.cardId);
    return null;
  },
});

/** Map vector-search hits (embedding ids) back to their card ids. Max 64. */
export const resolveEmbeddingIds = internalQuery({
  args: { ids: v.array(v.id("cardEmbeddings")) },
  returns: v.array(v.object({ _id: v.id("cardEmbeddings"), cardId: v.id("cards") })),
  handler: async (ctx, args) => {
    const out: { _id: Id<"cardEmbeddings">; cardId: Id<"cards"> }[] = [];
    for (const id of args.ids.slice(0, IDS_MAX)) {
      const row = await ctx.db.get(id);
      if (row) out.push({ _id: row._id, cardId: row.cardId });
    }
    return out;
  },
});

/** Compact cards by id, in the order given; missing ids are skipped. Max 64. */
export const listCardsByIds = internalQuery({
  args: { cardIds: v.array(v.id("cards")) },
  returns: v.array(vSearchCard),
  handler: async (ctx, args): Promise<SearchCard[]> => {
    const out: SearchCard[] = [];
    for (const id of args.cardIds.slice(0, IDS_MAX)) {
      const c = await ctx.db.get(id);
      if (c) out.push(toSearchCard(c));
    }
    return out;
  },
});

/**
 * Cards (newest 500 scanned) whose embedding is missing or older than the
 * card's updatedAt, excluding archived ones. Max 50 per call.
 */
export const listStaleCards = internalQuery({
  args: { canvasId: v.id("canvases") },
  returns: v.array(vCardForEmbedding),
  handler: async (ctx, args): Promise<CardForEmbedding[]> => {
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_canvas_createdAt", (q) => q.eq("canvasId", args.canvasId))
      .order("desc")
      .take(STALE_SCAN);
    const out: CardForEmbedding[] = [];
    for (const card of cards) {
      if (card.kind === "archived") continue;
      const emb = await ctx.db
        .query("cardEmbeddings")
        .withIndex("by_card", (q) => q.eq("cardId", card._id))
        .first();
      if (emb && emb.updatedAt >= card.updatedAt) continue;
      out.push({ card, ...(await boardText(ctx, card)) });
      if (out.length >= STALE_MAX) break;
    }
    return out;
  },
});

/** Recent canvases for embed sweeps (private workspaces). */
export const listCanvasIds = internalQuery({
  args: { limit: v.number() },
  returns: v.array(v.id("canvases")),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("canvases").order("desc").take(Math.min(200, Math.max(1, args.limit)));
    return rows.map((c) => c._id);
  },
});
