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
 * AgentMail `message.received` webhook (Svix-signed): the inbox for memories.
 * A photo (or a link) emailed to Small Circles becomes a circle. The work is
 * scheduled so the webhook answers at once.
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
        message_id?: string;
        thread_id?: string;
        from?: string;
        subject?: string;
        text?: string;
        extracted_text?: string;
        preview?: string;
        attachments?: { attachment_id?: string; filename?: string; content_type?: string; size?: number }[];
      };
    };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("bad json", { status: 400 });
    }
    if (payload.event_type !== "message.received") return new Response("ignored", { status: 200 });
    const m = payload.message ?? {};
    if (!m.inbox_id || !m.message_id || typeof m.from !== "string") return new Response("ignored", { status: 200 });

    const attachments = (m.attachments ?? [])
      .filter((a) => typeof a.attachment_id === "string")
      .slice(0, 10)
      .map((a) => ({
        id: a.attachment_id as string,
        ...(a.filename ? { filename: a.filename.slice(0, 200) } : {}),
        ...(a.content_type ? { contentType: a.content_type.slice(0, 100) } : {}),
        ...(typeof a.size === "number" ? { size: a.size } : {}),
      }));
    await ctx.scheduler.runAfter(0, internal.moments.inbox.receive, {
      inboxId: m.inbox_id,
      messageId: m.message_id,
      ...(typeof m.thread_id === "string" ? { threadId: m.thread_id.slice(0, 200) } : {}),
      from: m.from.slice(0, 320),
      subject: redact(m.subject ?? "", 200),
      text: redact(String(m.extracted_text ?? m.text ?? m.preview ?? ""), 4000),
      attachments,
    });
    return new Response("ok", { status: 200 });
  }),
});

// Static site last, so exact app routes above win.
registerStaticRoutes(http, components.staticHosting);

export default http;
