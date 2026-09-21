"use node";
import { generateObject } from "ai";
import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { RunContext } from "../runs";
import type { Id } from "../_generated/dataModel";
import { CAPTION_MAX, QUOTE_MAX } from "../lib/limits";
import { describeProviderError, FAST, firecrawl, getModel, withTimeout } from "../lib/providers";
import { redactError, truncateBody } from "../lib/redact";
import { trimText } from "../lib/text";
import { CARD_TYPES } from "../lib/validators";

const SCRAPE_TIMEOUT_MS = 60_000;
const MODEL_TIMEOUT_MS = 60_000;
const MARKDOWN_MAX = 6000;
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_WAIT_MS = 20_000;

const Reading = z.object({
  title: z.string().describe("A clean title for the page, under 120 characters."),
  caption: z
    .string()
    .describe(`One plain human line for the card face, under ${CAPTION_MAX} characters: what this is and why it is worth a look.`),
  type: z.enum(CARD_TYPES).describe('"image" when the page is mostly pictures, "quote" when it is mostly a quotation.'),
  quote: z
    .string()
    .describe(`One strong line copied verbatim from the page, under ${QUOTE_MAX} characters. Empty string when there is none worth pulling.`),
  summary: z.string().describe("At most 2 sentences: what the page actually contains."),
  usable: z
    .boolean()
    .describe("False when the page is an error, a not-found or access-denied page, a login or cookie wall, or an empty shell with nothing to learn from."),
});

const BAD_OG = /logo|icon|sprite|favicon|\.svg(\?|$)|1x1|tracking|pixel/i;
const BAD_PICTURE = /svg|icon|logo|avatar|sprite|pixel|badge|thumb|thumbnail|[-_/](xs|sm|small|mini|tiny|preview)[-_./]/i;
/** The shortest side a picture may claim in its own URL. */
const MIN_SIDE = 420;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;
const LARGE_HINT = /large|big|full|original|hero|cover|(^|[^0-9])(1[0-9]{3}|2[0-9]{3}|3[0-9]{3})([^0-9]|$)/i;

/**
 * True when the URL says the picture is small: "600x200", "w=320", "s=96".
 * A blurry logo blown up to fill a card is worse than no picture at all.
 */
function tooSmall(url: string): boolean {
  const pair = url.match(/(?:^|[^0-9])([1-9][0-9]{1,3})\s*[x\u00d7]\s*([1-9][0-9]{1,3})(?:[^0-9]|$)/);
  if (pair && (Number(pair[1]) < MIN_SIDE || Number(pair[2]) < MIN_SIDE)) return true;
  for (const m of url.matchAll(/[?&;/_-](?:w|width|h|height|s|size|sz|maxwidth)[=:]?([1-9][0-9]{1,3})(?:[^0-9]|$)/gi)) {
    if (Number(m[1]) < MIN_SIDE) return true;
  }
  return false;
}

/** True when an og image is missing or looks like a logo, icon or thumbnail. */
function ogLooksWeak(og: string | undefined): boolean {
  return !og || BAD_OG.test(og) || tooSmall(og);
}

/**
 * Picture Picker: the first markdown image that is not an icon-like asset or
 * a thumbnail, and ends in a common image type (or has no extension). URLs
 * hinting at larger sizes win over the first plain match. No model call.
 */
function pickPicture(markdown: string): string | undefined {
  const re = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)/gi;
  let first: string | undefined;
  for (const m of markdown.matchAll(re)) {
    const url = m[1];
    if (BAD_PICTURE.test(url) || tooSmall(url)) continue;
    let path = "";
    try {
      path = new URL(url).pathname;
    } catch {
      continue;
    }
    const last = path.split("/").pop() ?? "";
    if (last.includes(".") && !IMAGE_EXT.test(last)) continue;
    if (LARGE_HINT.test(url)) return url.slice(0, 2000);
    first ??= url.slice(0, 2000);
  }
  return first;
}

const BLOCKED_NOTE = "This site blocks reading";

/** A few plain words for why a page did not open. */
function shortReason(err: unknown): string {
  const text = describeProviderError(err);
  if (/do not support this site|not supported/i.test(text)) return BLOCKED_NOTE;
  if (isRateLimited(err)) return "Reading limit reached";
  if (/timed out|timeout/i.test(text)) return "Page took too long";
  if (/\b(403|401)\b/.test(text)) return "Page refused the request";
  if (/\b404\b/.test(text)) return "Page not found";
  return trimText(text, 80);
}

