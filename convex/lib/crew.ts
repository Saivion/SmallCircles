/**
 * Crew: named specialists under the three lead agents. No inbox, no table:
 * this registry plus a `crew` key recorded on each task. Pure TypeScript
 * with zero imports so the frontend can import it too.
 */
export type CrewKey =
  | "web-searcher"
  | "gallery-hunter"
  | "link-follower"
  | "page-opener"
  | "picture-picker"
  | "note-taker"
  | "judge"
  | "twin-spotter"
  | "grouper";
export type LeadSkill = "search" | "browse" | "sort";
/** The tool a crew member is drawn with. */
export type CrewTool = "search" | "browse" | "think" | "sort" | "mail";
export const CREW: Record<CrewKey, { name: string; lead: LeadSkill; tool: CrewTool; blurb: string }> = {
  "web-searcher": { name: "Web Searcher", lead: "search", tool: "search", blurb: "Runs the planned searches." },
  "gallery-hunter": { name: "Gallery Hunter", lead: "search", tool: "search", blurb: "Looks where pictures of the subject live." },
  "link-follower": { name: "Link Follower", lead: "search", tool: "browse", blurb: "Follows the best cards to related pages." },
  "page-opener": { name: "Page Opener", lead: "browse", tool: "browse", blurb: "Opens each page." },
  "picture-picker": { name: "Picture Picker", lead: "browse", tool: "browse", blurb: "Finds the best picture on the page." },
  "note-taker": { name: "Note Taker", lead: "browse", tool: "think", blurb: "Writes the caption, type, and quote." },
  judge: { name: "Judge", lead: "sort", tool: "sort", blurb: "Scores fit and says why." },
  "twin-spotter": { name: "Twin Spotter", lead: "sort", tool: "sort", blurb: "Sets aside near duplicates." },
  grouper: { name: "Grouper", lead: "sort", tool: "think", blurb: "Groups kept cards into sections." },
};

export const CREW_KEYS = Object.keys(CREW) as CrewKey[];

export function crewOf(lead: LeadSkill): CrewKey[] {
  return CREW_KEYS.filter((k) => CREW[k].lead === lead);
}
