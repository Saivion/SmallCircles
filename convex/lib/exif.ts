/**
 * Camera metadata → the circle's `metadata`. Runs in the browser (uploads)
 * and in actions (emailed photos), so both paths read a photo the same way.
 *
 * exifr revives "2026:06:14 20:32:00" into a Date in the runtime's own zone,
 * so reading it back with local getters recovers the camera's wall clock,
 * which is what "8:32 in the evening" means to the person who took it.
 */
import type { PhotoMeta } from "./circleFields";

const pad = (n: number) => String(n).padStart(2, "0");

function wallClock(d: unknown): string | undefined {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return undefined;
  const y = d.getFullYear();
  if (y < 1900 || y > 2100) return undefined;
  return `${y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Normalise an exifr `parse(…, { gps: true })` result. Anything missing stays missing. */
export function metaFromExif(x: Record<string, unknown> | null | undefined): PhotoMeta {
  if (!x) return {};
  const takenAt = wallClock(x.DateTimeOriginal) ?? wallClock(x.CreateDate) ?? wallClock(x.ModifyDate);
  const lat = x.latitude;
  const lng = x.longitude;
  const make = typeof x.Make === "string" ? x.Make.trim() : "";
  const model = typeof x.Model === "string" ? x.Model.trim() : "";
  const camera = model.toLowerCase().startsWith(make.toLowerCase()) ? model : [make, model].filter(Boolean).join(" ");
  const width = x.ExifImageWidth ?? x.ImageWidth;
  const height = x.ExifImageHeight ?? x.ImageHeight;
  return {
    ...(takenAt ? { takenAt } : {}),
    ...(finite(lat) && finite(lng) && !(lat === 0 && lng === 0) ? { lat, lng } : {}),
    ...(camera ? { camera: camera.slice(0, 80) } : {}),
    ...(finite(width) ? { width } : {}),
    ...(finite(height) ? { height } : {}),
  };
}
