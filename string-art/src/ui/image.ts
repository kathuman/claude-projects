// Getting pixels: from an uploaded file, or the built-in drawn sample.

import type { Rgba } from "../core/preprocess";

/** Longest side kept when decoding an upload: far more than the 1200 px maximum working resolution needs. */
const MAX_SIDE = 2400;

/** Decode an image file (JPG, PNG, WebP) to RGBA pixels, scaled down if it is very large. */
export async function loadImageFile(file: File): Promise<Rgba> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("unsupported");
  const bmp = await createImageBitmap(file);
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

/** A drawn high-contrast face, so the app can be tried without a photo. */
export function drawSample(size = 1000): Rgba {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const g = c.getContext("2d", { willReadFrequently: true })!, u = size;
  const ell = (x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient, rot = 0) => {
    g.beginPath(); g.ellipse(x * u, y * u, rx * u, ry * u, rot, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
  };
  g.fillStyle = "#f4f4f4"; g.fillRect(0, 0, u, u);
  ell(0.5, 1.02, 0.42, 0.2, "#3a3a3a");                                   // shoulders
  ell(0.5, 0.86, 0.09, 0.12, "#9a9a9a");                                  // neck
  ell(0.5, 0.33, 0.29, 0.25, "#111111");                                  // hair, back
  const face = g.createLinearGradient(0.26 * u, 0, 0.74 * u, 0);
  face.addColorStop(0, "#dedede"); face.addColorStop(0.55, "#c4c4c4"); face.addColorStop(1, "#7a7a7a");
  ell(0.5, 0.52, 0.22, 0.29, face);                                       // face, lit from the left
  g.beginPath(); g.moveTo(0.27 * u, 0.42 * u);                            // fringe
  g.bezierCurveTo(0.33 * u, 0.2 * u, 0.62 * u, 0.18 * u, 0.74 * u, 0.44 * u);
  g.bezierCurveTo(0.64 * u, 0.3 * u, 0.45 * u, 0.29 * u, 0.27 * u, 0.42 * u); g.fillStyle = "#111111"; g.fill();
  for (const sx of [-1, 1]) {
    ell(0.5 + sx * 0.085, 0.49, 0.05, 0.022, "#ffffff");                  // eyes
    ell(0.5 + sx * 0.085, 0.49, 0.022, 0.022, "#0a0a0a");
    g.save(); g.lineWidth = 0.012 * u; g.strokeStyle = "#202020"; g.lineCap = "round";   // brows
    g.beginPath(); g.moveTo((0.5 + sx * 0.04) * u, 0.44 * u); g.quadraticCurveTo((0.5 + sx * 0.09) * u, 0.42 * u, (0.5 + sx * 0.14) * u, 0.445 * u); g.stroke(); g.restore();
  }
  g.save(); g.lineWidth = 0.008 * u; g.strokeStyle = "#555555"; g.lineCap = "round";   // nose
  g.beginPath(); g.moveTo(0.505 * u, 0.5 * u); g.lineTo(0.525 * u, 0.6 * u); g.lineTo(0.49 * u, 0.61 * u); g.stroke(); g.restore();
  ell(0.5, 0.685, 0.06, 0.018, "#3b3b3b");                                // mouth
  const d = g.getImageData(0, 0, u, u);
  return { data: d.data, width: u, height: u };
}
