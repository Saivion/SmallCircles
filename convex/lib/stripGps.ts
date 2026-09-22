/**
 * Take the location out of a JPEG before it's shared with strangers.
 *
 * Photos taken in the page are re-drawn by the browser, which drops all
 * metadata. Photos that arrive by email come straight off a phone, with GPS
 * inside. This clears the EXIF GPS block in place (entries and the values they
 * point to), and drops XMP, which can carry a location too. Everything else
 * stays, orientation included, so portraits still stand up. Pure, no deps.
 */

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const XMP = "http://ns.adobe.com/xap/1.0/";

function isJpeg(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0xff && b[1] === 0xd8;
}

function ascii(b: Uint8Array, at: number, n: number): string {
  let s = "";
  for (let i = 0; i < n && at + i < b.length; i++) s += String.fromCharCode(b[at + i]);
  return s;
}

/** Zero the GPS IFD inside one EXIF segment. `seg` is a copy we're allowed to write. */
function clearGps(seg: Uint8Array, tiff: number): void {
  const view = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
  const order = ascii(seg, tiff, 2);
  if (order !== "II" && order !== "MM") return;
  const le = order === "II";
  const u16 = (at: number) => (at + 2 <= seg.length ? view.getUint16(at, le) : -1);
  const u32 = (at: number) => (at + 4 <= seg.length ? view.getUint32(at, le) : -1);
  const zero = (from: number, n: number) => {
    for (let i = from; i < from + n && i < seg.length; i++) seg[i] = 0;
  };

  const ifd0 = u32(tiff + 4);
  if (ifd0 < 0) return;
  const n0 = u16(tiff + ifd0);
  if (n0 < 0 || n0 > 500) return;
  for (let i = 0; i < n0; i++) {
    const entry = tiff + ifd0 + 2 + i * 12;
    if (u16(entry) !== 0x8825) continue; // GPSInfo pointer
    const gps = u32(entry + 8);
    if (gps < 0) return;
    const at = tiff + gps;
    const n = u16(at);
    if (n < 0 || n > 200) return;
    for (let k = 0; k < n; k++) {
      const e = at + 2 + k * 12;
      const size = (TYPE_SIZE[u16(e + 2)] ?? 1) * Math.max(0, u32(e + 4));
      // Values longer than four bytes live elsewhere: clear them where they are.
      if (size > 4) {
        const off = u32(e + 8);
        if (off >= 0) zero(tiff + off, Math.min(size, 4096));
      }
      zero(e, 12);
    }
    view.setUint16(at, 0, le); // no entries left
    return;
  }
}

export function stripGps(input: Uint8Array): Uint8Array {
  if (!isJpeg(input)) return input;
  const parts: Uint8Array[] = [input.subarray(0, 2)];
  let pos = 2;
  while (pos + 4 <= input.length) {
    if (input[pos] !== 0xff) break; // not where a marker should be: stop and keep the rest as is
    const marker = input[pos + 1];
    // Start of scan (image data) or end of image: everything after is pixels.
    if (marker === 0xda || marker === 0xd9) break;
    const len = (input[pos + 2] << 8) | input[pos + 3];
    const end = pos + 2 + len;
    if (len < 2 || end > input.length) break;
    if (marker === 0xe1) {
      if (ascii(input, pos + 4, 6) === "Exif\0\0") {
        const seg = input.slice(pos, end); // a copy we can write into
        clearGps(seg, 10);
        parts.push(seg);
      } else if (ascii(input, pos + 4, XMP.length) !== XMP) {
        parts.push(input.subarray(pos, end));
      } // XMP: dropped
    } else {
      parts.push(input.subarray(pos, end));
    }
    pos = end;
  }
  parts.push(input.subarray(pos));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
