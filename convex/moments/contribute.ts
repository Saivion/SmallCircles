"use node";
/**
 * Small Circles reads what someone added to a circle before it's drawn:
 * picks the doodle it should be drawn as, writes a label of a few words, and
 * keeps out anything unkind or unsafe. These are strangers' moments, so
 * this check is the promise that makes adding to them feel safe.
 */
import { generateObject } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { FAST, getModel, withTimeout } from "../lib/providers";
import { redactError } from "../lib/redact";
import { DOODLE_IDS, vocabularyText } from "../lib/vocabulary";

const READ_TIMEOUT_MS = 30_000;

const Read = z.object({
  ok: z
    .boolean()
    .describe(
      "False only if this is cruel, hateful, sexual, violent, spam, an advert, or shares someone's private details (a phone number, an address). Warm, silly or sad things are fine.",
    ),
  doodle: z.enum(DOODLE_IDS).describe("The one drawing from the vocabulary that best carries what they added."),
  label: z.string().describe("What to write under the drawing: 1 to 3 lowercase words, their meaning not their exact words ('paris, 2022', 'my grandma's kitchen', 'same sunset')."),
});

export const read = internalAction({
  args: { contributionId: v.id("contributions") },
  returns: v.null(),
  handler: async (ctx, { contributionId }) => {
    const k = await ctx.runQuery(internal.contributions.forRead, { contributionId });
    if (!k) return null;
    const about =
      `Someone shared a photo of a moment ("${k.circle.title}"${k.circle.reading ? `: ${k.circle.reading}` : ""})` +
      (k.circle.prompt ? `, answering "${k.circle.prompt}"` : "") +
      `. A stranger added this to it, as a ${k.type}.\n`;
    try {
      const content: ({ type: "text"; text: string } | { type: "image"; image: URL })[] = [
        {
          type: "text",
          text:
            about +
            (k.text ? `What they wrote: "${k.text}"\n` : "") +
            (k.type === "photo" ? "Their photo is attached.\n" : "") +
            "\nChoose how it's drawn on the circle. Vocabulary (id: meaning):\n" +
            vocabularyText(),
        },
      ];
      if (k.photoUrl) content.push({ type: "image", image: new URL(k.photoUrl) });
      const { object } = await withTimeout(
        generateObject({ model: getModel(), schema: Read, providerOptions: FAST, messages: [{ role: "user", content }] }),
        READ_TIMEOUT_MS,
        "reading a contribution",
      );
      if (!object.ok) {
        await ctx.runMutation(internal.contributions.reject, { contributionId });
        return null;
      }
      await ctx.runMutation(internal.contributions.settle, { contributionId, illustration: object.doodle, label: object.label });
    } catch (err) {
      // The model couldn't be reached: keep it, drawn the plain way. People's words matter more than our doodle.
      console.warn("contribution read failed:", redactError(err));
      await ctx.runMutation(internal.contributions.settle, { contributionId });
    }
    return null;
  },
});
