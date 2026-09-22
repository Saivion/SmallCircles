"use client";

import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useState, type FormEvent } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { MEMORY_STARTERS, REACTIONS } from "@convex/lib/reactions";
import { hash } from "@/lib/doodle/pen";
import { isPhoto, preparePhoto } from "@/lib/moment";
import { openView } from "@/lib/route";
import { useObjectUrl } from "@/lib/useObjectUrl";
import { DoodleIcon } from "./Doodle";

type Kind = "reaction" | "note" | "memory" | "photo";

const KINDS: { kind: Kind; word: string; doodle: string }[] = [
  { kind: "reaction", word: "reaction", doodle: "heart" },
  { kind: "note", word: "note", doodle: "star" },
  { kind: "memory", word: "memory", doodle: "calendar" },
  { kind: "photo", word: "photo", doodle: "camera" },
];

function message(err: unknown): string {
  if (err instanceof ConvexError && typeof err.data === "string") return err.data.toLowerCase();
  return "that didn't go through. try again?";
}

/**
 * Adding to someone's circle. Fast on purpose: a reaction is one tap, a note
 * is a line, a memory starts itself, a photo is one pick. Whatever you add is
 * drawn onto the circle's outer ring while you watch.
 */
export function AddSomething({ slug, circleId, title, fromDiscover }: { slug: string; circleId: Id<"circles">; title: string; fromDiscover: boolean }) {
  const add = useMutation(api.contributions.add);
  const uploadUrl = useMutation(api.contributions.uploadUrl);
  const [kind, setKind] = useState<Kind>("reaction");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const preview = useObjectUrl(file);

  const reset = () => {
    setText("");
    setFile(null);
  };

  const send = async (args: { type: Kind; text?: string; reaction?: string; storageId?: Id<"_storage"> }, what: string) => {
    setBusy(true);
    setError(null);
    try {
      await add({ slug, circleId, ...args });
      reset();
      setDone(what);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (kind === "photo") {
      if (!file) return;
      setBusy(true);
      try {
        const { blob } = await preparePhoto(file);
        const url = await uploadUrl({ slug });
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob });
        if (!res.ok) throw new Error("upload failed");
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await send({ type: "photo", storageId, ...(text.trim() ? { text: text.trim() } : {}) }, "your photo");
      } catch (err) {
        setError(message(err));
        setBusy(false);
      }
      return;
    }
    if (!text.trim()) return;
    await send({ type: kind, text: text.trim() }, kind === "memory" ? "your memory" : "your note");
  };

  if (done) {
    return (
      <section className="add add-done">
        <span className="add-tape" aria-hidden />
        <p className="stamp">added</p>
        <p className="add-done-line">{done} is on the circle now. watch it draw in.</p>
        <div className="add-done-actions">
          {fromDiscover ? (
            <button type="button" className="pill" onClick={() => openView("discover")}>
              next moment →
            </button>
          ) : (
            <button type="button" className="pill" onClick={() => openView("discover")}>
              visit another moment →
            </button>
          )}
          <button type="button" className="link-quiet" onClick={() => setDone(null)}>
            add something else
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="add" aria-label="add something">
      <span className="add-tape" aria-hidden />
      <p className="stamp">add something</p>
      <p className="add-title">
        to <em>{title}</em>
      </p>
      <p className="add-sub">whatever you add is drawn onto their circle.</p>
      <div className="add-kinds" role="tablist">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="tab"
            aria-selected={kind === k.kind}
            className={`add-kind${kind === k.kind ? " is-on" : ""}`}
            onClick={() => {
              setKind(k.kind);
              setError(null);
            }}
          >
            <DoodleIcon id={k.doodle} seed={hash(`kind:${k.kind}`)} size={24} marker={kind === k.kind ? undefined : null} />
            <span>{k.word}</span>
          </button>
        ))}
      </div>

      {kind === "reaction" ? (
        <div className="add-reactions">
          {REACTIONS.map((r) => (
            <button key={r.id} type="button" className="add-reaction" disabled={busy} onClick={() => void send({ type: "reaction", reaction: r.id }, `"${r.word}"`)}>
              <DoodleIcon id={r.id} seed={hash(`reaction:${r.id}`)} size={42} />
              <span>{r.word}</span>
            </button>
          ))}
        </div>
      ) : (
        <form className="add-form" onSubmit={submit}>
          {kind === "memory" ? (
            <div className="add-starters">
              {MEMORY_STARTERS.map((s) => (
                <button key={s} type="button" className="name-chip" onClick={() => setText(`${s} `)}>
                  {s}…
                </button>
              ))}
            </div>
          ) : null}
          {kind === "photo" ? (
            <label className={`add-photo${preview ? " has-photo" : ""}`}>
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="your photo" />
              ) : (
                <span className="hand">choose a photo of your own</span>
              )}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && isPhoto(f)) setFile(f);
                }}
              />
            </label>
          ) : null}
          <input
            className="add-input"
            value={text}
            maxLength={120}
            onChange={(e) => setText(e.target.value)}
            placeholder={kind === "note" ? "say something small" : kind === "memory" ? "this reminds me of…" : "a few words (optional)"}
            aria-label={kind === "photo" ? "a caption" : `your ${kind}`}
          />
          <button type="submit" className="pill" disabled={busy || (kind === "photo" ? !file : !text.trim())}>
            {busy ? "adding…" : "add it"}
          </button>
        </form>
      )}
      {error ? <p className="add-error">{error}</p> : null}
    </section>
  );
}

type Contribution = {
  _id: Id<"contributions">;
  by: string;
  type: Kind;
  text: string | null;
  illustration: string;
  label: string;
  photoUrl: string | null;
  state: "reading" | "ok";
  isMine: boolean;
  createdAt: number;
};

const KIND_WORD: Record<Kind, string> = { reaction: "a reaction", note: "a note", memory: "a memory", photo: "a photo" };

/** One thing someone added, open: bigger, with their words. */
export function ContributionCard({ slug, k, onClose }: { slug: string; k: Contribution; onClose: () => void }) {
  const remove = useMutation(api.contributions.remove);
  return (
    <article className="explore" key={k._id}>
      <button type="button" className="explore-close" onClick={onClose} aria-label="close">
        ×
      </button>
      <p className="stamp">
        {KIND_WORD[k.type]} from {k.by}
      </p>
      {k.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="explore-photo" src={k.photoUrl} alt={k.text ?? "their photo"} />
      ) : (
        <div className="explore-art">
          <DoodleIcon id={k.illustration} seed={hash(k._id)} size={120} delay={0} />
        </div>
      )}
      <h2 className="hand explore-label">{k.label}</h2>
      {k.text && k.type !== "reaction" ? <p className="explore-said">&ldquo;{k.text}&rdquo;</p> : null}
      {k.state === "reading" ? <p className="explore-meaning">small circles is reading it before it goes on the circle.</p> : null}
      {k.isMine ? (
        <button
          type="button"
          className="link-quiet"
          onClick={() => {
            void remove({ slug, contributionId: k._id }).then(onClose);
          }}
        >
          take it back
        </button>
      ) : null}
    </article>
  );
}
