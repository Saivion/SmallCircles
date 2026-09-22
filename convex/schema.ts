import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { agentEventFields, circleFields, connectionFields, contributionFields, elementFields, notificationFields } from "./lib/circleFields";

export default defineSchema({
  /** A private workspace: one per browser, keyed by an unguessable slug. */
  canvases: defineTable({
    slug: v.string(),
    createdAt: v.number(),
    /** Where the Circle Agent may email this person (set on the page, or by replying to one of its emails). */
    emailFrom: v.optional(v.string()),
    /** Who this person is here: two random words they picked ("amber fox"). */
    alias: v.optional(v.string()),
    /** They picked the name themselves (the page asks once). */
    aliasChosen: v.optional(v.boolean()),
    /** The house: starter moments come from this workspace. */
    house: v.optional(v.boolean()),
    // Left on rows from the earlier product; nothing reads them. Drop once cleared.
    title: v.optional(v.string()),
    focus: v.optional(v.string()),
    lastSeenAt: v.optional(v.number()),
  })
    .index("by_slug", ["slug"])
    .index("by_emailFrom", ["emailFrom"]),

  /**
   * One row per open page (a tab, a window, another browser), refreshed by a
   * heartbeat and removed when the page goes. "Who's here" counts these, so
   * the same person in two apps is two pages looking at the hour.
   */
  presence: defineTable({
    /** Random per page load; never tied to anything else. */
    sessionId: v.string(),
    canvasId: v.id("canvases"),
    alias: v.string(),
    lastSeenAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_lastSeenAt", ["lastSeenAt"]),

  // ---------------------------------------------------------------------------
  // Small Circles: a moment, and everything around it.
  // ---------------------------------------------------------------------------

  /**
   * One moment and the world drawn around it. The photo is the anchor; the
   * context is what we worked out about it; the renderer draws the rest from
   * the elements plus `seed`, so a circle always redraws the same way.
   */
  circles: defineTable({
    ...circleFields,
    // Left from the removed email-to-circle flow; nothing reads them. Drop once cleared.
    sourceType: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    emailRef: v.optional(v.object({ inboxId: v.string(), messageId: v.string() })),
  })
    .index("by_canvas_createdAt", ["canvasId", "createdAt"])
    .index("by_status", ["status"])
    .index("by_released_createdAt", ["released", "createdAt"])
    .index("by_cityKey", ["cityKey"])
    .index("by_geoCell", ["geoCell"])
    .index("by_spotKey", ["spotKey"]),

  /** Two people's moments that crossed paths: same place, same landmark, same night. */
  circleConnections: defineTable(connectionFields)
    .index("by_pair", ["pairKey"])
    .index("by_source", ["sourceCircleId", "createdAt"])
    .index("by_target", ["targetCircleId", "createdAt"]),

  /** Everything that woke the Circle Agent, and what it decided (often: nothing). */
  agentEvents: defineTable(agentEventFields)
    .index("by_key", ["key"])
    .index("by_circle", ["circleId", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

  /** Every email the agent sent (or decided to send) to a human, once per key. */
  agentNotifications: defineTable(notificationFields)
    .index("by_dedupe", ["dedupeKey"])
    .index("by_recipient", ["recipientId", "createdAt"])
    .index("by_thread", ["threadId"])
    .index("by_circle", ["circleId", "createdAt"]),

  /** What other people added to a circle: the part of it that grows. */
  contributions: defineTable(contributionFields)
    .index("by_circle", ["circleId", "createdAt"])
    .index("by_canvas", ["canvasId", "createdAt"])
    .index("by_circle_canvas", ["circleId", "canvasId"]),

  /** One row per person per circle they opened: views count people, not visits. */
  circleViews: defineTable({
    circleId: v.id("circles"),
    viewerId: v.id("canvases"),
    createdAt: v.number(),
  })
    .index("by_circle_viewer", ["circleId", "viewerId"])
    .index("by_viewer", ["viewerId", "createdAt"]),

  /** One thing drawn around the moment: a doodle, a label, and what it means. */
  circleElements: defineTable(elementFields).index("by_circle", ["circleId", "order"]),

  /** Handwritten margin notes written while a circle is being drawn. */
  circleNotes: defineTable({
    circleId: v.id("circles"),
    text: v.string(),
    createdAt: v.number(),
  }).index("by_circle", ["circleId", "createdAt"]),

  /** Webhook idempotency: one row per email reply already handled, pruned after 7 days. */
  inboundSeen: defineTable({
    canvasId: v.id("canvases"),
    messageId: v.string(),
    createdAt: v.number(),
  }).index("by_canvas_messageId", ["canvasId", "messageId"]),
});
