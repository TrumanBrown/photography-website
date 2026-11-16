/**
 * The round postmark: a name round the top, the day in the middle and wavy
 * cancellation bars off to the left, drawn on its own canvas. The hiking
 * postcard slams it onto its corner (hiking-renderer.ts places it there), and
 * "Write to me" stamps it on the envelope a sent message folds into. It's
 * here rather than in the hiking renderer so the drawer, which is on every
 * page, doesn't load the renderer.
 */

import { canvasFont } from "./canvas-font";

/** The postmark's ring radius on its canvas, px. */
export const POSTMARK_RADIUS = 128;

const MONTHS_SHORT = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

function makeRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A round postmark with the trail's name round the top and the day in the
 * middle, and the wavy cancellation bars running off to the left, drawn on
 * its own canvas so it can be slammed onto the print and then painted into
 * the postcard. The ink is worn in places, like a real one. `light` inks it
 * pale, for a dark sky.
 */
export function makePostmark(
  name: string,
  day: Date,
  light: boolean,
  seed = 1,
): HTMLCanvasElement {
  const r = POSTMARK_RADIUS;
  const bars = r * 2.1;
  const pad = 10;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bars + r * 2 + pad * 2);
  canvas.height = Math.round(r * 2 + pad * 2);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const cx = pad + bars + r;
  const cy = pad + r;
  const ink = light ? "rgba(250,246,236,0.9)" : "rgba(30,27,24,0.82)";
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = "round";

  // Two rings.
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();

  // The trail's name round the top, between the rings.
  const label = name.toUpperCase().slice(0, 28);
  const textR = r * 0.81;
  ctx.font = canvasFont(Math.round(r * 0.2));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const widths = Array.from(
    label,
    (ch) => ctx.measureText(ch).width + r * 0.035,
  );
  const total = widths.reduce((a, b) => a + b, 0);
  const span = Math.min(Math.PI * 1.15, total / textR);
  const scale = span / (total / textR);
  let angle = -Math.PI / 2 - span / 2;
  for (let i = 0; i < label.length; i++) {
    const step = (widths[i] * scale) / textR;
    angle += step / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(angle) * textR, cy + Math.sin(angle) * textR);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillText(label[i], 0, 0);
    ctx.restore();
    angle += step / 2;
  }

  // Stars either side at the bottom (a glyph Libre Franklin doesn't carry, so
  // the fallback draws it), and the day in the middle.
  ctx.font = canvasFont(Math.round(r * 0.17));
  ctx.fillText("\u2605", cx - textR * 0.92, cy + textR * 0.4);
  ctx.fillText("\u2605", cx + textR * 0.92, cy + textR * 0.4);
  ctx.font = canvasFont(Math.round(r * 0.3));
  ctx.fillText(
    `${MONTHS_SHORT[day.getMonth()]} ${day.getDate()}`,
    cx,
    cy - r * 0.1,
  );
  ctx.font = canvasFont(Math.round(r * 0.19));
  ctx.fillText(String(day.getFullYear()), cx, cy + r * 0.24);

  // Cancellation bars.
  ctx.lineWidth = 6;
  for (let b = 0; b < 5; b++) {
    const y = cy - r * 0.6 + b * r * 0.3;
    ctx.beginPath();
    for (let x = pad; x <= pad + bars - r * 0.05; x += 4) {
      const wave = Math.sin((x / bars) * Math.PI * 4 + b * 0.3) * r * 0.06;
      if (x === pad) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }

  // Wear: knock specks out of the ink.
  const random = makeRng(seed * 31 + 7);
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 520; i++) {
    const size = random() * 3.4 + 0.6;
    ctx.globalAlpha = 0.35 + random() * 0.65;
    ctx.fillRect(random() * canvas.width, random() * canvas.height, size, size);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  return canvas;
}

/** Centre of the ring on a postmark canvas from makePostmark. */
export function postmarkCentre(mark: HTMLCanvasElement): {
  x: number;
  y: number;
} {
  return { x: mark.width - 10 - POSTMARK_RADIUS, y: mark.height / 2 };
}
