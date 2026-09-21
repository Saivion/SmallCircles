/**
 * Leads and crew on the client. The three leads are the agents with inboxes
 * (Finder, Reader, Sorter). Crew are the named specialists that do the
 * individual steps for them; the registry lives in convex/lib/crew.ts so the
 * backend and the screen agree on names.
 */
import { CREW, crewOf, type CrewKey, type LeadSkill } from "@convex/lib/crew";
import { getAgent } from "./store";
import type { Agent, Task } from "./types";

export { CREW, crewOf };
export type { CrewKey, LeadSkill };

const LEAD_ORDER: LeadSkill[] = ["search", "browse", "sort"];

/** The lead skill an agent carries (search, browse, or sort). */
export function leadSkillOf(agent: Agent): LeadSkill {
  return LEAD_ORDER.find((s) => agent.skills.includes(s)) ?? "search";
}

/** Who took a step: the crew member's name, or the lead's own name. */
export function actorName(task: Task): string {
  if (task.crew && CREW[task.crew]) return CREW[task.crew].name;
  return getAgent(task.agentId)?.name ?? "Agent";
}
