/**
 * The title screen's glass keys. Each key blurs and saturates what's behind
 * it, takes its tint from the photo, and darkens just enough that its white
 * words stay readable (`adapt`), the way Apple's Liquid Glass adapts to what
 * it floats over. In Chrome and Edge the edges also bend what's behind them
 * (`lens`); Safari and Firefox don't run SVG filters in backdrop-filter, so
 * they keep the frosted glass.
 */
import { clamp, mirror, type Geo, type Kind } from "./frame";

let lumMap: { kind: Kind; w: number; h: number; L: Float32Array } | null = null;

function linear(c: number): number {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** The photo's brightness in a 160 px copy, read once per frame kind. */
function lumOf(photo: HTMLImageElement, g: Geo): typeof lumMap {
  if (lumMap && lumMap.kind === g.kind) return lumMap;
  if (!photo.naturalWidth) return null;
  return readLum(photo, g);
}

function readLum(
  src: CanvasImageSource,
  g: Geo,
  w = 160,
  h = Math.round(160 / g.fr.aspect),
): typeof lumMap {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  try {
    x.drawImage(src, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    const L = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      L[i] =
        0.2126 * linear(d[i * 4]) +
        0.7152 * linear(d[i * 4 + 1]) +
        0.0722 * linear(d[i * 4 + 2]);
    }
    lumMap = { kind: g.kind, w, h, L };
  } catch {
    return null;
  }
  return lumMap;
}

/**
 * Read the brightness ahead of time, with the photo shrunk off the main
 * thread (createImageBitmap's resize), so placing the keys doesn't resample
 * a full-size photo on it. Falls back to lumOf's own read.
 */
export async function prepareLum(
  photo: HTMLImageElement,
  g: Geo,
): Promise<void> {
  if ((lumMap && lumMap.kind === g.kind) || !photo.naturalWidth) return;
  const w = 160;
  const h = Math.round(160 / g.fr.aspect);
  try {
    const small = await createImageBitmap(photo, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: "medium",
    });
    readLum(small, g, w, h);
    small.close();
  } catch {
    // lumOf reads it when it's first needed.
  }
}

/**
 * Darken each glass item just enough that white words on it pass 4.5:1
 * against the brightest part of what's behind (the 90th percentile, blurred
 * by the glass). `min` keeps it glass, `max` keeps the photo showing.
 */
export function adapt(
  photo: HTMLImageElement,
  g: Geo,
  els: HTMLElement[],
  o: { min?: number; max?: number } = {},
): void {
  const map = lumOf(photo, g);
  if (!map) return;
  // The dusk grade (dark mode) dims the photo to about a quarter.
  const dim = document.documentElement.classList.contains("dark") ? 0.26 : 1;
  const tintL = 0.008; // the tint's own luminance
  const target = 0.165; // white on this is about 4.9:1
  for (const el of els) {
    const r = el.getBoundingClientRect();
    const vals: number[] = [];
    for (let y = r.top; y <= r.bottom; y += Math.max(2, r.height / 6)) {
      for (let x = r.left; x <= r.right; x += Math.max(2, r.width / 10)) {
        const u = mirror((x - g.x) / g.w);
        const v = (y - g.y) / g.h;
        if (v < 0 || v >= 1) continue;
        vals.push(
          map.L[Math.floor(v * map.h) * map.w + Math.floor(u * map.w)] * dim,
        );
      }
    }
    if (!vals.length) continue;
    vals.sort((a, b) => a - b);
    const Lb = vals[Math.floor(vals.length * 0.9)];
    let a = Lb <= target ? 0 : (Lb - target) / (Lb - tintL);
    a = clamp(Math.max(a, o.min ?? 0.16), 0, o.max ?? 0.8);
    el.style.setProperty("--g-a", a.toFixed(3));
  }
}

/* ---------- The bend at the edges (Chrome and Edge) ---------- */
/* A displacement map per size: inside a bezel the backdrop is pulled inward
   along the edge's normal, on a squircle-ish profile, after kube.io's
   "Liquid Glass in CSS and SVG" and shuding's liquid-glass (MIT). */

