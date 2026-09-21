import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { agentFields, boardFields, cardFields, mailFields, runFields, taskFields } from "./lib/validators";

export default defineSchema({
  canvases: defineTable({
    slug: v.string(),
    title: v.string(),
    focus: v.string(),
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  /** Generic workers with a name, colour, inbox and skills. */
  agents: defineTable(agentFields)
    .index("by_canvas", ["canvasId"])
    .index("by_inbox", ["inboxId"]),

  /** A prompt (or pasted links) that holds cards. */
  boards: defineTable(boardFields)
    .index("by_canvas", ["canvasId"])
    .index("by_canvas_status", ["canvasId", "status"]),

  /** One pass of the team over a board: find, read, sort. */
  runs: defineTable(runFields)
    .index("by_board", ["boardId", "startedAt"])
    .index("by_canvas_stage", ["canvasId", "stage"])
    .index("by_canvas_startedAt", ["canvasId", "startedAt"]),

  /** One step an agent takes, with the tool it used. */
  tasks: defineTable(taskFields)
    .index("by_canvas_startedAt", ["canvasId", "startedAt"])
    .index("by_canvas_state", ["canvasId", "state"])
    .index("by_run", ["runId"]),

  /** Agent-to-agent handoffs, digests and inbound human mail. */
  mail: defineTable(mailFields)
    .index("by_canvas_createdAt", ["canvasId", "createdAt"])
    .index("by_messageId", ["messageId"])
    .index("by_board", ["boardId"]),

  cards: defineTable(cardFields)
    .index("by_canvas_createdAt", ["canvasId", "createdAt"])
    .index("by_board", ["boardId"])
    .index("by_board_url", ["boardId", "url"])
    .index("by_board_status", ["boardId", "status"]),

  /**
   * Semantic search: one OpenAI text-embedding-3-small vector per card,
   * keyed by a sha-256 of the embedded text so unchanged cards are skipped.
   */
  cardEmbeddings: defineTable({
    canvasId: v.id("canvases"),
    cardId: v.id("cards"),
    hash: v.string(),
    embedding: v.array(v.float64()),
    updatedAt: v.number(),
  })
    .index("by_card", ["cardId"])
    .index("by_canvas", ["canvasId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["canvasId"],
    }),

  /**
   * Sites that refused to be read on this canvas, learned from real attempts.
   * Finder avoids them, so the team stops spending searches on pages it cannot open.
   */
  blockedSites: defineTable({
    canvasId: v.id("canvases"),
    domain: v.string(),
    count: v.number(),
    lastSeen: v.number(),
  })
    .index("by_canvas_domain", ["canvasId", "domain"])
    .index("by_canvas_lastSeen", ["canvasId", "lastSeen"]),

  /** Webhook idempotency: one row per AgentMail message id seen on a canvas. */
  inboundSeen: defineTable({
    canvasId: v.id("canvases"),
    messageId: v.string(),
    createdAt: v.number(),
  }).index("by_canvas_messageId", ["canvasId", "messageId"]),
});
