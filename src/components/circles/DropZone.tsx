"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { isPhoto } from "@/lib/moment";

type Props = {
  /** A photo was dropped or chosen. */
  onPick: (file: File) => void;
  /** What the zone says. */
  children: ReactNode;
  className?: string;
};

/** The hour's circle, in the middle of the ring: drop a photo on it, or tap to choose one. */
export function DropZone({ onPick, children, className }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = (file: File | undefined) => {
    if (!file) return;
    if (!isPhoto(file)) {
      setError("small circles needs a photo.");
      return;
    }
    setError(null);
    onPick(file);
    if (input.current) input.current.value = "";
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files?.[0]);
  };

  return (
    <div
      className={`drop drop-hero${over ? " is-over" : ""}${className ? ` ${className}` : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <button type="button" className="drop-button" onClick={() => input.current?.click()}>
        {children}
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => take(e.target.files?.[0])} />
      {error ? <p className="drop-error">{error}</p> : null}
    </div>
  );
}