type UAData = { brands?: { brand: string }[] };
const chromium = (): boolean =>
  Boolean(
    (
      navigator as Navigator & { userAgentData?: UAData }
    ).userAgentData?.brands?.some((b) => /Chromium/.test(b.brand)),
  );
let lensDefs: SVGSVGElement | null = null;
let lensCount = 0;
const lensCache = new Map<string, string>();

function lensMap(w: number, h: number, rad: number, bez: number): string {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  // A canvas kept in memory, not on the GPU: encoding a GPU canvas reads it
  // back, which took 50 to 300 ms a map on a slowed-down phone.
  const x = c.getContext("2d", { willReadFrequently: true })!;
  const img = x.createImageData(w, h);
  const d = img.data;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      // Signed distance to the rounded rectangle (negative inside) and its normal.
      const qx = Math.abs(px + 0.5 - w / 2) - (w / 2 - rad);
      const qy = Math.abs(py + 0.5 - h / 2) - (h / 2 - rad);
      const dist =
        Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
        Math.min(Math.max(qx, qy), 0) -
        rad;
      let nx: number;
      let ny: number;
      if (qx > 0 && qy > 0) {
        const l = Math.hypot(qx, qy) || 1;
        nx = qx / l;
        ny = qy / l;
      } else if (qx > qy) {
        nx = 1;
        ny = 0;
      } else {
        nx = 0;
        ny = 1;
      }
      nx *= px + 0.5 < w / 2 ? -1 : 1;
      ny *= py + 0.5 < h / 2 ? -1 : 1;
      const t = clamp(-dist / bez, 0, 1); // 0 at the edge, 1 past the bezel
      const m = t >= 1 ? 0 : Math.pow(1 - t, 2.2); // strongest at the rim
      const i = (py * w + px) * 4;
      // Sample from further inside near the rim, so the edge magnifies like a
      // thick lens (a backdrop filter can't see past the element's own box).
      d[i] = 128 - Math.round(nx * m * 127);
      d[i + 1] = 128 - Math.round(ny * m * 127);
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return c.toDataURL();
}

export function lens(el: HTMLElement, reduced: boolean): void {
  if (reduced || !chromium()) return;
  const r = el.getBoundingClientRect();
  const w = Math.round(r.width);
  const h = Math.round(r.height);
  if (w < 8 || h < 8) return;
  const rad = Math.min(
    parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
    h / 2,
    w / 2,
  );
  const bez = Math.min(14, h * 0.32);
  const scale = Math.min(34, h * 0.55);
  const key = `${w}x${h}r${rad}b${bez}`;
  let id = lensCache.get(key);
  if (!id) {
    const NS = "http://www.w3.org/2000/svg";
    if (!lensDefs) {
      lensDefs = document.createElementNS(NS, "svg");
      lensDefs.setAttribute("width", "0");
      lensDefs.setAttribute("height", "0");
      lensDefs.setAttribute("aria-hidden", "true");
      lensDefs.style.position = "absolute";
      document.body.append(lensDefs);
    }
    id = `title-lens-${++lensCount}`;
    const f = document.createElementNS(NS, "filter");
    f.setAttribute("id", id);
    f.setAttribute("x", "0");
    f.setAttribute("y", "0");
    f.setAttribute("width", String(w));
    f.setAttribute("height", String(h));
    f.setAttribute("filterUnits", "userSpaceOnUse");
    f.setAttribute("color-interpolation-filters", "sRGB");
    const fi = document.createElementNS(NS, "feImage");
    fi.setAttribute("href", lensMap(w, h, rad, bez));
    fi.setAttribute("x", "0");
    fi.setAttribute("y", "0");
    fi.setAttribute("width", String(w));
    fi.setAttribute("height", String(h));
    fi.setAttribute("preserveAspectRatio", "none");
    fi.setAttribute("result", "map");
    const dm = document.createElementNS(NS, "feDisplacementMap");
    dm.setAttribute("in", "SourceGraphic");
    dm.setAttribute("in2", "map");
    dm.setAttribute("scale", String(scale));
    dm.setAttribute("xChannelSelector", "R");
    dm.setAttribute("yChannelSelector", "G");
    f.append(fi, dm);
    lensDefs.append(f);
    lensCache.set(key, id);
  }
  el.style.setProperty("--g-lens", `blur(0px) url(#${id})`);
}
