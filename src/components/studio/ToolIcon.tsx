"use client";

import { memo, useId } from "react";
import type { Tool } from "@/lib/mind/types";

/**
 * One animated picture per tool, so you can see what an agent is doing
 * without reading: a lens sweeping results (search), a browser window
 * scrolling with a cursor clicking (browse), a spark pulsing (think), a card
 * sliding onto a stack (sort), an envelope flying out (mail). Pure SVG with
 * CSS keyframes; `live` turns the motion on.
 */
export const ToolIcon = memo(function ToolIcon({ tool, size = 20, live = false }: { tool: Tool; size?: number; live?: boolean }) {
  const clip = useId();
  return (
    <svg
      className={`tool-icon tool-${tool}${live ? " is-live" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {tool === "search" ? (
        <>
          <path className="ti-faint" d="M4 6h10M4 10h7M4 14h9M4 18h6" />
          <g className="ti-lens">
            <circle cx="14" cy="12" r="4.2" fill="var(--tool-bg, #fff)" />
            <path d="M17 15l3.4 3.4" />
          </g>
        </>
      ) : null}
      {tool === "browse" ? (
        <>
          <rect x="2.8" y="3.8" width="18.4" height="16.4" rx="2.4" fill="var(--tool-bg, #fff)" />
          <path d="M2.8 8h18.4" />
          <circle cx="5.3" cy="5.9" r=".5" fill="currentColor" stroke="none" />
          <circle cx="7.1" cy="5.9" r=".5" fill="currentColor" stroke="none" />
          <clipPath id={clip}>
            <rect x="3.6" y="8.6" width="16.8" height="10.8" />
          </clipPath>
          <g clipPath={`url(#${clip})`}>
            <g className="ti-scroll">
              <path className="ti-faint" d="M5.5 11h9M5.5 13.6h12M5.5 16.2h7M5.5 18.8h10M5.5 21.4h8M5.5 24h11" />
            </g>
          </g>
          <path className="ti-pointer" d="M15 13.2l4.6 1.8-2 .7-.7 2z" fill="currentColor" strokeWidth={1} />
        </>
      ) : null}
      {tool === "think" ? (
        <>
          <path className="ti-spark" d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z" fill="var(--tool-bg, #fff)" />
          <circle className="ti-dot ti-dot-1" cx="18.6" cy="4.8" r="1.1" fill="currentColor" stroke="none" />
          <circle className="ti-dot ti-dot-2" cx="5.2" cy="19.2" r="1" fill="currentColor" stroke="none" />
        </>
      ) : null}
      {tool === "sort" ? (
        <>
          <rect className="ti-faint" x="4" y="13" width="13" height="7" rx="1.6" />
          <rect x="5.5" y="9.5" width="13" height="7" rx="1.6" fill="var(--tool-bg, #fff)" />
          <g className="ti-slide">
            <rect x="7" y="4" width="13" height="7" rx="1.6" fill="var(--tool-bg, #fff)" />
            <path d="M9.6 7.5l1.6 1.4 3-3" />
          </g>
        </>
      ) : null}
      {tool === "mail" ? (
        <>
          <path className="ti-trail" d="M1.5 9h3M1 12.5h4M2 16h2.5" />
          <g className="ti-fly">
            <rect x="6.5" y="6.5" width="15" height="11" rx="1.8" fill="var(--tool-bg, #fff)" />
            <path d="M6.9 7.3l7.1 5.4 7.1-5.4" />
          </g>
        </>
      ) : null}
    </svg>
  );
});
