"use node";
import { generateObject } from "ai";
import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { RunContext } from "../runs";
import type { CardBrief } from "../cards";
import type { Id } from "../_generated/dataModel";
import { MAX_CARDS_PER_BOARD } from "../lib/limits";
import { describeProviderError, FAST, getModel, withTimeout } from "../lib/providers";
import { trimText } from "../lib/text";

const MODEL_TIMEOUT_MS = 60_000;
const MIN_KEPT = 4;
const SECTION_MAX = 24;
const MAX_SECTIONS = 4;

const Sections = z.object({
  sections: z
    .array(
      z.object({
        name: z.string().describe(`Section name: two or three plain words, no emoji, at most ${SECTION_MAX} characters.`),
        indices: z.array(z.number().int()).describe("Indices of the cards in this section."),
      }),
    )
    .describe(`Between 2 and ${MAX_SECTIONS} sections that together cover every card exactly once.`),
});

function cleanName(name: string): string {
  const plain = name.replace(/[^\p{L}\p{N}\s&'\-/,]/gu, "").replace(/\s+/g, " ").trim();
  if (plain.length <= SECTION_MAX) return plain;
  // Cut at a word boundary, never mid-word.
  const cut = plain.slice(0, SECTION_MAX + 1);
  const space = cut.lastIndexOf(" ");
  return (space > 8 ? cut.slice(0, space) : plain.slice(0, SECTION_MAX)).replace(/[\s&,·-]+$/, "");
}

/**
 * Grouper: after the run's final sort, group kept cards into 2 to 4 named
 * sections (one model call). Skipped below 4 kept cards. Never throws.
 */
export async function groupCards(ctx: ActionCtx, args: { runId: Id<"runs"> }): Promise<void> {
  let taskId: Id<"tasks"> | null = null;
  try {
    const run: RunContext | null = await ctx.runQuery(internal.runs.getContext, { runId: args.runId });
    if (!run || run.stage === "done" || run.stage === "failed") return;
    const agent = run.agents.find((a) => a.skills.includes("sort"));
    if (!agent) return;
    const kept: CardBrief[] = await ctx.runQuery(internal.cards.listForBoard, {
      boardId: run.boardId,
      status: "ready",
      keptOnly: true,
      limit: MAX_CARDS_PER_BOARD,
    });
    if (kept.length < MIN_KEPT) {
      // Too few to group: clear any old sections so the board shows none.
      await ctx.runMutation(internal.cards.applySections, { boardId: run.boardId, groups: [] });
      return;
    }
    taskId = await ctx.runMutation(internal.tasks.begin, {
      runId: args.runId,
      agentId: agent._id,
      tool: "think",
      label: `Grouping ${kept.length} kept cards`,
      crew: "grouper",
    });
    const listing = kept
      .map((c, i) =>
        [
          `${i}. ${trimText(c.title, 100)}`,
          c.caption ? `caption: ${trimText(c.caption, 100)}` : "",
          c.type ? `type: ${c.type}` : "",
          c.domain ? `domain: ${c.domain}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
      )
      .join("\n");
    const { object } = await withTimeout(
      generateObject({
        model: getModel(),
        schema: Sections,
        providerOptions: FAST,
        prompt:
          "Group the kept references on a board into sections a person would scan.\n" +
          `Board: ${trimText(run.prompt || run.title, 300)}\n` +
          `Make 2 to ${MAX_SECTIONS} sections. Every card index goes in exactly one section. ` +
          `Names are short plain words (at most ${SECTION_MAX} characters, no emoji), about what the cards show, not how good they are.\n\n` +
          `Cards:\n${listing}`,
      }),
      MODEL_TIMEOUT_MS,
      "grouping",
    );

    const assigned = new Map<number, string>();
    const names: string[] = [];
    for (const sec of object.sections) {
      if (names.length >= MAX_SECTIONS) break;
      const name = cleanName(sec.name);
      if (!name || names.includes(name)) continue;
      let count = 0;
      for (const i of sec.indices) {
        if (!Number.isInteger(i) || i < 0 || i >= kept.length || assigned.has(i)) continue;
        assigned.set(i, name);
        count++;
      }
      if (count > 0) names.push(name);
    }
    if (names.length === 0) throw new Error("no usable sections");
    // Cards the model left out join the last section so every kept card has one.
    const fallback = names[names.length - 1];
    const groups = kept.map((c, i) => ({ cardId: c._id, section: assigned.get(i) ?? fallback }));
    await ctx.runMutation(internal.cards.applySections, { boardId: run.boardId, groups });
    await ctx.runMutation(internal.tasks.end, { taskId, state: "done", note: names.join(" · ") });
    await ctx.runMutation(internal.runs.touch, { runId: args.runId });
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
