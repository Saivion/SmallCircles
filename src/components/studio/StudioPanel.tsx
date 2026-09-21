"use client";

import { useMutation } from "convex/react";
import { Check, X } from "lucide-react";
import { memo, useState, useSyncExternalStore } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CREW, crewOf, leadSkillOf, type CrewKey, type LeadSkill } from "@/lib/mind/crew";
import {
  getAgent,
  getAgents,
  getBoard,
  getMail,
  getServerAgents,
  getServerMail,
  getServerTasks,
  getTasks,
  subscribeAgents,
  subscribeMail,
  subscribeTasks,
} from "@/lib/mind/store";
import { MAIL_KIND_LABEL, type Agent, type Mail, type Task } from "@/lib/mind/types";
import { setPanel, type PanelTab } from "@/lib/mind/ui";
import { CircleCover, coverImages, Orb } from "./Circles";

const ROLE: Record<LeadSkill, string> = {
  search: "Finds references",
  browse: "Reads every page",
  sort: "Keeps what fits",
};

function ago(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

/**
 * The team, on the right. Same layout as Mail: white thread cards, serif
 * titles, count pills, and a vertical timeline of rows.
 */
export const StudioPanel = memo(function StudioPanel({ tab }: { tab: PanelTab }) {
  const agents = useSyncExternalStore(subscribeAgents, getAgents, getServerAgents);
  const tasks = useSyncExternalStore(subscribeTasks, getTasks, getServerTasks);
  const running = tasks.filter((t) => t.state === "running");
  const crewCount = agents.reduce((n, a) => n + crewOf(leadSkillOf(a)).length, 0);

  return (
    <aside className="panel" aria-label={tab === "team" ? "The Team" : "Mail between leads"}>
      <div className="panel-head">
        <div className="panel-heading">
          <span className="panel-title">{tab === "team" ? "The Team" : "Mail"}</span>
          <span className="panel-sub">
            {tab === "team"
              ? `${agents.length} leads · ${crewCount} crew${running.length ? ` · ${running.length} at work` : ""}`
              : "Handoffs between the leads"}
          </span>
        </div>
        <button type="button" className="panel-close" aria-label="Close" onClick={() => setPanel(null)}>
          <X size={16} />
        </button>
      </div>

      <div className="panel-scroll">
        {tab === "team" ? (
          <div className="threads">
            {[...agents]
              .sort((a, b) => Number(running.some((t) => t.agentId === b._id)) - Number(running.some((t) => t.agentId === a._id)))
              .map((a) => (
                <LeadCard key={a._id} agent={a} running={running} />
              ))}
          </div>
        ) : (
          <Letters />
        )}
      </div>
    </aside>
  );
});

/** One lead as a mail-style thread: header + timeline of crew. */
function LeadCard({ agent, running }: { agent: Agent; running: readonly Task[] }) {
  const rename = useMutation(api.agents.rename);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(agent.name);
  const [copied, setCopied] = useState(false);
  const skill = leadSkillOf(agent);
  const crew = crewOf(skill);
  const mine = running.filter((t) => t.agentId === agent._id);
  const own = mine.find((t) => !t.crew);
  const byCrew = (key: CrewKey) => mine.filter((t) => t.crew === key);
  const board = mine[0] ? getBoard(mine[0].boardId) : undefined;
  const working = mine.length > 0;

  const commit = async () => {
    setEditing(false);
    const next = name.trim();
    if (!next || next === agent.name) return;
    try {
      await rename({ agentId: agent._id as Id<"agents">, name: next });
    } catch {
      setName(agent.name);
    }
  };

  return (
    <section className={`thread tone-${agent.color}${working ? " is-working" : ""}`}>
      <header className="thread-head">
        <span className="lead-orbs" aria-hidden="true">
          <Orb color={agent.color} tool={own?.tool ?? agent.skills[0]} live={working} size={30} />
          {crew.slice(0, 2).map((key) => (
            <Orb key={key} color={agent.color} tool={CREW[key].tool} live={byCrew(key).length > 0} size={22} />
          ))}
        </span>
        {editing ? (
          <input
            className="lead-rename thread-title"
            autoFocus
            value={name}
            maxLength={24}
            aria-label="Lead name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit();
              if (e.key === "Escape") {
                setName(agent.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button type="button" className="thread-title lead-title-btn" title="Double-click to rename" onDoubleClick={() => setEditing(true)}>
            {agent.name}
          </button>
        )}
        <span className="thread-count">{working ? mine.length : crew.length}</span>
      </header>

      <p className="lead-meta">
        <span className="lead-role">{ROLE[skill]}</span>
        {working && board ? <span className="lead-meta-sep"> · on {board.title}</span> : null}
        {agent.inboxAddress ? (
          <>
            <span className="lead-meta-sep"> · </span>
            <button
              type="button"
              className="lead-inbox-inline"
              title="Copy address"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(agent.inboxAddress!);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1400);
                } catch {
                  /* clipboard blocked */
                }
              }}
            >
              {copied ? "copied" : agent.inboxAddress}
            </button>
          </>
        ) : null}
      </p>

      <ol className="thread-mail">
        {own ? (
          <li className="mail-row is-live">
            <div className="mail-row-btn">
              <span className="mail-pair" aria-hidden="true">
                <Orb color={agent.color} tool={own.tool} live size={26} />
              </span>
              <span className="mail-text">
                <span className="mail-who">
                  <b>{agent.name}</b>
                  <span> leading</span>
                </span>
                <span className="mail-gist">
                  <span className="mail-need">At work</span>
                  {own.label}
                </span>
              </span>
              <span className="mail-side">
                <time>{ago(own.startedAt)}</time>
              </span>
            </div>
          </li>
        ) : null}
        {crew.map((key) => {
          const member = CREW[key];
          const now = byCrew(key);
          const live = now[0];
          return (
            <li key={key} className={`mail-row${live ? " is-live" : ""}`}>
              <div className="mail-row-btn">
                <span className="mail-pair" aria-hidden="true">
                  <Orb color={agent.color} tool={member.tool} live={!!live} size={26} />
                  <span className="mail-pair-to">
                    <Orb color={agent.color} tool={agent.skills[0]} size={20} />
                  </span>
                </span>
                <span className="mail-text">
                  <span className="mail-who">
                    <b>{member.name}</b>
                    <span> for {agent.name}</span>
                  </span>
                  <span className="mail-gist">
                    {live ? <span className="mail-need">At work</span> : null}
                    {live ? live.label : member.blurb}
                  </span>
                </span>
                <span className="mail-side">
                  {live ? <time>{ago(live.startedAt)}</time> : null}
                  {!live ? (
                    <span className="mail-ok" title="Ready">
                      <Check size={11} />
                    </span>
                  ) : null}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Why a handoff was written down but never sent. Mail is skipped when a lead
 * has no AgentMail inbox yet (the account holds three, one per lead), or when
 * the hour's sending cap is already used up.
 */
function skipReason(from: Agent | undefined, to: Agent | undefined) {
  if (from && !from.inboxAddress) return `${from.name} has no inbox yet, so the handoff was only recorded`;
  if (to && !to.inboxAddress) return `${to.name} has no inbox yet, so the handoff was only recorded`;
  return "The hour's sending limit was reached, so the handoff was only recorded";
}

/** "[circle] Finder to Reader: 12 cards" reads as "12 cards". */
function gist(subject: string) {
  const plain = subject.replace(/^\[[^\]]*\]\s*/, "");
  const colon = plain.indexOf(": ");
  const said = colon >= 0 ? plain.slice(colon + 2) : plain;
  // "need more like these (4 kept)" already has its chip; keep the count.
  const kept = said.match(/^need more like these\s*\((\d+) kept\)/i);
  return kept ? `only ${kept[1]} kept so far` : said;
}

type Thread = { key: string; boardId?: string; mail: Mail[] };

/**
 * Mail between the leads, as a conversation per circle. Each email is one
 * row: who wrote to whom as two overlapping orbs, what it said in a few
 * words, and whether it arrived. Open a row to read the email itself.
 */
function Letters() {
  const mail = useSyncExternalStore(subscribeMail, getMail, getServerMail);
  const [open, setOpen] = useState<string | null>(null);
  if (!mail.length) return <p className="panel-empty">No mail yet. When a circle starts, the leads email each other as they hand off.</p>;

  // Newest first; one thread per circle, in the order each was last active.
  const threads: Thread[] = [];
  const byKey = new Map<string, Thread>();
  for (const m of mail) {
    const key = m.boardId ?? "none";
    let t = byKey.get(key);
    if (!t) {
      t = { key, boardId: m.boardId, mail: [] };
      byKey.set(key, t);
      threads.push(t);
    }
    t.mail.push(m);
  }

  return (
    <div className="threads">
      {threads.map((t) => {
        const board = t.boardId ? getBoard(t.boardId) : undefined;
        return (
          <section key={t.key} className="thread">
            <header className="thread-head">
              <CircleCover images={t.boardId ? coverImages(t.boardId) : []} size={30} />
              <span className="thread-title">{board?.title ?? "Other mail"}</span>
              <span className="thread-count">{t.mail.length}</span>
            </header>
            <ol className="thread-mail">
              {t.mail.map((m) => {
                const from = m.fromAgentId ? getAgent(m.fromAgentId) : undefined;
                const to = m.toAgentId ? getAgent(m.toAgentId) : undefined;
                const isOpen = open === m._id;
                const need = m.kind === "need_more";
                return (
                  <li key={m._id} className={`mail-row tone-${from?.color ?? "sky"}${isOpen ? " is-open" : ""}`}>
                    <button type="button" className="mail-row-btn" onClick={() => setOpen(isOpen ? null : m._id)} aria-expanded={isOpen}>
                      <span className="mail-pair" aria-hidden="true">
                        {from ? <Orb color={from.color} tool={from.skills[0]} size={26} /> : <span className="mail-person">@</span>}
                        {to ? (
                          <span className="mail-pair-to">
                            <Orb color={to.color} tool={to.skills[0]} size={20} />
                          </span>
                        ) : null}
                      </span>
                      <span className="mail-text">
                        <span className="mail-who">
                          <b>{m.direction === "in" && !from ? "A person" : (from?.name ?? "Lead")}</b>
                          {to ? <span> to {to.name}</span> : null}
                        </span>
                        <span className="mail-gist">
                          {need ? <span className="mail-need">Need more</span> : null}
                          {m.kind === "digest" ? <span className="mail-need">Digest</span> : null}
                          {gist(m.subject)}
                        </span>
                      </span>
                      <span className="mail-side">
                        <time>{ago(m.createdAt)}</time>
                        {m.state === "received" ? (
                          <span className="mail-ok" title="Delivered">
                            <Check size={11} />
                          </span>
                        ) : m.state !== "sent" ? (
                          <span className={`mail-flag is-${m.state}`} title={m.state === "skipped" ? skipReason(from, to) : "The send failed"}>
                            {m.state === "skipped" ? "not sent" : m.state}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {isOpen ? (
                      <div className="mail-open">
                        <p className="mail-subject-full">{m.subject}</p>
                        {m.preview ? <pre className="mail-preview-full">{m.preview}</pre> : null}
                        <span className="mail-kind-full">{MAIL_KIND_LABEL[m.kind]}</span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
