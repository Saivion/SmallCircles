import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Current model: agents, boards, runs, tasks, mail
// ---------------------------------------------------------------------------

export const vSkill = v.union(
  v.literal("search"),
  v.literal("browse"),
  v.literal("think"),
  v.literal("sort"),
  v.literal("mail"),
);
export const vTool = vSkill;
export type Skill = "search" | "browse" | "think" | "sort" | "mail";

/** Crew specialist keys; mirrors CrewKey in ./crew.ts. */
export const vCrewKey = v.union(
  v.literal("web-searcher"),
  v.literal("gallery-hunter"),
  v.literal("link-follower"),
  v.literal("page-opener"),
  v.literal("picture-picker"),
  v.literal("note-taker"),
  v.literal("judge"),
  v.literal("twin-spotter"),
  v.literal("grouper"),
);

export const vAgentColor = v.union(v.literal("rose"), v.literal("sky"), v.literal("amber"));
export const vAgentStatus = v.union(v.literal("idle"), v.literal("working"), v.literal("error"));

export const vBoardStatus = v.union(
  v.literal("idle"),
  v.literal("running"),
  v.literal("done"),
  v.literal("failed"),
);

export const vRunStage = v.union(
  v.literal("find"),
  v.literal("read"),
  v.literal("sort"),
  v.literal("done"),
  v.literal("failed"),
);
export type RunStage = "find" | "read" | "sort" | "done" | "failed";
export const ACTIVE_STAGES = ["find", "read", "sort"] as const;

export const vRunReason = v.union(
  v.literal("new board"),
  v.literal("links added"),
  v.literal("again"),
  v.literal("email"),
  v.literal("sweep"),
);
export type RunReason = "new board" | "links added" | "again" | "email" | "sweep";