function isRateLimited(err: unknown): boolean {
  const e = err as { statusCode?: number; status?: number; message?: string };
  return e?.statusCode === 429 || e?.status === 429 || /rate limit/i.test(String(e?.message ?? err));
}

/** Firecrawl scrape; waits and retries (twice) when the plan's per-minute rate limit is hit. */
async function scrapeWithBackoff(url: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout(
        firecrawl().scrape(url, { formats: ["markdown"], timeout: SCRAPE_TIMEOUT_MS - 5_000 }),
        SCRAPE_TIMEOUT_MS,
        "page load",
      );
    } catch (err) {
      if (attempt >= RATE_LIMIT_RETRIES || !isRateLimited(err)) throw err;
      const waitMs = RATE_LIMIT_WAIT_MS * (attempt + 1) + Math.floor(Math.random() * 5_000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

/**
 * Read one card: open the page (Firecrawl markdown + metadata), then think
 * (title, caption, type, quote, summary). Marks the card ready, or failed on
 * any error. Never throws.
 */
export async function readCard(
  ctx: ActionCtx,
  args: { runId: Id<"runs">; cardId: Id<"cards">; parentTaskId?: Id<"tasks"> },
): Promise<null> {
  let taskId: Id<"tasks"> | null = null;
  let opening = true;
  let fallback: { title: string; description: string; hasImage: boolean } | null = null;
  let domain = "";
  try {
    const run: RunContext | null = await ctx.runQuery(internal.runs.getContext, { runId: args.runId });
    if (!run) return null;
    const agent = run.agents.find((a) => a.skills.includes("browse"));
    if (!agent) {
      await ctx.runMutation(internal.cards.markFailed, { cardId: args.cardId });
      return null;
    }
    const claimed = await ctx.runMutation(internal.cards.markReading, { runId: args.runId, cardId: args.cardId });
    if (!claimed) return null;
    fallback = {
      title: claimed.title,
      // A picture card from image search may have no summary; its title is caption enough.
      description: claimed.description || (claimed.hasImage ? claimed.title : ""),
      hasImage: claimed.hasImage,
    };
    domain = claimed.domain;
    if (!claimed.url) {
      await ctx.runMutation(internal.cards.markFailed, { cardId: args.cardId });
      return null;
    }

    // Browse (worker under the wave when parentTaskId is set).
    taskId = await ctx.runMutation(internal.tasks.begin, {
      runId: args.runId,
      agentId: agent._id,
      tool: "browse",
      label: `Opening ${claimed.domain || "page"}`,
      cardId: args.cardId,
      url: claimed.url,
      ...(args.parentTaskId ? { parentTaskId: args.parentTaskId } : {}),
      crew: "page-opener",
    });
    const doc = await scrapeWithBackoff(claimed.url);
    const meta = (doc.metadata ?? {}) as Record<string, unknown>;
    const str = (x: unknown) => (typeof x === "string" ? x : Array.isArray(x) && typeof x[0] === "string" ? x[0] : "");
    const pageTitle = str(meta.title).trim() || str(meta.ogTitle).trim();
    const description = str(meta.description).trim() || str(meta.ogDescription).trim();
    const og = str(meta.ogImage).trim();
    let imageUrl = /^https?:\/\//i.test(og) ? og : undefined;
    const markdown = truncateBody(doc.markdown ?? "", MARKDOWN_MAX);
    if (!markdown && !description && !pageTitle) throw new Error("page was empty");
    await ctx.runMutation(internal.tasks.end, {
      taskId,
      state: "done",
      note: trimText(pageTitle || claimed.domain, 120),
    });
    taskId = null;
    opening = false;

    // Image search already found this card's picture; the page's own images are second best.
    if (claimed.hasImage) imageUrl = undefined;
    // Picture Picker: only when there is no picture yet and the og image is missing or looks like a logo.
    else if (ogLooksWeak(imageUrl)) {
      const pickTask = await ctx.runMutation(internal.tasks.begin, {
        runId: args.runId,
        agentId: agent._id,
        tool: "browse",
        label: `Picking a picture on ${claimed.domain || "page"}`,
        cardId: args.cardId,
        url: claimed.url,
        ...(args.parentTaskId ? { parentTaskId: args.parentTaskId } : {}),
        crew: "picture-picker",
      });
      const picked = pickPicture(doc.markdown ?? "");
      imageUrl = picked;
      await ctx.runMutation(internal.tasks.end, {
        taskId: pickTask,
        state: "done",
        note: picked ? "found a picture" : "no good picture",
      });
    }

    // Think.
    const shownTitle = pageTitle || claimed.title;
    taskId = await ctx.runMutation(internal.tasks.begin, {
      runId: args.runId,
      agentId: agent._id,
      tool: "think",
      label: `Reading “${trimText(shownTitle, 80)}”`,
      cardId: args.cardId,
      url: claimed.url,
      crew: "note-taker",
    });
    const { object } = await withTimeout(
      generateObject({
        model: getModel(),
        schema: Reading,
        providerOptions: FAST,
        prompt:
          "Describe this web page for a reference board. Never invent anything that is not in the page.\n" +
          `Board: ${trimText(run.prompt || run.title, 200)}\n` +
          `URL: ${claimed.url}\nPage title: ${trimText(pageTitle, 200) || "(none)"}\n` +
          `Meta description: ${trimText(description, 300) || "(none)"}\n` +
          `Has a preview image: ${imageUrl || claimed.hasImage ? "yes" : "no"}\n\n` +
          `Content:\n${markdown.slice(0, 4000)}`,
      }),
      MODEL_TIMEOUT_MS,
      "reading",
    );
    if (!object.usable) {
      // The page opened but held nothing real: keep what the search said, or set it aside.
      const described = fallback?.description.trim();
      if (described) {
        await ctx.runMutation(internal.cards.applyRead, {
          cardId: args.cardId,
          title: fallback!.title,
          caption: trimText(described, CAPTION_MAX),
          type: fallback!.hasImage ? "image" : "other",
          quote: "",
          body: described,
        });
      } else {
        await ctx.runMutation(internal.cards.markFailed, { cardId: args.cardId });
      }
      await ctx.runMutation(internal.tasks.end, {
        taskId,
        state: "skipped",
        note: described ? "Page had nothing to read; kept the search summary" : "Page had nothing to read",
      });
      taskId = null;
      return null;
    }
    const summary = trimText(object.summary, 400);
    const quote = object.quote.trim();
    await ctx.runMutation(internal.cards.applyRead, {
      cardId: args.cardId,
      title: trimText(object.title, 120) || shownTitle,
      caption: trimText(object.caption, CAPTION_MAX),
      type: object.type,
      quote: quote && markdown.includes(quote.slice(0, 40)) ? trimText(quote, QUOTE_MAX) : "",
      body: `${summary}\n\n${markdown}`.trim(),
      ...(imageUrl ? { imageUrl } : {}),
    });
    await ctx.runMutation(internal.tasks.end, {
      taskId,
      state: "done",
      note: trimText(object.caption, 120),
    });
    taskId = null;
    await ctx.runMutation(internal.runs.touch, { runId: args.runId });
  } catch (err) {
    console.warn("read failed:", redactError(err));
    const note = shortReason(err);
    try {
      // Learn from it: Finder stops sending the team to sites that refuse to be read.
      if (note === BLOCKED_NOTE && domain) await ctx.runMutation(internal.sites.markBlocked, { runId: args.runId, domain });
      // The page would not open, but the search already told us what it is:
      // keep the card with that summary instead of losing it.
      if (opening && fallback && fallback.description.trim()) {
        await ctx.runMutation(internal.cards.applyRead, {
          cardId: args.cardId,
          title: fallback.title,
          caption: trimText(fallback.description, CAPTION_MAX),
          type: fallback.hasImage ? "image" : "other",
          quote: "",
          body: fallback.description,
        });
        if (taskId) {
          await ctx.runMutation(internal.tasks.end, { taskId, state: "skipped", note: `${note}; kept the search summary` });
        }
      } else {
        await ctx.runMutation(internal.cards.markFailed, { cardId: args.cardId });
        if (taskId) await ctx.runMutation(internal.tasks.end, { taskId, state: "failed", note });
      }
    } catch {
      /* never throw */
    }
  }
  return null;
}
