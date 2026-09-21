"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { createOpenAI } from "@ai-sdk/openai";
import { embed, embedMany, generateObject } from "ai";
import { z } from "zod";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { FAST, getModel } from "./lib/providers";
import { redactError } from "./lib/redact";
import { trimText } from "./lib/text";
import type { CardForEmbedding, SearchCard } from "./searchStore";

const EMBEDDING_MODEL = "text-embedding-3-small"; // 1536 dims, matches schema
const EMBED_BODY_MAX = 1500;
const QUERY_MAX = 200;
const VECTOR_LIMIT = 32;
const MIN_SCORE = 0.3;
const RESULTS_MAX = 12;

const vIntent = v.union(v.literal("visual"), v.literal("quotes"), v.literal("reading"), v.literal("any"));
type Intent = "visual" | "quotes" | "reading" | "any";
type StaleResult = { stale: number; embedded: number; touched: number };
type QueryResult = { subject: string; intent: Intent; results: { cardId: Id<"cards">; score: number }[] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function embeddingModel() {
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai.embedding(EMBEDDING_MODEL);
}

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel(), value: text });
  return embedding;
}

/** The text that gets embedded for a card: title, caption, type, quote, domain, board, body. */
export function cardText({ card, boardTitle, boardPrompt }: CardForEmbedding): string {
  const lines: string[] = [];
  const push = (label: string, value: string | undefined | null) => {
    const s = trimText(value, 400);
    if (s) lines.push(`${label}: ${s}`);
  };
  push("Title", card.title);
  push("Caption", card.caption);
  push("Type", card.type);
  push("Quote", card.quote);
  push("Domain", card.domain);
  push("Board", boardTitle);
  if (boardPrompt && boardPrompt !== boardTitle) push("Board prompt", boardPrompt);
  const body = trimText(card.body, EMBED_BODY_MAX);
  if (body) lines.push(`Body: ${body}`);
  return lines.join("\n");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Embed one card (or drop its row when archived / empty). Returns what happened. */
async function embedOne(
  ctx: ActionCtx,
  entry: CardForEmbedding,
): Promise<"skipped" | "embedded" | "deleted"> {
  const { card } = entry;
  if (card.kind === "archived") {
    await ctx.runMutation(internal.searchStore.deleteEmbeddingByCard, { cardId: card._id });
    return "deleted";
  }
  const text = cardText(entry);
  if (!text) {
    await ctx.runMutation(internal.searchStore.deleteEmbeddingByCard, { cardId: card._id });
    return "deleted";
  }
  const hash = sha256(text);
  const existing: Doc<"cardEmbeddings"> | null = await ctx.runQuery(internal.searchStore.getEmbeddingByCard, {
    cardId: card._id,
  });
  const now = Date.now();
  if (existing && existing.hash === hash) {
    if (existing.updatedAt < card.updatedAt) {
      await ctx.runMutation(internal.searchStore.touchEmbedding, { cardId: card._id, updatedAt: now });
    }
    return "skipped";
  }
  const embedding = await embedText(text);
  await ctx.runMutation(internal.searchStore.upsertEmbedding, {
    canvasId: card.canvasId,
    cardId: card._id,
    hash,
    embedding,
    updatedAt: now,
  });
  return "embedded";
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

/** Re-embed one card if its text changed; archived cards lose their row. Idempotent. */
export const embedCard = internalAction({
  args: { cardId: v.id("cards") },
  returns: v.union(v.literal("skipped"), v.literal("embedded"), v.literal("deleted"), v.literal("missing")),
  handler: async (ctx, args): Promise<"skipped" | "embedded" | "deleted" | "missing"> => {
    const entry: CardForEmbedding | null = await ctx.runQuery(internal.searchStore.getCardForEmbedding, { cardId: args.cardId });
    if (!entry) {
      await ctx.runMutation(internal.searchStore.deleteEmbeddingByCard, { cardId: args.cardId });
      return "missing";
    }
    try {
      return await embedOne(ctx, entry);
    } catch (err) {
      throw new Error(`embedCard failed: ${redactError(err)}`);
    }
  },
});

/**
 * Embed every stale card on a canvas (missing embedding, or card updated
 * since) in one embedMany call. Safe to run repeatedly: unchanged text is
 * only touched, not re-embedded. Returns how many were stale on entry.
 */
export const embedStale = internalAction({
  args: { canvasId: v.id("canvases") },
  returns: v.object({ stale: v.number(), embedded: v.number(), touched: v.number() }),
  handler: async (ctx, args): Promise<StaleResult> => {
    const entries: CardForEmbedding[] = await ctx.runQuery(internal.searchStore.listStaleCards, { canvasId: args.canvasId });
    const now = Date.now();
    const toEmbed: { entry: CardForEmbedding; text: string; hash: string }[] = [];
    let touched = 0;
    for (const entry of entries) {
      const text = cardText(entry);
      if (!text) continue;
      const hash = sha256(text);
      const existing: Doc<"cardEmbeddings"> | null = await ctx.runQuery(
        internal.searchStore.getEmbeddingByCard,
        { cardId: entry.card._id },
      );
      if (existing && existing.hash === hash) {
        await ctx.runMutation(internal.searchStore.touchEmbedding, { cardId: entry.card._id, updatedAt: now });
        touched++;
        continue;
      }
      toEmbed.push({ entry, text, hash });
    }
    if (toEmbed.length === 0) return { stale: entries.length, embedded: 0, touched };
    let embeddings: number[][];
    try {
      const res = await embedMany({ model: embeddingModel(), values: toEmbed.map((t) => t.text) });
      embeddings = res.embeddings;
    } catch (err) {
      throw new Error(`embedStale failed: ${redactError(err)}`);
    }
    let embedded = 0;
    for (let i = 0; i < toEmbed.length; i++) {
      const { entry, hash } = toEmbed[i];
      const embedding = embeddings[i];
      if (!embedding) continue;
      await ctx.runMutation(internal.searchStore.upsertEmbedding, {
        canvasId: entry.card.canvasId,
        cardId: entry.card._id,
        hash,
        embedding,
        updatedAt: now,
      });
      embedded++;
    }
    return { stale: entries.length, embedded, touched };
  },
});

const QuerySpec = z.object({
  subject: z
    .string()
    .describe(
      "A rich one-sentence retrieval description of what the person is looking for, expanded with likely synonyms and related terms.",
    ),
  intent: z
    .enum(["visual", "quotes", "reading", "any"])
    .describe(
      '"visual" when they want pictures, references, inspiration, examples, moodboards; "quotes" for lines or sayings; "reading" for articles, docs, guides; else "any".',
    ),
});

async function expandQuery(q: string): Promise<{ subject: string; intent: Intent }> {
  try {
    const { object } = await generateObject({
      model: getModel(),
      schema: QuerySpec,
      providerOptions: FAST,
      prompt:
        "You turn a short search box query over someone's saved links (articles, images, products, quotes, tools) into a retrieval spec.\n" +
        "Write `subject` as one dense sentence describing what they want, expanded with synonyms and closely related terms so an embedding search finds it. " +
        'Example: "swift ui orb inspo" -> "SwiftUI orb and sphere visuals: Metal shaders, glowing gradient spheres, animated blobs, glass orbs, iOS UI inspiration references".\n' +
        "Pick `intent`: visual (pictures, references, inspiration, examples, moodboards), quotes (lines or sayings), reading (articles, docs, guides), else any.\n\n" +
        `Query: ${q}`,
    });
    const subject = trimText(object.subject, 600) || q;
    return { subject, intent: object.intent };
  } catch (err) {
    console.warn("search expand fallback:", redactError(err));
    return { subject: q, intent: "any" };
  }
}

const RerankSpec = z.object({
  keep: z.array(z.number().int()).describe("Indices of entries that genuinely answer the query, best first."),
});

async function rerank(
  q: string,
  subject: string,
  intent: Intent,
  cards: SearchCard[],
): Promise<number[] | null> {
  const listing = cards
    .map((c, i) => {
      const parts = [
        `${i}. ${trimText(c.title, 120)}`,
        c.caption ? `caption: ${trimText(c.caption, 100)}` : "",
        c.type ? `type: ${c.type}` : "",
        c.domain ? `domain: ${c.domain}` : "",
        c.quote ? `quote: ${trimText(c.quote, 160)}` : "",
        `hasImage: ${c.imageUrl ? "yes" : "no"}`,
      ].filter(Boolean);
      return parts.join(" | ");
    })
    .join("\n");
  try {
    const { object } = await generateObject({
      model: getModel(),
      schema: RerankSpec,
      providerOptions: FAST,
      prompt:
        "Rerank saved-link search candidates.\n" +
        `Query: ${q}\nSubject: ${subject}\nIntent: ${intent}\n\n` +
        "Return `keep`: the indices that directly answer the query, best first. Be strict: this is a personal " +
        "library and the person wants a short, precise set, not everything nearby. Drop generic collections, " +
        "adjacent topics, and anything that only shares a broad category with the subject. General-purpose " +
        "inspiration hubs and portfolio sites (galleries, showcases, template libraries) count only when the query " +
        "is about them, not because they might contain the subject somewhere. An empty list is a " +
        "valid answer. When intent is visual, prefer entries with hasImage yes, but keep text entries that match strongly. " +
        `Return at most ${RESULTS_MAX} indices.\n\nCandidates:\n${listing}`,
    });
    const seen = new Set<number>();
    const out: number[] = [];
    for (const i of object.keep) {
      if (!Number.isInteger(i) || i < 0 || i >= cards.length || seen.has(i)) continue;
      seen.add(i);
      out.push(i);
      if (out.length >= RESULTS_MAX) break;
    }
    return out;
  } catch (err) {
    console.warn("search rerank fallback:", redactError(err));
    return null;
  }
}

/**
 * Semantic search over a canvas's cards: expand the query with gpt-5-mini,
 * embed it, vector-search cardEmbeddings, then rerank the hits. Results are
 * card ids in rank order with their cosine similarity.
 */
export const query = action({
  args: { canvasId: v.id("canvases"), q: v.string() },
  returns: v.object({
    subject: v.string(),
    intent: vIntent,
    results: v.array(v.object({ cardId: v.id("cards"), score: v.number() })),
  }),
  handler: async (ctx, args): Promise<QueryResult> => {
    const q = args.q.replace(/\s+/g, " ").trim().slice(0, QUERY_MAX);
    if (!q) return { subject: "", intent: "any" as const, results: [] };

    // Two searches at once: the raw words right away, and the model's
    // expanded subject as soon as it lands. Their hits merge by best score.
    const search = async (text: string) => {
      const vector = await embedText(text);
      return await ctx.vectorSearch("cardEmbeddings", "by_embedding", {
        vector,
        limit: VECTOR_LIMIT,
        filter: (f) => f.eq("canvasId", args.canvasId),
      });
    };
    const expanded = expandQuery(q);
    const [rawHits, subjectSearch] = await Promise.all([
      search(q).catch((err) => {
        throw new Error(`search embed failed: ${redactError(err)}`);
      }),
      expanded.then(async ({ subject, intent }) => ({
        subject,
        intent,
        hits: subject === q ? [] : await search(subject).catch(() => []),
      })),
    ]);
    const { subject, intent } = subjectSearch;
    const best = new Map<Id<"cardEmbeddings">, number>();
    for (const h of [...rawHits, ...subjectSearch.hits]) {
      const prev = best.get(h._id);
      if (prev === undefined || h._score > prev) best.set(h._id, h._score);
    }
    const hits = Array.from(best, ([_id, _score]) => ({ _id, _score })).sort((a, b) => b._score - a._score);
    const scored = hits.filter((h) => h._score >= MIN_SCORE);
    if (scored.length === 0) return { subject, intent, results: [] };

    const rows: { _id: Id<"cardEmbeddings">; cardId: Id<"cards"> }[] = await ctx.runQuery(internal.searchStore.resolveEmbeddingIds, {
      ids: scored.map((h) => h._id),
    });
    const scoreByEmbedding = new Map<Id<"cardEmbeddings">, number>(scored.map((h) => [h._id, h._score]));
    const scoreByCard = new Map<Id<"cards">, number>();
    for (const r of rows) scoreByCard.set(r.cardId, scoreByEmbedding.get(r._id) ?? 0);

    const loaded: SearchCard[] = await ctx.runQuery(internal.searchStore.listCardsByIds, {
      cardIds: rows.map((r) => r.cardId),
    });
    const cards = loaded.filter((c) => c.kind !== "archived");
    // Keep vector order (best first) as the fallback ranking.
    cards.sort((a, b) => (scoreByCard.get(b._id) ?? 0) - (scoreByCard.get(a._id) ?? 0));
    if (cards.length === 0) return { subject, intent, results: [] };

    const kept = await rerank(q, subject, intent, cards);
    const ordered = kept ? kept.map((i) => cards[i]) : cards.slice(0, RESULTS_MAX);
    return {
      subject,
      intent,
      results: ordered.map((c) => ({ cardId: c._id, score: scoreByCard.get(c._id) ?? 0 })),
    };
  },
});
