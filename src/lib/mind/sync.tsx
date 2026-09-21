"use client";

/**
 * Convex <-> store bridge. One headless component subscribes to the canvas
 * queries and diffs each result into the store by id, so one task changing
 * re-renders only what reads that task.
 */
import { useAction, useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { setSearchRunner } from "./search";
import { cardIds, removeCard, setAgents, setCanvasId, setBoards, setMail, setRuns, setTasks, transact, upsertCard } from "./store";
import type { Agent, Board, Card, Mail, Run, Task } from "./types";

export function CanvasSync({ canvasId }: { canvasId: Id<"canvases"> }) {
  const agents = useQuery(api.agents.listByCanvas, { canvasId });
  const boards = useQuery(api.boards.listByCanvas, { canvasId });
  const cards = useQuery(api.cards.listByCanvas, { canvasId });
  const tasks = useQuery(api.tasks.listRecent, { canvasId });
  const runs = useQuery(api.runs.listRecent, { canvasId });
  const mail = useQuery(api.mail.listByCanvas, { canvasId });
  const search = useAction(api.search.query);
  setCanvasId(canvasId);

  useEffect(() => {
    if (!agents) return;
    const list: Agent[] = agents.map((a) => ({
      _id: a._id,
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
    setAgents(list);
  }, [agents]);

  useEffect(() => {
    if (!boards) return;
    const list: Board[] = boards.map((b) => ({
      _id: b._id,
      canvasId: b.canvasId,
      title: b.title,
      prompt: b.prompt,
      status: b.status,
      cell: b.cell,
      originX: b.originX,
      originY: b.originY,
      found: b.found,
      read: b.read,
      kept: b.kept,
      lastRunId: b.lastRunId,
      error: b.error,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    }));
    setBoards(list);
  }, [boards]);

  useEffect(() => {
    if (!cards) return;
    transact(() => {
      const seen = new Set<string>();
      for (const doc of cards) {
        seen.add(doc._id);
        const next: Card = { ...doc };
        upsertCard(next);
      }
      for (const id of Array.from(cardIds())) if (!seen.has(id)) removeCard(id);
    });
  }, [cards]);

  useEffect(() => {
    if (!tasks) return;
    const list: Task[] = tasks.map((t) => ({
      _id: t._id,
      boardId: t.boardId,
      runId: t.runId,
      agentId: t.agentId,
      tool: t.tool,
      label: t.label,
      cardId: t.cardId,
      url: t.url,
      parentTaskId: t.parentTaskId,
      crew: t.crew,
      state: t.state,
      note: t.note,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
    }));
    setTasks(list);
  }, [tasks]);

  useEffect(() => {
    if (!runs) return;
    const list: Run[] = runs.map((r) => ({
      _id: r._id,
      boardId: r.boardId,
      round: r.round,
      stage: r.stage,
      reason: r.reason,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      found: r.found,
      read: r.read,
      kept: r.kept,
      error: r.error,
    }));
    setRuns(list);
  }, [runs]);

  useEffect(() => {
    if (!mail) return;
    const list: Mail[] = mail.map((m) => ({
      _id: m._id,
      canvasId: m.canvasId,
      boardId: m.boardId,
      runId: m.runId,
      fromAgentId: m.fromAgentId,
      toAgentId: m.toAgentId,
      direction: m.direction,
      kind: m.kind,
      subject: m.subject,
      preview: m.preview,
      state: m.state,
      createdAt: m.createdAt,
    }));
    setMail(list);
  }, [mail]);

  useEffect(() => {
    setSearchRunner((q) => search({ canvasId, q }));
    return () => setSearchRunner(null);
  }, [search, canvasId]);

  return null;
}
