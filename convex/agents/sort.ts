"use node";
import { generateObject } from "ai";
import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { RunContext } from "../runs";
import type { CardBrief } from "../cards";
import type { Id } from "../_generated/dataModel";
import { KEEP_TARGET, WHY_MAX } from "../lib/limits";
import { describeProviderError, FAST, getModel, withTimeout } from "../lib/providers";
import { trimText } from "../lib/text";
import { briefText, parseBrief } from "./brief";

const MAX_SORT = 40;
const MODEL_TIMEOUT_MS = 90_000;

const Verdicts = z.object({
  verdicts: z.array(
    z.object({
      i: z.number().int().describe("Index of the card in the list."),
      fit: z.number().describe("How well the card fits the board, 0 to 1."),
      keep: z.boolean().describe("Keep it on the board."),
      why: z.string().describe(`One short reason, under ${WHY_MAX} characters.`),
    }),
  ),
  needMore: z.boolean().describe("True when the board still lacks enough strong references."),
  hints: z.array(z.string()).describe("Up to 3 short notes on what to look for next (more like the best kept cards)."),
});

type TwinCandidate = {
  _id: Id<"cards">;
  title: string;
  url: string | null;
  domain: string | null;
  imageUrl: string | null;
  twinOf: Id<"cards"> | null;
  createdAt: number;
};

