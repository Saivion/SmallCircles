import type { CrewKey } from "@convex/lib/crew";

export type { CrewKey };

/**
 * Client record shapes. They mirror the Convex documents structurally so a
 * query result can be assigned straight into the store.
 *
 * The model (see docs/DIRECTION.md): a Board holds Cards; Agents with Skills
 * work Runs over a board; every step an agent takes is a Task, and Tasks
 * drive every visual.
 */
export type Skill = "search" | "browse" | "think" | "sort" | "mail";
export type Tool = Skill;
export type AgentColor = "rose" | "sky" | "amber";
export type AgentStatus = "idle" | "working" | "error";

export type Agent = {
  _id: string;
  canvasId: string;
  name: string;
  color: AgentColor;
  skills: Skill[];
  inboxAddress?: string;
  status: AgentStatus;
  statusText?: string;
  lastActiveAt: number;
  createdAt: number;
};

export type BoardStatus = "idle" | "running" | "done" | "failed";

export type Board = {
  _id: string;
  canvasId: string;
  title: string;
  prompt: string;
  status: BoardStatus;
  cell: string;
  originX: number;
  originY: number;
  found: number;
  read: number;
  kept: number;
  lastRunId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type CardKind = "raw" | "source" | "summary" | "mail" | "focus_match" | "archived";
export type CardStatus = "new" | "reading" | "ready" | "failed";
export type CardSource = "you" | "email" | "found";

export type Card = {
  _id: string;
  canvasId: string;
  boardId?: string;
  status?: CardStatus;
  source?: CardSource;
  /** The search that found it, when an agent found it. */
  query?: string;
  runId?: string;
  kind: CardKind;
  title: string;
  body: string;
  bodyLength?: number;
  url?: string;
  domain?: string;
  imageUrl?: string;
  type?: string;
  caption?: string;
  quote?: string;
  /** Fit against the board prompt, 0..1. */
  focusScore?: number;
  /** Kept by the sorting agent. */
  inFocus?: boolean;
  /** Why it fits, or why not. */
  focusReason?: string;
  /** Section the Grouper put this card in, on its board. */
  section?: string;
  /** Set when the Twin Spotter found this card repeats an older one. */
  twinOf?: string;
  createdAt: number;
  updatedAt?: number;
};

export type TaskState = "running" | "done" | "failed" | "skipped";

export type Task = {
  _id: string;
  boardId: string;
  runId: string;
  agentId: string;
  tool: Tool;
  label: string;
  cardId?: string;
  url?: string;
  /** Worker step under a lead's step (no inbox of its own). */
  parentTaskId?: string;
  /** The crew member that took this step; absent on a lead's own steps. */
  crew?: CrewKey;
  state: TaskState;
  note?: string;
  startedAt: number;
  endedAt?: number;
};

export type RunStage = "find" | "read" | "sort" | "done" | "failed";

export type Run = {
  _id: string;
  boardId: string;
  round: number;
  stage: RunStage;
  reason: string;
  startedAt: number;
  endedAt?: number;
  found: number;
  read: number;
  kept: number;
  error?: string;
};

export type Mail = {
  _id: string;
  canvasId: string;
  boardId?: string;
  runId?: string;
  fromAgentId?: string;
  toAgentId?: string;
  direction: "out" | "in";
  kind: "handoff" | "need_more" | "digest" | "human";
  subject: string;
  preview: string;
  state: "sent" | "skipped" | "failed" | "received";
  createdAt: number;
};

export const MAIL_KIND_LABEL: Record<Mail["kind"], string> = {
  handoff: "Handoff",
  need_more: "Need more",
  digest: "Board digest",
  human: "From a person",
};
