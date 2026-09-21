import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { AGENT_NAME_MAX } from "./lib/limits";
import { vAgentPublic, vSkill } from "./lib/validators";

/** The team on a canvas, in creation order. inboxId is never returned. */
export const listByCanvas = query({
  args: { canvasId: v.id("canvases") },
  returns: v.array(vAgentPublic),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agents")
      .withIndex("by_canvas", (q) => q.eq("canvasId", args.canvasId))
      .take(20);
    return rows.map((a) => ({
      _id: a._id,
      _creationTime: a._creationTime,
      canvasId: a.canvasId,
      name: a.name,
      color: a.color,
      skills: a.skills,
      inboxAddress: a.inboxAddress,
      status: a.status,
      statusText: a.statusText,
      lastActiveAt: a.lastActiveAt,
      createdAt: a.createdAt,
    }));
  },
});

export const rename = mutation({
  args: { agentId: v.id("agents"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new ConvexError("Agent not found.");
    const name = args.name.replace(/\s+/g, " ").trim();
    if (name.length < 1 || name.length > AGENT_NAME_MAX) {
      throw new ConvexError(`Names are 1 to ${AGENT_NAME_MAX} characters.`);
    }
    await ctx.db.patch(agent._id, { name });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Internal: inbox provisioning
// ---------------------------------------------------------------------------

const vAgentInbox = v.object({
  _id: v.id("agents"),
  canvasId: v.id("canvases"),
  name: v.string(),
  skills: v.array(vSkill),
  inboxId: v.optional(v.string()),
  inboxAddress: v.optional(v.string()),
});

export const listWithInboxes = internalQuery({
  args: { canvasId: v.id("canvases") },
  returns: v.array(vAgentInbox),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agents")
      .withIndex("by_canvas", (q) => q.eq("canvasId", args.canvasId))
      .take(20);
    return rows.map((a) => ({
      _id: a._id,
      canvasId: a.canvasId,
      name: a.name,
      skills: a.skills,
      inboxId: a.inboxId,
      inboxAddress: a.inboxAddress,
    }));
  },
});

/**
 * Give an agent an inbox. The account holds three, one per lead, and every
 * workspace's leads share them: the Finder of one workspace writes from the
 * same address as the Finder of another. Inbound mail is routed by the
 * workspace stamped on the message, not by who owns the inbox, so sharing
 * is safe. Refuses only when another lead of the SAME workspace holds it,
 * which would make two leads one address.
 */
export const setInbox = internalMutation({
  args: { agentId: v.id("agents"), inboxId: v.string(), inboxAddress: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return false;
    const here = await ctx.db
      .query("agents")
      .withIndex("by_canvas", (q) => q.eq("canvasId", agent.canvasId))
      .take(20);
    if (here.some((a) => a._id !== agent._id && a.inboxId === args.inboxId)) return false;
    await ctx.db.patch(agent._id, { inboxId: args.inboxId, inboxAddress: args.inboxAddress });
    if (agent.status === "error") await ctx.db.patch(agent._id, { status: "idle", statusText: undefined });
    return true;
  },
});

export const setError = internalMutation({
  args: { agentId: v.id("agents"), statusText: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    await ctx.db.patch(agent._id, { status: "error", statusText: args.statusText.slice(0, 80) });
    return null;
  },
});