function stripQuery(url: string): string {
  return url.split(/[?#]/)[0];
}

function urlKey(url: string): string {
  const bare = stripQuery(url.trim()).replace(/\/+$/, "").toLowerCase();
  return bare.replace(/^https?:\/\/(www\.)?/, "");
}

function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Keys a card shares with its twins: picture, page, or title on the same site. */
function twinKeys(c: TwinCandidate): string[] {
  const keys: string[] = [];
  if (c.imageUrl) keys.push(`img:${stripQuery(c.imageUrl.trim())}`);
  if (c.url) keys.push(`url:${urlKey(c.url)}`);
  const t = titleKey(c.title);
  if (t && c.domain) keys.push(`title:${c.domain.toLowerCase()}:${t}`);
  return keys;
}

/**
 * Twin Spotter: among ready cards, the older card wins and each newer twin is
 * set aside. Never throws.
 */
async function spotTwins(ctx: ActionCtx, runId: Id<"runs">, boardId: Id<"boards">, agentId: Id<"agents">): Promise<void> {
  let taskId: Id<"tasks"> | null = null;
  try {
    const cards: TwinCandidate[] = await ctx.runQuery(internal.cards.twinCandidates, { boardId });
    if (cards.length < 2) return;
    taskId = await ctx.runMutation(internal.tasks.begin, {
      runId,
      agentId,
      tool: "sort",
      label: `Checking ${cards.length} cards for twins`,
      crew: "twin-spotter",
    });
    const owner = new Map<string, TwinCandidate>();
    const twins: { cardId: Id<"cards">; twinOf: Id<"cards">; reason: string }[] = [];
    // Oldest first; cards already marked as twins never become the original.
    for (const c of cards) {
      const keys = twinKeys(c);
      if (c.twinOf) continue;
      const older = keys.map((k) => owner.get(k)).find((o): o is TwinCandidate => Boolean(o));
      if (older) {
        twins.push({ cardId: c._id, twinOf: older._id, reason: `Same as “${trimText(older.title, 60)}”` });
        continue;
      }
      for (const k of keys) owner.set(k, c);
    }
    const marked = twins.length ? await ctx.runMutation(internal.cards.markTwins, { boardId, twins }) : 0;
    await ctx.runMutation(internal.tasks.end, {
      taskId,
      state: "done",
      note: marked ? `${marked} twin${marked === 1 ? "" : "s"}` : "no twins",
    });
  } catch (err) {
    if (taskId) {
      try {
        await ctx.runMutation(internal.tasks.end, { taskId, state: "failed", note: describeProviderError(err) });
      } catch {
        /* never throw */
      }
    }
  }
}

export type SortResult = { kept: number; total: number; needMore: boolean; hints: string[] };

/** Sort: one model call scores every read card against the board: fit, keep, why. */
export async function sortCards(ctx: ActionCtx, args: { runId: Id<"runs"> }): Promise<SortResult> {
  const run: RunContext | null = await ctx.runQuery(internal.runs.getContext, { runId: args.runId });
  if (!run || run.stage === "done" || run.stage === "failed") {
    return { kept: 0, total: 0, needMore: false, hints: [] };
  }
  const agent = run.agents.find((a) => a.skills.includes("sort"));
  if (!agent) throw new Error("No agent can sort.");
  await spotTwins(ctx, args.runId, run.boardId, agent._id);
  const cards: CardBrief[] = await ctx.runQuery(internal.cards.listForBoard, {
    boardId: run.boardId,
    status: "ready",
    limit: MAX_SORT,
  });
  if (cards.length === 0) return { kept: 0, total: 0, needMore: true, hints: [] };

  const lens = run.prompt || run.title;
  const brief = parseBrief(run.brief);
  const taskId = await ctx.runMutation(internal.tasks.begin, {
    runId: args.runId,
    agentId: agent._id,
    tool: "sort",
    label: `Sorting ${cards.length} card${cards.length === 1 ? "" : "s"} for “${trimText(lens, 80)}”`,
    crew: "judge",
  });
  try {
    const listing = cards
      .map((c, i) =>
        [
          `${i}. ${trimText(c.title, 120)}`,
          c.caption ? `caption: ${trimText(c.caption, 100)}` : "",
          c.type ? `type: ${c.type}` : "",
          c.domain ? `domain: ${c.domain}` : "",
          `picture: ${c.hasImage ? "yes" : "no"}`,
          c.summary ? `about: ${trimText(c.summary, 220)}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
      )
      .join("\n");
    const { object } = await withTimeout(
      generateObject({
        model: getModel(),
        schema: Verdicts,
        providerOptions: FAST,
        prompt:
          "You sort references on a board. Score every card against what the person is collecting.\n" +
          `${briefText(brief, lens)}\n` +
          "For every index give fit (0 to 1), keep (true only when the card is a genuinely useful reference for this board), " +
          "and why (one short plain clause). Judge against the whole of what they are collecting, not the literal words: " +
          "a card that lands squarely on any one of the angles above belongs on this board. Stay strict about quality — " +
          "generic hubs, thin pages and pages that only mention the subject in passing are not kept — and strict about " +
          "the line in \"not this\". " +
          "When the board is visual (inspiration, references, examples), prefer cards with a picture. " +
          `Set needMore when fewer than ${KEEP_TARGET} cards deserve keeping, and give up to 3 hints on what to search for next.\n\n` +
          `Cards:\n${listing}`,
      }),
      MODEL_TIMEOUT_MS,
      "sorting",
    );
    const verdicts: { cardId: Id<"cards">; fit: number; keep: boolean; why: string }[] = [];
    const seen = new Set<number>();
    for (const vd of object.verdicts) {
      if (!Number.isInteger(vd.i) || vd.i < 0 || vd.i >= cards.length || seen.has(vd.i)) continue;
      seen.add(vd.i);
      // A board people want to look at keeps only what it can show.
      const blind = brief?.visual !== false && !cards[vd.i].hasImage;
      verdicts.push({
        cardId: cards[vd.i]._id,
        fit: Number.isFinite(vd.fit) ? Math.max(0, Math.min(1, vd.fit)) : 0,
        keep: vd.keep && !blind,
        why: blind && vd.keep ? "No picture to show" : trimText(vd.why, WHY_MAX),
      });
    }
    const res = await ctx.runMutation(internal.cards.applyVerdicts, { boardId: run.boardId, verdicts });
    const hints = object.hints.map((h) => trimText(h, 120)).filter(Boolean).slice(0, 3);
    await ctx.runMutation(internal.tasks.end, {
      taskId,
      state: "done",
      note: `${res.kept} kept of ${res.total}`,
    });
    await ctx.runMutation(internal.runs.touch, { runId: args.runId });
    return { kept: res.kept, total: res.total, needMore: res.kept < KEEP_TARGET, hints };
  } catch (err) {
    await ctx.runMutation(internal.tasks.end, { taskId, state: "failed", note: describeProviderError(err) });
    throw err;
  }
}
