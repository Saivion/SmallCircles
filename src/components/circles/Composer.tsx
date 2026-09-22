"use client";

import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PhotoMeta } from "@convex/lib/circleFields";
import { preparePhoto } from "@/lib/moment";
import { useObjectUrl } from "@/lib/useObjectUrl";

type Props = {
  slug: string;
  file: File;
  prompt: string;
  onClose: () => void;
  onShared: (id: Id<"circles">) => void;
};

type Upload = { storageId: Id<"_storage">; metadata: PhotoMeta };

function message(err: unknown): string {
  if (err instanceof ConvexError && typeof err.data === "string") return err.data.toLowerCase();
  return "that didn't go through. try again?";
}

/**
 * Sharing a moment: the photo, a few optional words, and one button. The
 * upload starts the moment the photo is picked, so "share it" is instant.
 */
export function Composer({ slug, file, prompt, onClose, onShared }: Props) {
  const uploadUrl = useMutation(api.circles.uploadUrl);
  const create = useMutation(api.circles.create);
  const preview = useObjectUrl(file);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = useRef<Promise<Upload> | null>(null);

  const startUpload = useCallback((): Promise<Upload> => {
    const p = (async () => {
      const { blob, metadata } = await preparePhoto(file);
      const url = await uploadUrl({ slug });
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob });
      if (!res.ok) throw new Error("upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      return { storageId, metadata };
    })();
    p.catch(() => {});
    return p;
  }, [file, slug, uploadUrl]);

  // Start sending the photo now; the words can follow.
  useEffect(() => {
    upload.current ??= startUpload();
  }, [startUpload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const share = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { storageId, metadata } = await (upload.current ??= startUpload());
      const words = note.trim();
      onShared(await create({ slug, storageId, metadata, ...(words ? { note: words } : {}) }));
    } catch (err) {
      setError(message(err));
      setBusy(false);
      // A failed upload can be retried from scratch.
      upload.current = null;
    }
  };

  return (
    <div className="sheet-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <form className="composer" onSubmit={share} onClick={(e) => e.stopPropagation()} aria-label="share a moment">
        <p className="stamp">this hour</p>
        <h2 className="composer-prompt">{prompt}</h2>
        <div className="composer-print">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="your photo" /> : <span className="composer-empty" />}
          <span className="composer-tape" aria-hidden />
          {/* what they write, captioned on the print's chin as they type */}
          <span className={`composer-chin${note.trim() ? "" : " is-empty"}`} aria-hidden>
            {note.trim() || "your words go here"}
          </span>
        </div>

        <div className="composer-field">
          <label className="composer-label" htmlFor="composer-note">
            <span className="stamp">a few words</span>
            <span className="stamp composer-count">{note.length ? `${note.length}/140` : "optional"}</span>
          </label>
          <input
            id="composer-note"
            className="composer-note"
            placeholder="where, who, what it felt like…"
            maxLength={140}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
        </div>

        <p className="composer-fine">
          <span>everyone here can see it and add to it.</span>
          <span>the location data in your photo stays private.</span>
        </p>

        <div className="composer-actions">
          <button type="button" className="link-quiet" onClick={onClose} disabled={busy}>
            not this one
          </button>
          <button type="submit" className="pill composer-share" disabled={busy}>
            {busy ? "capturing…" : "capture this moment →"}
          </button>
        </div>
        {error ? <p className="drop-error composer-error">{error}</p> : null}
      </form>
    </div>
  );
}
