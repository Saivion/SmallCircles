"use node";
import { generateObject } from "ai";
import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { RunContext } from "../runs";
import type { Id } from "../_generated/dataModel";
import { MAX_CARDS_PER_BOARD } from "../lib/limits";
import { normalizeUrl, urlTitle } from "../lib/footer";
import { describeProviderError, FAST, getModel, withTimeout } from "../lib/providers";
import { trimText } from "../lib/text";

const MODEL_TIMEOUT_MS = 60_000;
const SOURCES = 2;
/** Kept cards considered, strongest first; the first SOURCES with links to follow are used. */
const SOURCE_POOL = 8;
const MAX_CANDIDATES = 30;
const MAX_PICKS = 2;

const Picks = z.object({
  picks: z
    .array(z.number().int())
    .describe(`Indices of at most ${MAX_PICKS} links worth adding. Empty when none are strong references.`),
});

const IMAGE_LINK = /\.(jpe?g|png|webp|gif|avif|svg|ico|bmp)$/i;
const SKIP_PATH =
  /(^|[/?=_-])(share|sharer|intent|login|log-in|signin|sign-in|signup|sign-up|register|join|account|cart|checkout|basket|privacy|terms|tos|legal|cookies?|tags?|categor(y|ies)|labels?|topics?|archives?|feed|rss|subscribe|newsletter)([/?=_.-]|$)/i;

type Candidate = { url: string; text: string };

/** Non-image http(s) links from markdown, filtered and deduped. */
function candidateLinks(body: string, sourceUrl: string, known: Set<string>): Candidate[] {
  const source = normalizeUrl(sourceUrl);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/(!?)\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi)) {
    if (m[1] === "!") continue;
    const text = m[2].replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
    const url = normalizeUrl(m[3]);
    if (!url || seen.has(url) || known.has(url) || url === source) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (IMAGE_LINK.test(parsed.pathname)) continue;
    if (SKIP_PATH.test(parsed.pathname + parsed.search)) continue;
    if (parsed.pathname === "/" && !parsed.search) continue; // bare home pages
    seen.add(url);
    out.push({ url, text: trimText(text, 120) });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/**
 * Link Follower: in the "need more" round, follow links out of the two
 * strongest kept cards. One model call per source picks up to 2 links, added
 * as new cards for Reader. Never throws.
 */
export async function followLinks(ctx: ActionCtx, args: { runId: Id<"runs"> }): Promise<void> {
  try {
    const run: RunContext | null = await ctx.runQuery(internal.runs.getContext, { runId: args.runId });
    if (!run || run.stage === "done" || run.stage === "failed") return;
    const agent = run.agents.find((a) => a.skills.includes("search"));
    if (!agent) return;
    const pool: { _id: Id<"cards">; title: string; url: string; body: string }[] = await ctx.runQuery(
      internal.cards.followSources,
      { boardId: run.boardId, limit: SOURCE_POOL },
    );
    if (pool.length === 0) return;
    const existing: { count: number; urls: string[] } = await ctx.runQuery(internal.runs.boardCardsBrief, {
      boardId: run.boardId,
    });
    if (existing.count >= MAX_CARDS_PER_BOARD) return;
    const known = new Set(existing.urls.map((u) => normalizeUrl(u) ?? u));
    const lens = run.prompt || run.title;
    // Strongest kept cards whose stored page actually links somewhere new.
    const sources = pool
      .map((src) => ({ ...src, candidates: candidateLinks(src.body, src.url, known) }))
      .filter((src) => src.candidates.length > 0)
      .slice(0, SOURCES);
    if (sources.length === 0) return;

    await Promise.all(
      sources.map(async (src) => {
        let taskId: Id<"tasks"> | null = null;
        try {
          const shortTitle = trimText(src.title, 50);
          taskId = await ctx.runMutation(internal.tasks.begin, {
            runId: args.runId,
            agentId: agent._id,
            tool: "browse",
            label: `Following links from “${shortTitle}”`,
            cardId: src._id,
            url: src.url,
            crew: "link-follower",
          });
          const candidates = src.candidates;
          const picked: Candidate[] = [];
          if (candidates.length > 0) {
            const listing = candidates
              .map((c, i) => `${i}. ${c.text || "(no text)"} | ${c.url}`)
              .join("\n");
            const { object } = await withTimeout(
              generateObject({
                model: getModel(),
                schema: Picks,
                providerOptions: FAST,
                prompt:
                  "You follow links out of a strong reference to find more references for a board.\n" +
                  `Board: ${trimText(lens, 300)}\n` +
                  `Found on: ${trimText(src.title, 120)} (${src.url})\n` +
                  `Pick at most ${MAX_PICKS} links that would themselves be strong references for this board: ` +
                  "specific pages with real content, not navigation, profiles of the site itself, or generic hubs. " +
                  "Return none when nothing qualifies.\n\n" +
                  `Links:\n${listing}`,
              }),
              MODEL_TIMEOUT_MS,
              "following links",
            );
            const seen = new Set<number>();
            for (const i of object.picks) {
              if (!Number.isInteger(i) || i < 0 || i >= candidates.length || seen.has(i)) continue;
              if (known.has(candidates[i].url)) continue;
              seen.add(i);
              picked.push(candidates[i]);
              if (picked.length >= MAX_PICKS) break;
            }
          }
          let added = 0;
          if (picked.length > 0) {
            for (const p of picked) known.add(p.url);
            const query = `followed from “${shortTitle}”`;
            const res = await ctx.runMutation(internal.cards.insertFound, {
              runId: args.runId,
              items: picked.map((p) => ({ url: p.url, title: p.text || urlTitle(p.url), description: "", query })),
            });
            added = res.cardIds.length;
          }
          await ctx.runMutation(internal.tasks.end, {
            taskId,
            state: "done",
            note: added > 0 ? `${added} link${added === 1 ? "" : "s"} picked` : "nothing worth following",
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
      }),
    );
    await ctx.runMutation(internal.runs.touch, { runId: args.runId });
  } catch (err) {
    console.warn("follow links skipped:", describeProviderError(err));
  }
}
