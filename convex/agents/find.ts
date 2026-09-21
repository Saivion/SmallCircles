"use node";
import { generateObject } from "ai";
import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { RunContext } from "../runs";
import type { Id } from "../_generated/dataModel";
import { FIND_QUERIES, MAX_CARDS_PER_BOARD, RESULTS_PER_QUERY } from "../lib/limits";
import { describeProviderError, FAST, firecrawl, getModel, withTimeout } from "../lib/providers";
import { trimText } from "../lib/text";
import { isBlockedHost } from "../sites";
import { briefText, ensureBrief } from "./brief";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

const SEARCH_TIMEOUT_MS = 45_000;
const MODEL_TIMEOUT_MS = 60_000;
const GALLERY_QUERIES = 2;

const QueryPlan = z.object({
  queries: z
    .array(z.string())
    .describe(`Between 1 and ${FIND_QUERIES} distinct web search queries, each under 80 characters.`),
  galleryQueries: z
    .array(z.string())
    .describe(
      `Between 0 and ${GALLERY_QUERIES} searches aimed at places where pictures of this subject are collected ` +
        "(portfolios, galleries, showcases, image-heavy sites), each under 80 characters. Empty when pictures would not help.",
    ),
});

type Planned = { q: string; crew: "web-searcher" | "gallery-hunter" };

type Hit = { url: string; title: string; description: string; query: string; imageUrl?: string };

/** Image results per gallery query; each becomes a card with its picture already known. */
const IMAGE_RESULTS = 8;
/** The shortest side an image-search picture may have to become a card face. */
const IMAGE_MIN_SIDE = 500;