export const vTaskState = v.union(
  v.literal("running"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("skipped"),
);

export const vMailDirection = v.union(v.literal("out"), v.literal("in"));
export const vMailKind = v.union(
  v.literal("handoff"),
  v.literal("need_more"),
  v.literal("digest"),
  v.literal("human"),
);
export const vMailState = v.union(
  v.literal("sent"),
  v.literal("skipped"),
  v.literal("failed"),
  v.literal("received"),
);

export const vCardStatus = v.union(
  v.literal("new"),
  v.literal("reading"),
  v.literal("ready"),
  v.literal("failed"),
);
export const vCardSource = v.union(v.literal("you"), v.literal("email"), v.literal("found"));

export const CARD_TYPES = ["article", "video", "product", "image", "quote", "tool", "other"] as const;
export const agentFields = {
  canvasId: v.id("canvases"),
  name: v.string(),
  color: vAgentColor,
  skills: v.array(vSkill),
  inboxId: v.optional(v.string()),
  inboxAddress: v.optional(v.string()),
  status: vAgentStatus,
  statusText: v.optional(v.string()),
  lastActiveAt: v.number(),
  createdAt: v.number(),
};

/** Public agent shape: no inboxId. */
export const vAgentPublic = v.object({
  _id: v.id("agents"),
  _creationTime: v.number(),
  canvasId: v.id("canvases"),
  name: v.string(),
  color: vAgentColor,
  skills: v.array(vSkill),
  inboxAddress: v.optional(v.string()),
  status: vAgentStatus,
  statusText: v.optional(v.string()),
  lastActiveAt: v.number(),
  createdAt: v.number(),
});

const boardPublicFields = {
  canvasId: v.id("canvases"),
  title: v.string(),
  prompt: v.string(),
  status: vBoardStatus,
  cell: v.string(),
  originX: v.number(),
  originY: v.number(),
  found: v.number(),
  read: v.number(),
  kept: v.number(),
  lastRunId: v.optional(v.id("runs")),
  error: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
};
export const boardFields = {
  ...boardPublicFields,
  replyTo: v.optional(v.string()),
  /** The model's reading of the prompt, as JSON. See agents/brief.ts. */
  brief: v.optional(v.string()),
};

/** Public board shape: no replyTo. */
export const vBoardPublic = v.object({
  _id: v.id("boards"),
  _creationTime: v.number(),
  ...boardPublicFields,
});

export const runFields = {
  canvasId: v.id("canvases"),
  boardId: v.id("boards"),
  round: v.number(),
  stage: vRunStage,
  reason: vRunReason,
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
  lastProgressAt: v.number(),
  error: v.optional(v.string()),
  found: v.number(),
  read: v.number(),
  kept: v.number(),
};

export const vRunPublic = v.object({
  _id: v.id("runs"),
  boardId: v.id("boards"),
  round: v.number(),
  stage: vRunStage,
  reason: vRunReason,
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
  found: v.number(),
  read: v.number(),
  kept: v.number(),
  error: v.optional(v.string()),
});

export const taskFields = {
  canvasId: v.id("canvases"),
  boardId: v.id("boards"),
  runId: v.id("runs"),
  agentId: v.id("agents"),
  tool: vTool,
  label: v.string(),
  cardId: v.optional(v.id("cards")),
  url: v.optional(v.string()),
  /** When set, this task is a worker under a main agent step (no inbox). */
  parentTaskId: v.optional(v.id("tasks")),
  /** Crew specialist that did this step; absent on lead-level steps. */
  crew: v.optional(vCrewKey),
  state: vTaskState,
  note: v.optional(v.string()),
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
};

export const vTaskPublic = v.object({
  _id: v.id("tasks"),
  boardId: v.id("boards"),
  runId: v.id("runs"),
  agentId: v.id("agents"),
  tool: vTool,
  label: v.string(),
  cardId: v.optional(v.id("cards")),
  url: v.optional(v.string()),
  parentTaskId: v.optional(v.id("tasks")),
  /** Crew specialist that did this step; absent on lead-level steps. */
  crew: v.optional(vCrewKey),
  state: vTaskState,
  note: v.optional(v.string()),
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
});

const mailPublicFields = {
  canvasId: v.id("canvases"),
  boardId: v.optional(v.id("boards")),
  runId: v.optional(v.id("runs")),
  fromAgentId: v.optional(v.id("agents")),
  toAgentId: v.optional(v.id("agents")),
  direction: vMailDirection,
  kind: vMailKind,
  subject: v.string(),
  preview: v.string(),
  state: vMailState,
  createdAt: v.number(),
};
export const mailFields = { ...mailPublicFields, messageId: v.optional(v.string()) };

export const vMailPublic = v.object({
  _id: v.id("mail"),
  _creationTime: v.number(),
  ...mailPublicFields,
});

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export const vCardKind = v.union(
  v.literal("raw"),
  v.literal("source"),
  v.literal("summary"),
  v.literal("mail"),
  v.literal("focus_match"),
  v.literal("archived"),
);

export const cardFields = {
  canvasId: v.id("canvases"),
  boardId: v.optional(v.id("boards")),
  status: v.optional(vCardStatus),
  source: v.optional(vCardSource),
  query: v.optional(v.string()),
  runId: v.optional(v.id("runs")),
  kind: vCardKind,
  title: v.string(),
  body: v.string(),
  url: v.optional(v.string()),
  domain: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  type: v.optional(v.string()),
  caption: v.optional(v.string()),
  quote: v.optional(v.string()),
  /** Fit 0..1. */
  focusScore: v.optional(v.number()),
  /** Keep. */
  inFocus: v.optional(v.boolean()),
  /** Why. */
  focusReason: v.optional(v.string()),
  /** Grouper's section name for a kept card (<= 24 chars). */
  section: v.optional(v.string()),
  /** Twin Spotter: the older card this one duplicates. */
  twinOf: v.optional(v.id("cards")),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const vCardDoc = v.object({
  _id: v.id("cards"),
  _creationTime: v.number(),
  ...cardFields,
});

export const vCardView = v.object({
  _id: v.id("cards"),
  _creationTime: v.number(),
  ...cardFields,
  bodyLength: v.number(),
});

export const vCanvasDoc = v.object({
  _id: v.id("canvases"),
  _creationTime: v.number(),
  slug: v.string(),
  title: v.string(),
  focus: v.string(),
  createdAt: v.number(),
});
