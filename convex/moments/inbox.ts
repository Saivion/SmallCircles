"use node";
/**
 * Replies to Small Circles' own emails. When the Circle Agent tells someone
 * their moment crossed paths or grew, that email's thread is the circle's
 * address: a reply (a memory, a note, a link, a correction, a photo) is read
 * and added to that circle. Anything else sent to the inbox is ignored:
 * circles are made on the page, never by email, and no email is ever answered
 * with another email.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { generateObject } from "ai";
import { z } from "zod";
import { FAST, getModel, mailClient, withTimeout } from "../lib/providers";
import { redactError } from "../lib/redact";
import { stripGps } from "../lib/stripGps";

const MAX_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

function senderAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

async function download(url: string): Promise<{ bytes: Buffer; type: string } | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;
    return { bytes: buf, type: type.split(";")[0] };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const receive = internalAction({
  args: {
    inboxId: v.string(),
    messageId: v.string(),
    threadId: v.optional(v.string()),
    from: v.string(),
    subject: v.string(),
    text: v.string(),
    attachments: v.array(
      v.object({ id: v.string(), filename: v.optional(v.string()), contentType: v.optional(v.string()), size: v.optional(v.number()) }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const from = senderAddress(args.from);
    const own = (process.env.MOMENTS_INBOX_ADDRESS ?? "").toLowerCase();
    if (!from || from === own || from.endsWith("@agentmail.to")) return null; // never ourselves
    // Only a reply to one of our notes about a circle means anything here.
    if (!args.threadId) return null;
    const circleId = await ctx.runQuery(internal.agent.store.circleForThread, { threadId: args.threadId });
    if (!circleId) return null;
    await addToCircle(ctx, { ...args, from, circleId });
    return null;
  },
});

const Reply = z.object({
  meaningful: z
    .boolean()
    .describe("True if they're adding something to the moment: a memory, a photo, a note, a link, some context or a correction. False for an empty reply, a thank-you, an out-of-office, spam, or anything unkind."),
  kind: z.enum(["memory", "photo", "note", "link", "context", "correction"]),
  text: z
    .string()
    .describe("What to add to the circle, in their own words, trimmed to the heart of it: at most 120 characters, no greeting or signature. Keep a link as the link. Empty for a photo with nothing said."),
});

/**
 * Someone replied to our email about a circle. Read it, and if they're adding
 * something to the moment, add it: it's drawn on the circle's outer ring like
 * anything added on the page. Silence otherwise. It never answers by email.
 */
async function addToCircle(
  ctx: ActionCtx,
  a: { circleId: Id<"circles">; from: string; messageId: string; inboxId: string; subject: string; text: string; attachments: { id: string; filename?: string; contentType?: string }[] },
) {
  const ws = await ctx.runMutation(internal.circles.workspaceForSender, { email: a.from, messageId: a.messageId });
  if (!ws || ws.duplicate) return;

  // At most one photo from a reply, its location taken out before anyone sees it.
  let storageId: Id<"_storage"> | undefined;
  const image = a.attachments.find((x) => (x.contentType ?? "").startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(x.filename ?? ""));
  if (image) {
    try {
      const att = await mailClient().inboxes.messages.getAttachment(a.inboxId, a.messageId, image.id);
      const got = await download(att.downloadUrl);
      if (got) storageId = await ctx.storage.store(new Blob([new Uint8Array(stripGps(new Uint8Array(got.bytes)))], { type: image.contentType ?? got.type ?? "image/jpeg" }));
    } catch (err) {
      console.warn("reply attachment failed:", redactError(err));
    }
  }

  const words = a.text.replace(/\s+/g, " ").trim();
  let read: z.infer<typeof Reply> = { meaningful: !!storageId, kind: storageId ? "photo" : "note", text: "" };
  if (words) {
    try {
      const { object } = await withTimeout(
        generateObject({
          model: getModel(),
          schema: Reply,
          providerOptions: FAST,
          prompt:
            "Someone replied to an email about a moment shared on Small Circles (a photo, with small drawings around it). " +
            "Decide whether they're adding something to that moment, and if so what.\n\n" +
            `Subject: ${a.subject.slice(0, 200)}\nTheir reply: ${words.slice(0, 1500)}\n` +
            (storageId ? "They attached a photo.\n" : ""),
        }),
        25_000,
        "reading a reply",
      );
      read = object;
    } catch (err) {
      console.warn("reading a reply failed:", redactError(err));
      // Keep their words rather than lose them; the contribution reader still screens them.
      read = { meaningful: true, kind: storageId ? "photo" : "note", text: words.slice(0, 120) };
    }
  }
  if (!read.meaningful && !storageId) return;
  const type = storageId ? "photo" : read.kind === "memory" ? "memory" : "note";
  await ctx.runMutation(internal.contributions.fromEmail, {
    circleId: a.circleId,
    canvasId: ws.canvasId,
    type,
    emailKind: storageId && read.kind !== "photo" ? `photo+${read.kind}` : read.kind,
    ...(read.text.trim() ? { text: read.text.trim() } : {}),
    ...(storageId ? { storageId } : {}),
  });
}