/** Pinterest serves the same pin at several sizes; ask for the large one. */
function largest(imageUrl: string): string {
  return imageUrl.replace(/^(https?:\/\/i\.pinimg\.com\/)(\d+x|\d+x\d+)\//i, "$1736x/");
}

/** Image-search results that are big enough to be a card face, as hits on their source pages. */
function imageHits(res: { images?: unknown[] }, q: string): Hit[] {
  const hits: Hit[] = [];
  for (const r of res.images ?? []) {
    const item = r as { url?: unknown; imageUrl?: unknown; title?: unknown; imageWidth?: unknown; imageHeight?: unknown };
    const url = typeof item.url === "string" ? item.url : "";
    const imageUrl = typeof item.imageUrl === "string" ? item.imageUrl : "";
    if (!/^https?:\/\//i.test(url) || !/^https?:\/\//i.test(imageUrl)) continue;
    const w = typeof item.imageWidth === "number" ? item.imageWidth : 0;
    const h = typeof item.imageHeight === "number" ? item.imageHeight : 0;
    if (w && h && Math.min(w, h) < IMAGE_MIN_SIDE) continue;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    // The title doubles as the description, so a page that refuses to open still keeps a caption.
    hits.push({ url, title, description: title, query: q, imageUrl: largest(imageUrl) });
  }
  return hits;
}

/**
 * Find: plan up to 3 web searches for the board's prompt, run them in
 * parallel, and add new cards (deduped against the board, capped per round
 * and per board). Returns the created card ids.
 */
export async function findCards(
  ctx: ActionCtx,
  args: { runId: Id<"runs">; round: number; hints: string[] },
): Promise<Id<"cards">[]> {
  const run: RunContext | null = await ctx.runQuery(internal.runs.getContext, { runId: args.runId });
  if (!run || run.stage === "done" || run.stage === "failed") return [];
  const agent = run.agents.find((a) => a.skills.includes("search"));
  if (!agent) throw new Error("No agent can search.");
  const prompt = run.prompt || run.title;
  // How the prompt reads, written once per board: the angles it fans out into.
  const brief = await ensureBrief(ctx, run, agent._id);
  const existing: { count: number; titles: string[]; urls: string[] } = await ctx.runQuery(internal.runs.boardCardsBrief, { boardId: run.boardId });
  if (existing.count >= MAX_CARDS_PER_BOARD) return [];

  // Think: plan the searches.
  const planTask = await ctx.runMutation(internal.tasks.begin, {
    runId: args.runId,
    agentId: agent._id,
    tool: "think",
    label: `Planning searches for “${trimText(prompt, 80)}”`,
  });
  // Sites that refused to be read before on this canvas: plan around them and drop their results.
  const blockedList: string[] = await ctx.runQuery(internal.sites.blockedDomains, { runId: args.runId });
  const blocked = new Set(blockedList);
  let queries: Planned[] = [];
  try {
    const hints = args.hints.map((h) => trimText(h, 120)).filter(Boolean).slice(0, 3);
    const { object } = await withTimeout(
      generateObject({
        model: getModel(),
        schema: QueryPlan,
        providerOptions: FAST,
        prompt:
          "You plan web searches that collect references for a visual board.\n" +
          `${briefText(brief, prompt)}\n` +
          (hints.length ? `The sorter asked for more like this: ${hints.join("; ")}\n` : "") +
          (existing.titles.length
            ? `Already on the board (do not repeat these, find different sources):\n- ${existing.titles.map((t) => trimText(t, 80)).join("\n- ")}\n`
            : "") +
          `Write 1 to ${FIND_QUERIES} short, distinct search queries that will surface the best individual pages. ` +
          "Spend them on different angles of the subject rather than rewording the prompt: a query for one angle, " +
          "a query for another. A person who asks loosely wants range, and the angles above are where the range is. " +
          "Judge what kind of result the person wants. When they want inspiration, references or examples of " +
          "something visual, favour pages that show many pictures (galleries, showcases, portfolios, curated collections, " +
          "design community posts) over text explainers. When they want to learn or do something, favour guides, " +
          "tools and first-hand pages. " +
          `Separately, write 0 to ${GALLERY_QUERIES} gallery queries aimed at places where pictures of this subject are collected; ` +
          "aim them at public pages anyone can open without signing in; " +
          (blockedList.length
            ? `These sites refused to be read before, so do not aim any query at them: ${blockedList.slice(0, 30).join(", ")}. `
            : "") +
          "leave them empty when pictures would not help this person. " +
          (args.round > 0 ? "This is a follow-up round: take angles the first round did not cover. " : "") +
          "Queries only, no commentary.",
      }),
      MODEL_TIMEOUT_MS,
      "planning",
    );
    const seen = new Set<string>();
    const take = (list: string[], crew: Planned["crew"], max: number) => {
      let n = 0;
      for (const q of list) {
        if (n >= max) break;
        const clean = trimText(q, 120);
        const key = clean.toLowerCase();
        if (!clean || seen.has(key)) continue;
        seen.add(key);
        queries.push({ q: clean, crew });
        n++;
      }
    };
    take(object.queries, "web-searcher", FIND_QUERIES);
    take(object.galleryQueries ?? [], "gallery-hunter", GALLERY_QUERIES);
    // A board people want to look at always gets its pictures hunted, even if the planner forgot.
    if (brief?.visual !== false && !queries.some((p) => p.crew === "gallery-hunter")) {
      const angle = brief?.facets[args.round % Math.max(1, brief.facets.length)];
      take([angle ? `${prompt} ${angle}` : prompt], "gallery-hunter", 1);
    }
    await ctx.runMutation(internal.tasks.end, {
      taskId: planTask,
      state: "done",
      note: queries.map((p) => `“${p.q}”`).join(", "),
    });
  } catch (err) {
    await ctx.runMutation(internal.tasks.end, { taskId: planTask, state: "failed", note: describeProviderError(err) });
  }
  if (queries.length === 0) queries = [{ q: trimText(prompt, 120), crew: "web-searcher" }];

  // Search wave: one parent step with a worker per query (no extra inboxes).
  const waveTask = await ctx.runMutation(internal.tasks.begin, {
    runId: args.runId,
    agentId: agent._id,
    tool: "search",
    label: `Searching ${queries.length} ${queries.length === 1 ? "query" : "queries"}`,
  });
  const known = new Set(existing.urls);
  const searches = await Promise.all(
    queries.map(async ({ q, crew }) => {
      const taskId = await ctx.runMutation(internal.tasks.begin, {
        runId: args.runId,
        agentId: agent._id,
        tool: "search",
        label: crew === "gallery-hunter" ? `Hunting “${q}”` : `Searching “${q}”`,
        parentTaskId: waveTask,
        crew,
      });
      try {
        if (crew === "gallery-hunter") {
          // Gallery Hunter searches pictures directly, so every hit arrives with its picture.
          const res = await withTimeout(
            firecrawl().search(q, { limit: IMAGE_RESULTS, sources: ["images"] }),
            SEARCH_TIMEOUT_MS,
            "image search",
          );
          return { q, taskId, hits: imageHits(res, q), error: null as string | null };
        }
        const res = await withTimeout(firecrawl().search(q, { limit: RESULTS_PER_QUERY }), SEARCH_TIMEOUT_MS, "search");
        const hits: Hit[] = [];
        for (const r of res.web ?? []) {
          const item = r as { url?: unknown; title?: unknown; description?: unknown; metadata?: { sourceURL?: unknown; title?: unknown; description?: unknown } };
          const url = typeof item.url === "string" ? item.url : typeof item.metadata?.sourceURL === "string" ? item.metadata.sourceURL : "";
          if (!url) continue;
          const title = typeof item.title === "string" ? item.title : typeof item.metadata?.title === "string" ? item.metadata.title : "";
          const description =
            typeof item.description === "string" ? item.description : typeof item.metadata?.description === "string" ? item.metadata.description : "";
          hits.push({ url, title, description, query: q });
        }
        return { q, taskId, hits, error: null as string | null };
      } catch (err) {
        return { q, taskId, hits: [] as Hit[], error: describeProviderError(err) };
      }
    }),
  );

  // Interleave results so every query contributes before the round cap bites.
  const items: Hit[] = [];
  const maxLen = Math.max(0, ...searches.map((s) => s.hits.length));
  for (let i = 0; i < maxLen; i++) {
    for (const s of searches) {
      const h = s.hits[i];
      // A picture from a site that refuses reading is still a picture: image hits skip the block list.
      if (h && !known.has(h.url) && (h.imageUrl || !isBlockedHost(hostOf(h.url), blocked))) items.push(h);
    }
  }
  const inserted = await ctx.runMutation(internal.cards.insertFound, { runId: args.runId, items });
  const added = new Map(inserted.perQuery.map((p) => [p.query, p.added]));
  let failed = 0;
  let totalFresh = 0;
  for (const s of searches) {
    if (s.error) {
      failed += 1;
      await ctx.runMutation(internal.tasks.end, { taskId: s.taskId, state: "failed", note: s.error });
      continue;
    }
    const n = s.hits.length;
    const fresh = added.get(s.q) ?? 0;
    totalFresh += fresh;
    await ctx.runMutation(internal.tasks.end, {
      taskId: s.taskId,
      state: "done",
      note: `${n} result${n === 1 ? "" : "s"}, ${fresh} new`,
    });
  }
  await ctx.runMutation(internal.tasks.end, {
    taskId: waveTask,
    state: failed === searches.length ? "failed" : "done",
    note: `${totalFresh} new · ${searches.length - failed}/${searches.length} ok`,
  });
  await ctx.runMutation(internal.runs.touch, { runId: args.runId });
  return inserted.cardIds;
}
