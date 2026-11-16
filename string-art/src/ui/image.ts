// Getting pixels: from an uploaded file, or the bundled sample portrait.

import type { Rgba } from "../core/preprocess";
import sampleUrl from "./sample-portrait.jpg";

/** Longest side kept when decoding an upload: far more than the 1200 px maximum working resolution needs. */
const MAX_SIDE = 2400;

/** Decode an image file (JPG, PNG, WebP) to RGBA pixels, scaled down if it is very large. */
export async function loadImageFile(file: File): Promise<Rgba> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("unsupported");
  return decode(file);
}

async function decode(blob: Blob): Promise<Rgba> {
  const bmp = await createImageBitmap(blob);
  try {
    const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#ffffff";   // transparent areas become white board
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    return { data: d.data, width: w, height: h };
  } finally {
    bmp.close();
  }
}

/** The bundled sample portrait, so the app can be tried without a photo of your own. */
export async function loadSample(): Promise<Rgba> {
  const blob = await (await fetch(sampleUrl)).blob();
  return decode(blob);
}
