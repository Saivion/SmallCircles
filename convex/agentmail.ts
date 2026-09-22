"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { mailClient } from "./lib/providers";

/**
 * One-time setup per deployment: register the Convex webhook URL with
 * AgentMail. Idempotent: an existing webhook for the same URL is reused.
 * Run: npx convex run agentmail:registerWebhook '{"url":"https://<deployment>.convex.site/agentmail/webhook"}'
 */
export const registerWebhook = internalAction({
  args: { url: v.string() },
  // An existing webhook keeps its secret: AgentMail only hands it back on
  // creation, so a reused one comes back without it and the deployment's
  // AGENTMAIL_WEBHOOK_SECRET already holds it.
  returns: v.object({ webhookId: v.string(), secret: v.optional(v.string()), reused: v.boolean() }),
  handler: async (_ctx, { url }) => {
    if (!/^https:\/\/.+\/agentmail\/webhook$/.test(url)) {
      throw new Error("url must be https://<deployment>.convex.site/agentmail/webhook");
    }
    const client = mailClient();
    const existing = await client.webhooks.list({ limit: 50 });
    const match = existing.webhooks?.find((w) => w.url === url);
    if (match) return { webhookId: match.webhookId, ...(match.secret ? { secret: match.secret } : {}), reused: true };
    const hook = await client.webhooks.create({ url, eventTypes: ["message.received"] });
    return { webhookId: hook.webhookId, secret: hook.secret, reused: false };
  },
});

/**
 * The account's inboxes, for choosing the one moments are emailed to. Set
 * its address as MOMENTS_INBOX_ADDRESS so the page can show it.
 * Run: npx convex run agentmail:listInboxes
 */
export const listInboxes = internalAction({
  args: {},
  returns: v.array(v.object({ inboxId: v.string(), email: v.string(), displayName: v.union(v.string(), v.null()) })),
  handler: async () => {
    const res = await mailClient().inboxes.list({ limit: 50 });
    return (res.inboxes ?? []).map((i) => ({
      inboxId: String(i.inboxId),
      email: String(i.email),
      displayName: i.displayName ? String(i.displayName) : null,
    }));
  },
});

/** Give the memories inbox a friendly sender name. */
export const nameInbox = internalAction({
  args: { inboxId: v.string(), displayName: v.string() },
  returns: v.null(),
  handler: async (_ctx, args) => {
    await mailClient().inboxes.update(args.inboxId, { displayName: args.displayName.slice(0, 60) });
    return null;
  },
});
