/**
 * Private workspace keys without auth.
 *
 * Each browser gets an unguessable slug stored in localStorage and mirrored
 * in `?w=…`. Knowledge of the slug is access: share the URL to share the
 * workspace; visiting the bare site mints a new empty one.
 */
const STORAGE_KEY = "smallcircles.workspace";
const PARAM = "w";
/** 22 chars of base64url ≈ 132 bits. */
const SLUG_RE = /^[A-Za-z0-9_-]{20,48}$/;

export function isWorkspaceSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

function randomSlug(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  // base64url, no padding
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readUrlSlug(): string | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get(PARAM);
  if (!raw) return null;
  const slug = raw.trim();
  return isWorkspaceSlug(slug) ? slug : null;
}

function readStoredSlug(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return isWorkspaceSlug(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeStoredSlug(slug: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, slug);
  } catch {
    /* private mode / blocked */
  }
}

function writeUrlSlug(slug: string) {
  const url = new URL(window.location.href);
  if (url.searchParams.get(PARAM) === slug) return;
  url.searchParams.set(PARAM, slug);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Resolve the workspace for this tab. Prefer `?w=`, then localStorage, else
 * mint a new key and write both. Call only in the browser after mount.
 */
let resolved: string | null = null;

/** Never changes while the tab is open, so nothing to subscribe to. */
export function subscribeWorkspace() {
  return () => {};
}

/** The workspace for this tab, resolved once. */
export function getWorkspaceSlug(): string {
  return (resolved ??= resolveWorkspaceSlug());
}

/** On the server there is no URL and no storage yet. */
export function getServerWorkspaceSlug(): null {
  return null;
}

export function resolveWorkspaceSlug(): string {
  const fromUrl = readUrlSlug();
  if (fromUrl) {
    writeStoredSlug(fromUrl);
    return fromUrl;
  }
  const fromStore = readStoredSlug();
  if (fromStore) {
    writeUrlSlug(fromStore);
    return fromStore;
  }
  const next = randomSlug();
  writeStoredSlug(next);
  writeUrlSlug(next);
  return next;
}
