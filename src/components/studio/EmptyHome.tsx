"use client";

import { useMutation } from "convex/react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { selectBoard } from "@/lib/mind/ui";
import { Mark } from "./Circles";
import { Dither } from "./Dither";

const SAMPLES = ["brutalist poster type", "cozy reading nooks", "90s web design", "ceramic glaze tests", "moody film stills"];

function errorText(e: unknown, fallback: string) {
  if (e && typeof e === "object" && "data" in e && typeof (e as { data: unknown }).data === "string") return (e as { data: string }).data;
  return e instanceof Error ? e.message.split("\n")[0] : fallback;
}

type State = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "error"; text: string };

/**
 * The landing page, shown only when there are no circles yet: the name at
 * the top, one line saying what this is, the field you actually use, and a
 * few samples. The dither sits behind it.
 */
export const EmptyHome = memo(function EmptyHome({ canvasId }: { canvasId: Id<"canvases"> | null }) {
  const submit = useMutation(api.boards.submit);
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = state.kind === "busy";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) return;
      if (e.key === "+" || e.key === "n" || e.key === "N" || e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const start = async (value: string) => {
    const prompt = value.trim();
    if (!canvasId || !prompt || busy) return;
    setState({ kind: "busy", text: prompt });
    try {
      const res = await submit({ canvasId, text: prompt });
      selectBoard(res.boardId);
    } catch (e) {
      setState({ kind: "error", text: errorText(e, "Could not start that circle.") });
    }
  };

  return (
    <div className="landing">
      <Dither />

      <header className="landing-bar">
        <Mark size={30} />
        <span className="landing-name">SmallCircles</span>
      </header>

      <main className="landing-main">
        <h1 className="landing-lede">
          Name what you are looking for.
          <span> A small team finds it, reads every page, and keeps what fits.</span>
        </h1>

        <form
          className="landing-field"
          onSubmit={(e) => {
            e.preventDefault();
            void start(text);
          }}
        >
          <input
            ref={inputRef}
            value={text}
            maxLength={2000}
            placeholder="Draw your first circle…"
            aria-label="What should the first circle gather? Or paste links."
            disabled={busy || !canvasId}
            onChange={(e) => {
              setText(e.target.value);
              if (state.kind === "error") setState({ kind: "idle" });
            }}
          />
          <button type="submit" className="landing-go" aria-label="Draw the circle" disabled={!canvasId || !text.trim() || busy}>
            {busy ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={18} />}
          </button>
        </form>

        <p className={`landing-note${state.kind === "error" ? " is-error" : ""}`} role={state.kind === "error" ? "alert" : "status"}>
          {state.kind === "error" ? state.text : busy ? `Drawing “${state.text}”…` : "Or try one:"}
        </p>

        {!busy && state.kind !== "error" ? (
          <div className="landing-samples">
            {SAMPLES.map((s) => (
              <button key={s} type="button" className="landing-sample" disabled={!canvasId} onClick={() => void start(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </main>

    </div>
  );
});
