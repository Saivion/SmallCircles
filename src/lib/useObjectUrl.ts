"use client";

import { useEffect, useState } from "react";

/**
 * A local preview URL for a picked photo, released when the photo changes or
 * the component goes. Made inside the effect (not during render) so React's
 * double-mount in development can't hand the page a URL it already revoked.
 */
export function useObjectUrl(file: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    const next = URL.createObjectURL(file);
    const frame = requestAnimationFrame(() => setUrl(next));
    return () => {
      cancelAnimationFrame(frame);
      URL.revokeObjectURL(next);
      setUrl((u) => (u === next ? null : u));
    };
  }, [file]);
  return file ? url : null;
}
