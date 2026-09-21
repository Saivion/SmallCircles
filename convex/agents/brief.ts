"use node";
import { generateObject } from "ai";
import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { FAST, getModel, withTimeout } from "../lib/providers";
import { trimText } from "../lib/text";
import type { RunContext } from "../runs";

const MODEL_TIMEOUT_MS = 45_000;
const FACETS_MAX = 6;

/**
 * What the person meant, in the model's words. A prompt is a shorthand: "fall
 * weather + inspo" is not a request for weather reports, it is a season and a
 * mood, and the things that belong to it — the holidays, the colours, the
 * clothes, the rooms. Nothing here is a list we wrote down: the model reads
 * the prompt and names the angles itself, which is what keeps the board
 * broad for a loose prompt and narrow for an exact one.
 */
const Brief = z.object({
  reading: z.string().describe("One sentence: what this person is collecting, said plainly and generously."),
  facets: z
    .array(z.string())
    .describe(
      `Between 2 and ${FACETS_MAX} angles this subject fans out into. Each must differ in KIND from the others — ` +
        "an occasion, a place, an object, an activity, a style, a season's own holidays — not several variations of " +
        "one of those. Each a short noun phrase. Only as many as the prompt genuinely covers: an exact, narrow " +
        "prompt gets two.",
    ),
  avoid: z.string().describe("One clause naming what would clearly NOT belong, so the board does not drift. Empty when nothing obvious."),
  visual: z
    .boolean()
    .describe(
      "True when the person wants to SEE things — inspiration, looks, examples, places, products, styles. " +
        "False only when they want to read or learn (how-tos, explanations, news).",
    ),
});

/** `visual` is absent on briefs written before it existed; treat those as visual. */
export type BoardBrief = { reading: string; facets: string[]; avoid: string; visual: boolean };

/** The brief as one block of text, for a prompt. */
export function briefText(brief: BoardBrief | null, prompt: string): string {
  if (!brief) return `What they asked for: ${trimText(prompt, 300)}`;
  return (
    `What they asked for: ${trimText(prompt, 300)}\n` +
    `What that means: ${trimText(brief.reading, 300)}\n` +
    (brief.facets.length ? `Worth including: ${brief.facets.map((f) => trimText(f, 60)).join("; ")}\n` : "") +
    (brief.avoid ? `Not this: ${trimText(brief.avoid, 160)}\n` : "")
  );
}

export function parseBrief(raw: string | undefined): BoardBrief | null {
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as BoardBrief;
    return typeof b?.reading === "string"
      ? { reading: b.reading, facets: Array.isArray(b.facets) ? b.facets : [], avoid: b.avoid ?? "", visual: b.visual !== false }
      : null;
  } catch {
    return null;
  }
}

/**
 * Read the prompt once per board and remember it. Later runs reuse the same
 * brief, so "gather more" keeps widening along the same angles instead of
 * re-reading the prompt differently every time.
 */
export async function ensureBrief(ctx: ActionCtx, run: RunContext, agentId: Id<"agents">): Promise<BoardBrief | null> {
  const stored = parseBrief(run.brief);
  if (stored) return stored;
  const prompt = run.prompt || run.title;
  if (!prompt) return null;

  const taskId = await ctx.runMutation(internal.tasks.begin, {
    runId: run.runId,
    agentId,
    tool: "think",
    label: `Reading “${trimText(prompt, 80)}”`,
  });
  try {
    const { object } = await withTimeout(
      generateObject({
        model: getModel(),
        schema: Brief,
        providerOptions: FAST,
        prompt:
          "Someone is collecting references and wrote a short prompt for a board.\n" +
          `Prompt: ${trimText(prompt, 300)}\n\n` +
          "Read it the way a thoughtful person would, not literally. A loose or moody prompt is an invitation: name " +
          "the angles that belong to it, including the occasions, objects, places, activities and styles that come " +
          "with the subject even when the prompt never says them — a season carries its holidays, its food, its rooms " +
          "and its clothes, not only one of those. Spread the angles across different kinds of thing rather than " +
          "staying inside the first one you think of. An exact prompt stays exact: do not invent breadth that is not " +
          "there. Then name, in one clause, what would clearly not belong.",
      }),
      MODEL_TIMEOUT_MS,
      "reading the prompt",
    );
    const brief: BoardBrief = {
      reading: trimText(object.reading, 300),
      facets: (object.facets ?? []).map((f) => trimText(f, 60)).filter(Boolean).slice(0, FACETS_MAX),
      avoid: trimText(object.avoid ?? "", 160),
      visual: object.visual !== false,
    };
    await ctx.runMutation(internal.boards.setBrief, { boardId: run.boardId, brief: JSON.stringify(brief) });
    await ctx.runMutation(internal.tasks.end, {
      taskId,
      state: "done",
      note: brief.facets.length ? brief.facets.join(", ") : brief.reading,
    });
    return brief;
  } catch {
    // A missing brief is not a failure: the run falls back to the prompt.
    await ctx.runMutation(internal.tasks.end, { taskId, state: "skipped", note: "kept the prompt as written" });
    return null;
  }
}
