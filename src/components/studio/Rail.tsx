"use client";

import { House, Mail, Orbit } from "lucide-react";
import { memo, useSyncExternalStore, type ComponentType } from "react";
import { getMail, getTasks, getTasksVersion, subscribeMail, subscribeTasks } from "@/lib/mind/store";
import { getPanel, getServerPanel, selectBoard, setPanel, setQuery, subscribePanel, togglePanel } from "@/lib/mind/ui";
import { Mark } from "./Circles";

function readZero() {
  return 0;
}

function readMailLastHour() {
  const cutoff = Date.now() - 3_600_000;
  return getMail().filter((m) => m.createdAt >= cutoff && m.state === "sent").length;
}

function RailButton({
  icon: Icon,
  label,
  on = false,
  live = false,
  count = 0,
  onClick,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  on?: boolean;
  live?: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`rail-btn${on ? " is-on" : ""}${live ? " is-live" : ""}`} onClick={onClick} aria-label={label} data-label={label} aria-pressed={on}>
      <Icon size={18} strokeWidth={1.7} />
      {count ? <span className="rail-count">{count > 9 ? "9+" : count}</span> : null}
    </button>
  );
}

/**
 * The rail: the mark, home, the team and the mail. It is the only thing
 * outside the sheet, so every page keeps the same edge. Each icon says what
 * it is on hover, beside the rail.
 */
export const Rail = memo(function Rail() {
  const panel = useSyncExternalStore(subscribePanel, getPanel, getServerPanel);
  useSyncExternalStore(subscribeTasks, getTasksVersion, readZero);
  const sent = useSyncExternalStore(subscribeMail, readMailLastHour, readZero);
  const running = getTasks().filter((t) => t.state === "running");

  return (
    <nav className="rail" aria-label="SmallCircles">
      <button
        type="button"
        className="rail-mark"
        onClick={() => {
          setQuery("");
          selectBoard(null);
          setPanel(null);
        }}
        aria-label="SmallCircles home"
        data-label="Home"
      >
        <Mark size={38} />
      </button>

      <div className="rail-set">
        <RailButton
          icon={House}
          label="Home"
          on={!panel}
          onClick={() => {
            setQuery("");
            selectBoard(null);
            setPanel(null);
          }}
        />
        <RailButton icon={Orbit} label="The team" on={panel === "team"} live={running.length > 0} onClick={() => togglePanel("team")} />
        <RailButton icon={Mail} label="Mail" on={panel === "mail"} count={sent} onClick={() => togglePanel("mail")} />
      </div>

   </nav>
  );
});
