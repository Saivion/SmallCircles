/**
 * Getting a photo ready to become a circle, in the browser: read what the
 * camera wrote (time, place) first, because resizing throws it away, then
 * shrink the picture to a sensible size before it travels.
 */
import exifr from "exifr";
import { metaFromExif } from "@convex/lib/exif";
import type { PhotoMeta } from "@convex/lib/circleFields";

const MAX_SIDE = 2048;

export type PreparedPhoto = { blob: Blob; metadata: PhotoMeta };

async function readMeta(file: File): Promise<PhotoMeta> {
  try {
    return metaFromExif(await exifr.parse(file, { gps: true, tiff: true, exif: true }));
  } catch {
    return {};
  }
}

async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  // createImageBitmap applies the EXIF orientation, so portraits stay upright.
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("no canvas");
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.88));
  if (!blob) throw new Error("could not encode");
  return { blob, width: w, height: h };
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const metadata = await readMeta(file);
  try {
    const { blob, width, height } = await shrink(file);
    return { blob, metadata: { ...metadata, width, height } };
  } catch {
    // A format the browser can't decode (some HEICs): send it as it is.
    return { blob: file, metadata };
  }
}

export function isPhoto(file: File): boolean {
  return file.type.startsWith("image/") || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(file.name);
}
