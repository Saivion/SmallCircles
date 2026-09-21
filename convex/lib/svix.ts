/**
 * Svix-style webhook signature verification (used by AgentMail) with Web Crypto
 * only, so it runs in the default Convex runtime with no imports.
 *
 * Signed content: `${svix-id}.${svix-timestamp}.${rawBody}`; HMAC-SHA256 with
 * the base64-decoded secret (after stripping the `whsec_` prefix); the
 * `svix-signature` header holds space-separated `v1,<base64>` entries.
 */
export const SVIX_TOLERANCE_MS = 5 * 60 * 1000;

export function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: ArrayBuffer): string {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSvix(
  secret: string,
  id: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const keyMaterial = b64ToBytes(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`);
  return bytesToB64(await crypto.subtle.sign("HMAC", key, signed));
}

export async function verifySvix(
  rawBody: string,
  headers: { get(name: string): string | null },
  secret: string,
  now: number = Date.now(),
): Promise<boolean> {
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  const tsMs = tsNum * 1000; // Svix timestamps are seconds
  if (Math.abs(now - tsMs) > SVIX_TOLERANCE_MS) return false;

  const expected = await signSvix(secret, id, ts, rawBody);
  for (const entry of sigHeader.split(" ")) {
    const [version, sig] = entry.split(",");
    if (version === "v1" && sig && timingSafeEqual(sig, expected)) return true;
  }
  return false;
}
