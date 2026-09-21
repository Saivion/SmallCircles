import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { components, internal } from "./_generated/api";
import { redact, redactError } from "./lib/redact";
import { verifySvix } from "./lib/svix";

const http = httpRouter();

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => new Response("ok", { status: 200 })),
});

/**
 * AgentMail `message.received` webhook (Svix-signed). Handoffs between agent
 * inboxes and human mail to any agent both land here; mail.ingestInbound
 * routes it by the workspace stamped on the message. Returns 200 quickly.
 */
http.route({
  path: "/agentmail/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
    if (!secret) {
      console.error("AGENTMAIL_WEBHOOK_SECRET is not set; rejecting webhook");
      return new Response("unauthorized", { status: 401 });
    }
    const rawBody = await request.text();
    if (rawBody.length > 1_000_000) return new Response("too large", { status: 413 });

    let ok = false;
    try {
      ok = await verifySvix(rawBody, request.headers, secret);
    } catch (err) {
      console.error("svix verify threw:", redactError(err));
      ok = false;
    }
    if (!ok) return new Response("unauthorized", { status: 401 });

    let payload: {
      event_type?: string;
      message?: {
        inbox_id?: string;
        thread_id?: string;
        message_id?: string;
        from?: string;
        subject?: string;
        text?: string;
        extracted_text?: string;
        preview?: string;
        headers?: Record<string, unknown>;
      };
    };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("bad json", { status: 400 });
    }

    if (payload.event_type !== "message.received") {
      return new Response("ignored", { status: 200 });
    }
    const m = payload.message ?? {};
    if (!m.inbox_id || !m.thread_id || !m.message_id) {
      return new Response("ignored", { status: 200 });
    }
    const text = String(m.text ?? m.extracted_text ?? m.preview ?? "").slice(0, 60_000);
    // Which workspace this belongs to: the stamp we put on the message we
    // sent. Header names are case-insensitive, so match either way.
    const headers = m.headers ?? {};
    const stamped = Object.entries(headers).find(([k]) => k.toLowerCase() === "x-smallcircles-workspace")?.[1];
    const workspace = typeof stamped === "string" ? stamped.trim().slice(0, 64) : undefined;
    const subject = redact(m.subject ?? "", 200);
    // Sender address: tells a teammate's handoff apart from human mail.
    const from = typeof m.from === "string" ? m.from.slice(0, 320) : undefined;

    try {
      const res = await ctx.runMutation(internal.mail.ingestInbound, {
        inboxId: m.inbox_id,
        messageId: m.message_id,
        from,
        subject,
        text,
        ...(workspace ? { workspace } : {}),
      });
      console.log("inbound:", res.action);
    } catch (err) {
      console.error("ingest failed:", redactError(err));
      return new Response("error", { status: 500 });
    }
    return new Response("ok", { status: 200 });
  }),
});

// Static site last, so exact app routes above win.
registerStaticRoutes(http, components.staticHosting);

export default http;
