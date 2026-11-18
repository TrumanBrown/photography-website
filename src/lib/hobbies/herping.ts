/**
 * "Night drive", the Herping hobby's toy.
 *
 * You drive slowly down a forest road at night. The roadside is drawn in
 * stipple from public-domain photos (herping-drive.ts): skunk cabbage in the
 * ditch, sword ferns along the verges, Douglas fir and red cedar trunks, mossy
 * limbs over the road, a post-and-rail fence on some stretches, edge lines,
 * centre dashes and puddles on the road. Only what the headlights reach is
 * drawn: the low beams light the road ahead and the near verges, and a
 * spotlight you steer draws the rest wherever it goes. Salamanders, newts and
 * the odd frog cross the road ahead, and snakes lie on the shoulder. Their
 * eyeshine glints in the headlights and is brightest when the spotlight is on
 * them. Tap one that's lit, or press Enter, and the car stops: the specimen
 * card shows its photo and a fact, and "Keep driving" sets off again. A field
 * journal in localStorage counts the species you've found, and a first find
 * hops into its count from the road as the card closes (journal-hop.ts).
 *
 * Dots go to the GPU through the scene renderer's WebGL sink (scenes/gl.ts),
 * or where WebGL2 isn't there, are stamped into a pixel buffer at 1x. Pauses
 * offscreen and when hidden. Under reduced motion the car stays parked,
 * nothing crawls, there's no rain and the beam goes straight where it's aimed.
 *
 * Mounted by src/components/hobbies/HerpingNight.astro via [data-hp-*] hooks.
 */
import { covered, whenUncovered } from "../covered";
import { makeRenderer } from "../scenes/gl";
import type { Sink } from "../scenes/pen";
import driveUrl from "@/assets/hobbies/herping/herping-drive.bin?url";
import driveDarkUrl from "@/assets/hobbies/herping/herping-drive-dark.bin?url";
import {
  SPECIES,
  type HerpSpecies,
  type HerpCategory,
} from "./herping-species";
import photoData from "./herping-photos.json";
import {
  mountRevealSwitch,
  playReveal,
  revealStyle,
  stopReveal,
} from "./specimen-reveal";
import { stampFind, upgradePhoto } from "./specimen";
import { journalHop, type HopSprite } from "./journal-hop";
import {
  buildTile,
  type Camera,
  camera,
  CANOPY_TOP,
  critterArt,
  type CritterArt,
  eyeshine,
  FAR,
  FENCE,
  keepShare,
  lightAt,
  lowBeam,
  MARK,
  markArea,
  nearest,
  paleness,
  parseDrive,
  PEN,
  type Prop,
  ROAD,
  spotAt,
  spotDistance,
  threshold,
  TILE,
  type Tile,
} from "./herping-drive";

/** Optional real photos per species id (CC-licensed). See herping-photos.json. */
const PHOTOS = (photoData.species ?? {}) as Record<
  string,
  { photo?: string; credit?: string }
>;

const STORE_KEY = "herping-discovered-v1";
const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 6,
  uncommon: 3,
  rare: 1,
};
/**
 * Spawn bias by category. Herping this game is salamander night — you're out on
 * a wet road mainly for the caudates — so salamanders and newts dominate what
 * turns up in the beam, with the occasional frog/toad and lizard. Garter
 * snakes turn up about one animal in seven, on the shoulder.
 */
const CATEGORY_WEIGHT: Record<HerpCategory, number> = {
  salamander: 10,
  newt: 7,
  frog: 2,
  toad: 2,
  snake: 5,
  lizard: 1.2,
};
/** Crawling speed across the road, metres a second. */
const CRAWL: Record<HerpCategory, number> = {
  salamander: 0.1,
  newt: 0.1,
  frog: 0.16,
  toad: 0.12,
  snake: 0.25,
  lizard: 0.25,
};
type Rarity = HerpSpecies["rarity"];

/** Drawn about twice life size, so you can make one out from the car. */
const LENGTH_M = 0.36;
/** The size each animal's dots are stippled at, px; scaled from there. */
const ART_PX = 64;
/** Animals lie on the road, seen at a low angle: their depth is squashed. */
const SQUASH = 0.55;

interface Animal {
  sp: HerpSpecies;
  /** Across the road and along it, metres. */
  x: number;
  z: number;
  /** Which way it's crossing, and how fast. */
  dir: number;
  speed: number;
  /** Heading on the ground, radians, 0 toward +x. */
  ang: number;
  seed: number;
  art: CritterArt;
  /** Where it is on screen this frame, and how long. */
  sx: number;
  sy: number;
  len: number;
  /** Set on reveal, decays: drives the little shimmy. */
  wiggle: number;
  sway: number;
  found: boolean;
}

/** What draws a frame: the WebGL sink, or squares on a 2D canvas. */
interface Dots {
  frame(W: number, H: number, dpr: number): void;
  dots(xyr: Float32Array, count: number, color: string, alpha: number): void;
  /** Clear paper in cells `size` px across, centred on each x, y (r unused). */
  paper(xyr: Float32Array, count: number, size: number, color: string): void;
  flush(): void;
}

function glDots(sink: Sink): Dots {
  return {
    frame: (W, H, dpr) => sink.frame(W, H, dpr, 1, 1),
    dots: (xyr, count, color, alpha) =>
      count && sink.circles(xyr, count, 0, color, alpha),
    paper: (xyr, count, _size, color) =>
      count && sink.circles(xyr, count, 0, color, 1),
    flush: () => sink.flush(),
  };
}

/** A CSS colour as RGB bytes, the way the browser reads it. */
function rgbOf(color: string): [number, number, number] {
  const pad = document.createElement("canvas").getContext("2d", {
    willReadFrequently: true,
  });
  if (!pad) return [0, 0, 0];
  pad.fillStyle = color;
  pad.fillRect(0, 0, 1, 1);
  const [r, g, b] = pad.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

/**
 * Without WebGL: every dot stamped straight into a pixel buffer, edges
 * anti-aliased by how much of each pixel the disc covers, and the buffer put
 * on the canvas once a frame. Filling a path of tens of thousands of tiny
 * shapes made the browser rasterize each one, at about 45 ms a frame.
 */
function pixelDots(
  canvas: HTMLCanvasElement,
  colors: () => { paper: string },
): Dots | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const known = new Map<string, [number, number, number]>();
  const rgb = (c: string) => {
    let v = known.get(c);
    if (!v) known.set(c, (v = rgbOf(c)));
    return v;
  };
  let img: ImageData | null = null;
  let data = new Uint8ClampedArray(0);
  let w = 0;
  let h = 0;
  let k = 1;
  return {
    frame(W, H, dpr) {
      w = Math.round(W * dpr);
      h = Math.round(H * dpr);
      k = dpr;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      if (!img || img.width !== w || img.height !== h) {
        img = ctx.createImageData(w, h);
        data = img.data;
      }
      const [r, g, b] = rgb(colors().paper);
      new Uint32Array(data.buffer).fill(
        ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0,
      );
    },
    paper(xyr, count, size, color) {
      const [r, g, b] = rgb(color);
      const c32 = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
      const px = new Uint32Array(data.buffer);
      const half = (size * k) / 2;
      for (let i = 0; i < count * 3; i += 3) {
        const x0 = Math.max(0, Math.round(xyr[i] * k - half));
        const x1 = Math.min(w, Math.round(xyr[i] * k + half));
        const y0 = Math.max(0, Math.round(xyr[i + 1] * k - half));
        const y1 = Math.min(h, Math.round(xyr[i + 1] * k + half));
        for (let y = y0; y < y1; y++) px.fill(c32, y * w + x0, y * w + x1);
      }
    },
    dots(xyr, count, color, alpha) {
      const [r, g, b] = rgb(color);
      const c32 = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
      const px = new Uint32Array(data.buffer);
      for (let i = 0; i < count * 3; i += 3) {
        const cx = xyr[i] * k;
        const cy = xyr[i + 1] * k;
        const rr = xyr[i + 2] * k;
        const x0 = Math.max(0, Math.floor(cx - rr - 0.5));
        const x1 = Math.min(w - 1, Math.ceil(cx + rr + 0.5));
        const y0 = Math.max(0, Math.floor(cy - rr - 0.5));
        const y1 = Math.min(h - 1, Math.ceil(cy + rr + 0.5));
        for (let y = y0; y <= y1; y++) {
          const dy = y + 0.5 - cy;
          for (let x = x0; x <= x1; x++) {
            const dx = x + 0.5 - cx;
            const cover = rr - Math.sqrt(dx * dx + dy * dy) + 0.5;
            if (cover <= 0) continue;
            if (cover >= 1 && alpha >= 1) {
              px[y * w + x] = c32;
              continue;
            }
            const a = (cover >= 1 ? 1 : cover) * alpha;
            const o = (y * w + x) * 4;
            data[o] += (r - data[o]) * a;
            data[o + 1] += (g - data[o + 1]) * a;
            data[o + 2] += (b - data[o + 2]) * a;
          }
        }
      }
    },
    flush() {
      if (img) ctx.putImageData(img, 0, 0);
    },
  };
}

function loadDiscovered(): Set<string> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore */
  }
  return new Set();
}
function saveDiscovered(set: Set<string>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

/** A prop as the toy draws it: its sizes' dots as 0-1 of the prop, and a widened silhouette. */
interface Ready {
  prop: Prop;
  u: Float32Array[];
  v: Float32Array[];
  /** Each dot's rank, worked out once. */
  rank: Float32Array[];
  halo: Uint8Array;
}

function prepare(props: Prop[]): Ready[] {
  return props.map((prop) => {
    const u = prop.sizes.map((s) => s.x.map((x) => x / s.w));
    const v = prop.sizes.map((s) => s.y.map((y) => y / s.h));
    const rank = prop.sizes.map((s) =>
      Float32Array.from({ length: s.n }, (_, i) => threshold(i * 7)),
    );
    // The silhouette grown by two of its pixels: a ring of clear paper round
    // the prop, so it stands out against whatever is behind it.
    const { maskW: w, maskH: h, mask } = prop;
    let a = Uint8Array.from(mask, (m) => (m > 60 ? 1 : 0));
    for (let pass = 0; pass < 2; pass++) {
      const b = new Uint8Array(a.length);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let on = 0;
          for (let dy = -1; dy <= 1 && !on; dy++)
            for (let dx = -1; dx <= 1 && !on; dx++) {
              const yy = y + dy;
              const xx = x + dx;
              if (yy >= 0 && yy < h && xx >= 0 && xx < w) on = a[yy * w + xx];
            }
          b[y * w + x] = on;
        }
      a = b;
    }
    return { prop, u, v, rank, halo: a };
  });
}

const drawings = new Map<string, Promise<Ready[] | null>>();
function loadProps(url: string): Promise<Ready[] | null> {
  let p = drawings.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => {
        const props = b ? parseDrive(b) : null;
        return props ? prepare(props) : null;
      })
      .catch(() => null);
    drawings.set(url, p);
  }
  return p;
}

export function initHerping(root: HTMLElement): void {
  let canvas = root.querySelector<HTMLCanvasElement>("[data-hp-canvas]");
  const card = root.querySelector<HTMLElement>("[data-hp-card]");
  const revealCanvas =
    root.querySelector<HTMLCanvasElement>("[data-hp-reveal]");
  const nameEl = root.querySelector<HTMLElement>("[data-hp-name]");
  const sciEl = root.querySelector<HTMLElement>("[data-hp-sci]");
  const factEl = root.querySelector<HTMLElement>("[data-hp-fact]");
  const badgeEl = root.querySelector<HTMLElement>("[data-hp-badge]");
  const markEl = root.querySelector<HTMLElement>("[data-hp-mark]");
  const closeBtn = root.querySelector<HTMLButtonElement>("[data-hp-close]");
  const countEl = root.querySelector<HTMLElement>("[data-hp-count]");
  const lastEl = root.querySelector<HTMLElement>("[data-hp-last]");
  const barEl = root.querySelector<HTMLElement>("[data-hp-bar]");
  const resetBtn = root.querySelector<HTMLButtonElement>("[data-hp-reset]");
  const photoEl = root.querySelector<HTMLImageElement>("[data-hp-photo]");
  const creditEl = root.querySelector<HTMLElement>("[data-hp-credit]");
  const frame = root.querySelector<HTMLElement>("[data-hp-frame]");
  const live = root.querySelector<HTMLElement>("[data-hp-live]");

  if (
    !canvas ||
    !frame ||
    !card ||
    !revealCanvas ||
    !nameEl ||
    !sciEl ||
    !factEl ||
    !badgeEl ||
    !closeBtn ||
    !countEl ||
    !barEl
  ) {
    return;
  }
  const rctx = revealCanvas.getContext("2d");
  if (!rctx) return;

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const total = SPECIES.length;
  const discovered = loadDiscovered();
  // The find on the open card. The journal's count stays behind the real
  // one while a first find is hopping in.
  let cardFind: {
    animal: Animal;
    isNew: boolean;
    at: { x: number; y: number; len: number };
  } | null = null;
  const journal = journalHop({
    count: countEl,
    bar: barEl,
    total,
    found: () => discovered.size,
    grid: () => canvas!,
    pix: 1,
    smooth: true,
  });

  let W = 0;
  let H = 0;
  let dpr = 1;
  /** Where the car is along the road, metres, and how fast it's going. */
  let carZ = 0;
  let speed = reduceMotion ? 0 : ROAD.speed;
  let salt = 1;
  const tiles = new Map<number, Tile>();
  let props: Ready[] | null = null;
  let animals: Animal[] = [];
  let onscreen = true;
  let running = false;
  let raf = 0;
  let last = 0;
  let spawnTimer = 0;
  let dirty = true;

  const beam = { x: 0, y: 0 };
  const aim = { x: 0, y: 0 };
  let aimed = false;
  const rainDrops: { x: number; y: number; len: number; v: number }[] = [];

  /* --------------------------------------------------------- the sink */
  const colors = () => {
    const s = getComputedStyle(frame);
    return {
      ink: s.getPropertyValue("--ink").trim() || "#16150f",
      paper: s.getPropertyValue("--paper").trim() || "#fbfaf8",
      red: s.getPropertyValue("--ink").trim() || "#16150f",
    };
  };
  let palette = colors();
  let dark = document.documentElement.classList.contains("dark");
  const noLabels = () => null;
  const gl = makeRenderer(canvas, false);
  let out: Dots | null = null;
  let glFailed = !gl;
  const makeOut = (): Dots | null => {
    if (gl && !glFailed)
      return gl.ready ? glDots(gl.sink(palette, noLabels)) : null;
    return pixelDots(canvas!, () => palette);
  };
  if (gl) {
    void gl.whenReady(1500).then((ok) => {
      if (!ok) {
        // A canvas that has a WebGL context can't draw 2D: start a new one.
        glFailed = true;
        const fresh = canvas!.cloneNode(false) as HTMLCanvasElement;
        canvas!.replaceWith(fresh);
        canvas = fresh;
      }
      out = makeOut();
      if (!ok) fit();
      kick();
    });
  } else out = makeOut();

  function loadTheme(): void {
    const url = dark ? driveDarkUrl : driveUrl;
    void loadProps(url).then((p) => {
      if (!p || (dark ? driveDarkUrl : driveUrl) !== url) return;
      props = p;
      tiles.clear();
      kick();
    });
  }

  /* --------------------------------------------------------- the world */
  function cam(): Camera {
    return camera(W, H, carZ);
  }

  function ensureTiles(): void {
    if (!props) return;
    const from = Math.floor(carZ / TILE);
    const to = Math.floor((carZ + FAR) / TILE);
    for (const k of tiles.keys()) if (k < from || k > to) tiles.delete(k);
    for (let t = from; t <= to; t++)
      if (!tiles.has(t))
        tiles.set(
          t,
          buildTile(
            t,
            salt,
            props.map((r) => r.prop),
          ),
        );
  }

  /* --------------------------------------------------------- the animals */
  function pickSpecies(): HerpSpecies {
    const weight = (s: HerpSpecies) =>
      RARITY_WEIGHT[s.rarity] * CATEGORY_WEIGHT[s.category];
    let totalW = 0;
    for (const s of SPECIES) totalW += weight(s);
    let r = Math.random() * totalW;
    for (const s of SPECIES) {
      r -= weight(s);
      if (r <= 0) return s;
    }
    return SPECIES[0];
  }

  /**
   * How much of an animal's inside is dotted. Dots are light on the dark
   * page and ink on paper, so a pale animal is dense in dark mode and a dark
   * one is dense in light mode.
   */
  function inkTone(sp: HerpSpecies): number {
    const pale = paleness(sp.color);
    return dark ? pale : 1 - pale;
  }

  function spawnAnimal(initial: boolean): void {
    if (!W) return;
    const sp = pickSpecies();
    const shoulder = sp.category === "snake";
    const c = cam();
    // Newcomers turn up far ahead and the car closes on them; parked (reduced
    // motion), they turn up anywhere in reach, out of the spotlight.
    const near = reduceMotion || initial;
    for (let tries = 0; tries < 10; tries++) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const z =
        carZ +
        (near ? nearest(c) + 4 + Math.random() * 26 : 48 + Math.random() * 26);
      // Snakes lie at the road's edge, on the warm asphalt, and barely move.
      const x = shoulder
        ? dir * (ROAD.half - 0.65 + Math.random() * 0.6)
        : (Math.random() * 2 - 1) * (ROAD.half - 0.4);
      const dz = z - carZ;
      const s = c.f / dz;
      const sx = W / 2 + (x - ROAD.camX) * s;
      const sy = c.horizon + ROAD.camH * s;
      const crowded = animals.some(
        (o) => Math.abs(o.z - z) < 3 && Math.abs(o.x - x) < 1.2,
      );
      const spotted = near && spotAt(c, beam, sx, sy, dz) > 0.1;
      if ((crowded || spotted) && tries < 9) continue;
      const seed = 1 + Math.floor(Math.random() * 1e6);
      animals.push({
        sp,
        x,
        z,
        dir,
        speed:
          CRAWL[sp.category] *
          (0.8 + 0.4 * Math.random()) *
          (shoulder ? 0.2 : 1),
        // On the shoulder, angled along the road's edge.
        ang:
          (dir > 0 ? 0 : Math.PI) +
          (shoulder
            ? (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.4)
            : (Math.random() - 0.5) * 0.9),
        seed,
        art: critterArt(sp.category, ART_PX, inkTone(sp), seed, 1.6),
        sx,
        sy,
        len: 0,
        wiggle: 0,
        sway: Math.random() * 6.28,
        found: false,
      });
      return;
    }
  }

  const CROWD = 5;
  function populate(): void {
    animals = [];
    for (let i = 0; i < CROWD; i++) spawnAnimal(true);
    dirty = true;
  }

  function resetRain(): void {
    rainDrops.length = 0;
    if (reduceMotion) return;
    const drops = Math.round((W * H) / 9000);
    for (let i = 0; i < drops; i++) {
      rainDrops.push({
        x: Math.random() * W,
        y: Math.random() * H,
        len: 6 + Math.random() * 10,
        v: 340 + Math.random() * 260,
      });
    }
  }

  /* -------------------------------------------------------- the drawing */
  let buf = new Float32Array(3 * 65536);
  let n = 0;
  const room = (more: number) => {
    if ((n + more) * 3 <= buf.length) return;
    const next = new Float32Array(Math.max(buf.length * 2, (n + more) * 3));
    next.set(buf.subarray(0, n * 3));
    buf = next;
  };
  const push = (x: number, y: number, r: number) => {
    if (n * 3 >= buf.length) room(1);
    buf[n * 3] = x;
    buf[n * 3 + 1] = y;
    buf[n * 3 + 2] = r;
    n++;
  };
  const emit = (o: Dots, color: string, alpha = 1) => {
    o.dots(buf, n, color, alpha);
    n = 0;
  };

  /** The ground under a screen point, if there is any: across and ahead, metres. */
  function groundAt(c: Camera, x: number, y: number) {
    if (y <= c.horizon + 1) return null;
    const dz = (c.f * ROAD.camH) / (y - c.horizon);
    return { xr: ((x - W / 2) * dz) / c.f, dz };
  }

  /**
   * Road marks or fence pieces (`MARK` numbers each), moved by `ox`, `oz`.
   * `shift` turns every rank by the same amount, so the fence's posts, all
   * drawn from one pattern, don't drop the same dots.
   */
  function drawMarks(
    c: Camera,
    m: Float32Array,
    count: number,
    ox: number,
    oz: number,
    shift: number,
  ): void {
    const { camX, camH } = ROAD;
    for (let i = 0, j = 0; i < count; i++, j += MARK) {
      const dz = m[j + 2] + oz - c.z;
      if (dz < 1 || dz > FAR) continue;
      let rank = m[j + 6] + shift;
      if (rank >= 1) rank -= 1;
      const xr = m[j] + ox - camX;
      const keep = keepShare(markArea(c, m[j + 5], m[j + 3], xr, dz), m[j + 4]);
      if (rank >= keep) continue;
      const s = c.f / dz;
      const x = W / 2 + xr * s;
      const y = c.horizon + (camH - m[j + 1]) * s;
      if (x < -2 || x > W + 2 || y < -2 || y > H + 2) continue;
      const lit = lightAt(c, beam, xr, m[j + 1], dz, x, y);
      if (rank >= keep * lit * 1.1) continue;
      push(x, y, PEN * (dz < 5 ? 1.15 : 1));
    }
  }

  function drawProp(
    o: Dots,
    c: Camera,
    r: Ready,
    px: number,
    pz: number,
    scale: number,
    mirror: boolean,
    seed: number,
    /** Metres above the road its foot hangs, for the canopy's limbs. */
    lift = 0,
  ): void {
    const dz = pz - c.z;
    if (dz < 0.6 || dz > FAR) return;
    const { prop } = r;
    const s = c.f / dz;
    const hPx = prop.metres * scale * s;
    const wPx = hPx * prop.aspect;
    const bx = W / 2 + (px - ROAD.camX) * s;
    const by = c.horizon + (ROAD.camH - lift) * s;
    const left = bx - wPx / 2;
    const top = by - hPx;
    if (left > W || left + wPx < 0 || top > H || by < 0 || hPx < 3) return;
    // The smallest drawing at least this tall; past the largest, it grows.
    let k = 0;
    while (k < prop.sizes.length - 1 && prop.sizes[k].h < hPx) k++;
    const size = prop.sizes[k];
    const fit = hPx / size.h;
    const keep = Math.min(1, fit * fit);
    const grow = fit > 1 ? Math.min(1.6, Math.sqrt(fit)) : 1;

    // Clear paper where it stands, so nearer things hide what's behind. Limbs
    // overhead don't: the trunks show through their gaps.
    if (!lift && hPx > 10) {
      // A coarser grid for big props: the ring of paper is wider than a cell.
      const g = hPx > 400 ? 6 : hPx > 150 ? 4 : 3;
      const { maskW: mw, maskH: mh } = prop;
      const y0 = Math.max(0, top);
      const y1 = Math.min(H, by);
      const x0 = Math.max(0, left);
      const x1 = Math.min(W, left + wPx);
      for (let y = y0; y < y1; y += g) {
        const my = Math.min(mh - 1, Math.floor(((y - top) / hPx) * mh));
        for (let x = x0; x < x1; x += g) {
          let u = (x - left) / wPx;
          if (mirror) u = 1 - u;
          const mx = Math.min(mw - 1, Math.floor(u * mw));
          if (r.halo[my * mw + mx]) push(x + g / 2, y + g / 2, g * 0.8);
        }
      }
      o.paper(buf, n, g, palette.paper);
      n = 0;
    }

    const U = r.u[k];
    const V = r.v[k];
    const ranks = r.rank[k];
    const shift = threshold(seed);
    const wm = prop.metres * scale * prop.aspect;
    const hm = prop.metres * scale;
    const xr0 = px - ROAD.camX;
    room(size.n);
    for (let i = 0; i < size.n; i++) {
      let rank = ranks[i] + shift;
      if (rank >= 1) rank -= 1;
      if (rank >= keep) continue;
      const u = mirror ? 1 - U[i] : U[i];
      const x = left + u * wPx;
      const y = top + V[i] * hPx;
      if (x < -2 || x > W + 2 || y < -2 || y > H + 2) continue;
      const lit = lightAt(
        c,
        beam,
        xr0 + (u - 0.5) * wm,
        (1 - V[i]) * hm + lift,
        dz,
        x,
        y,
      );
      if (rank >= keep * lit * 1.1) continue;
      push(x, y, size.r[i] * grow);
    }
    emit(o, palette.ink);
  }

  /** An animal's local point on screen: turned to its heading, laid on the road. */
  function toScreen(
    a: Animal,
    lx: number,
    ly: number,
    turn: number,
    k: number,
  ) {
    const cs = Math.cos(a.ang + turn);
    const sn = Math.sin(a.ang + turn);
    return [
      a.sx + (lx * cs - ly * sn) * k,
      a.sy + (lx * sn + ly * cs) * k * SQUASH,
    ];
  }

  function placeAnimal(c: Camera, a: Animal): number {
    const dz = a.z - c.z;
    const s = c.f / Math.max(0.5, dz);
    a.sx = W / 2 + (a.x - ROAD.camX) * s;
    a.sy = c.horizon + ROAD.camH * s;
    // Further off it's drawn larger than the road would make it, up to 1.7x
    // from 26 m out, so you can tell what it is before it's at your bumper.
    const t = Math.min(1, Math.max(0, (dz - 4) / 22));
    a.len = LENGTH_M * a.sp.size * s * (1 + 0.7 * t * t * (3 - 2 * t));
    return dz;
  }

  function drawAnimal(o: Dots, c: Camera, a: Animal): void {
    const dz = placeAnimal(c, a);
    if (dz < 0.8 || dz > FAR) return;
    const k = a.len / ART_PX;
    const lit = lightAt(c, beam, a.x - ROAD.camX, 0, dz, a.sx, a.sy);
    if (lit < 0.02) return;
    const turn =
      (a.wiggle > 0
        ? Math.sin(a.wiggle * 22) * 0.14 * Math.min(1, a.wiggle)
        : 0) + (reduceMotion ? 0 : 0.06 * Math.sin(a.sway));
    const h = a.art.holes;
    for (let i = 0; i < h.length; i += 3) {
      const [x, y] = toScreen(a, h[i], h[i + 1], turn, k);
      push(x, y, Math.max(1.2, h[i + 2] * k));
    }
    emit(o, palette.paper);
    // The whole outline as soon as a third of the light is on it, and enough
    // of the inside to make a small animal a solid shape: a far one is
    // denser than the art, never thinned to a few specks.
    const rimShow = Math.min(1, lit * 3);
    const fill = Math.min(1, Math.max(0.35, 2 * k * k)) * Math.min(1, lit * 2);
    const rs = Math.min(1.3, k);
    const d = a.art.dots;
    const rim = a.art.rim;
    for (let i = 0, j = 0; i < d.length; i += 3, j++) {
      const rank = threshold(a.seed + j);
      if (rank >= (j < rim ? rimShow : fill)) continue;
      const [x, y] = toScreen(a, d[i], d[i + 1], turn, k);
      push(x, y, Math.max(PEN, d[i + 2] * rs));
    }
    emit(o, palette.ink);
  }

  interface Drawable {
    z: number;
    draw: () => void;
  }
  const order: Drawable[] = [];

  function render(now: number): void {
    if (!out || !W) return;
    const o = out;
    const c = cam();
    o.frame(W, H, dpr);
    if (!props) {
      o.flush();
      return;
    }
    ensureTiles();

    // The road first: its marks lie flat, so their order doesn't matter.
    for (const tile of tiles.values())
      drawMarks(c, tile.marks, tile.count, 0, 0, 0);
    emit(o, palette.ink);

    // Everything standing up, furthest first, so nearer things cover it.
    order.length = 0;
    for (const [, tile] of tiles) {
      for (const p of tile.placed) {
        const r = props[p.prop];
        if (r)
          order.push({
            z: p.z,
            draw: () => drawProp(o, c, r, p.x, p.z, p.scale, p.mirror, p.seed),
          });
      }
      for (const b of tile.canopy) {
        const r = props[b.prop];
        if (!r) continue;
        const lift = CANOPY_TOP - r.prop.metres * b.scale;
        order.push({
          z: b.z,
          draw: () =>
            drawProp(o, c, r, b.x, b.z, b.scale, b.mirror, b.seed, lift),
        });
      }
      for (const post of tile.posts) {
        order.push({
          z: post.z,
          draw: () => {
            drawMarks(
              c,
              FENCE,
              FENCE.length / MARK,
              post.x,
              post.z,
              threshold(Math.round(post.z * 977)),
            );
            emit(o, palette.ink);
          },
        });
      }
    }
    for (const a of animals)
      order.push({ z: a.z, draw: () => drawAnimal(o, c, a) });
    order.sort((a, b) => b.z - a.z);
    for (const d of order) d.draw();

    // Eyeshine over everything: a pair of dots on the head with a ring of
    // clear paper round each, larger and darker the more light is on them. The
    // pair always sits side by side, so it reads as eyes even at a few pixels.
    for (const a of animals) {
      if (a.found) continue;
      const dz = placeAnimal(c, a);
      if (dz < 0.8 || dz > FAR) continue;
      const k = a.len / ART_PX;
      const e = a.art.eyes;
      const [hx, hy] = toScreen(a, e[0], 0, 0, k);
      const shine = eyeshine(c, beam, a.x - ROAD.camX, dz, hx, hy);
      if (shine < 0.03) continue;
      const flick = reduceMotion
        ? 1
        : 0.85 + 0.15 * Math.sin(now / 110 + a.seed);
      const er =
        Math.max(1.1, Math.min(3, e[3] * k * 0.62)) * (0.8 + 0.5 * shine);
      const gap = Math.max(e[3] * k, er * 1.5);
      for (const side of [-1, 1]) push(hx + side * gap, hy, er + 2);
      emit(o, palette.paper);
      for (const side of [-1, 1]) push(hx + side * gap, hy, er);
      emit(o, palette.ink, Math.min(1, (0.6 + 0.4 * shine) * flick));
    }

    // Rain shows only where the light catches it.
    if (rainDrops.length) {
      for (const p of rainDrops) {
        const g = groundAt(c, p.x, p.y);
        const low = g ? lowBeam(g.xr, 0.8, g.dz) : 0;
        const lit = Math.max(low * 0.7, spotAt(c, beam, p.x, p.y, 12));
        if (lit < 0.15 || threshold(Math.round(p.v)) > lit) continue;
        for (let q = 0; q < 3; q++)
          push(p.x - (0.12 * q * p.len) / 2, p.y + (q * p.len) / 2, 0.55);
      }
      emit(o, palette.ink, 0.7);
    }
    o.flush();
  }

  /* ------------------------------------------------------------ sizing */
  function fit(): void {
    const cssW = frame!.clientWidth || 640;
    const cssH = Math.max(340, Math.min(560, Math.round(cssW * 0.7)));
    canvas!.style.height = `${cssH}px`;
    // Without WebGL the dots are filled on the CPU, four times as fast at 1x.
    dpr = gl && !glFailed ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const first = !W;
    const kx = W ? cssW / W : 1;
    const ky = H ? cssH / H : 1;
    W = cssW;
    H = cssH;
    beam.x *= kx;
    beam.y *= ky;
    aim.x *= kx;
    aim.y *= ky;
    for (const p of rainDrops) {
      p.x *= kx;
      p.y *= ky;
    }
    if (first || !rainDrops.length) resetRain();
    // Until the visitor steers, the spotlight rests on the left verge ahead.
    if (!aimed) {
      beam.x = aim.x = W * 0.3;
      beam.y = aim.y = H * 0.56;
    }
    if (!animals.length) populate();
  }

  /* ------------------------------------------------------------ the loop */
  function update(dt: number): void {
    const was = { x: beam.x, y: beam.y };
    if (reduceMotion) {
      beam.x = aim.x;
      beam.y = aim.y;
    } else {
      const k = Math.min(1, dt * 9);
      beam.x += (aim.x - beam.x) * k;
      beam.y += (aim.y - beam.y) * k;
      if (Math.hypot(aim.x - beam.x, aim.y - beam.y) < 0.3) {
        beam.x = aim.x;
        beam.y = aim.y;
      }
    }
    if (beam.x !== was.x || beam.y !== was.y) dirty = true;

    // The car stops while a find's card is open, and sets off again after.
    if (!reduceMotion) {
      const target = card!.classList.contains("is-open") ? 0 : ROAD.speed;
      speed += (target - speed) * Math.min(1, dt * 2.2);
      carZ += speed * dt;
    }

    const c = cam();
    const behind = nearest(c) - 0.5;
    for (const a of animals) {
      if (a.wiggle > 0) {
        a.wiggle = Math.max(0, a.wiggle - dt);
        dirty = true;
      }
      if (reduceMotion || a.found) continue;
      a.x += a.dir * a.speed * dt;
      a.sway += dt * 4;
    }
    const before = animals.length;
    animals = animals.filter(
      (a) => Math.abs(a.x) < ROAD.half + 1.5 && a.z - carZ > behind,
    );
    if (animals.length !== before) dirty = true;

    if (animals.length < CROWD) {
      spawnTimer -= dt;
      if (reduceMotion || spawnTimer <= 0) {
        spawnAnimal(false);
        spawnTimer = 0.8 + Math.random() * 1.6;
        dirty = true;
      }
    }

    for (const p of rainDrops) {
      p.y += p.v * dt;
      p.x -= p.v * dt * 0.12;
      if (p.y > H) {
        p.y = -p.len;
        p.x = Math.random() * (W + 40);
      }
    }
  }

  function step(now: number): void {
    raf = 0;
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    // Moving, every frame changes; parked (reduced motion), it only draws
    // again when something did change.
    if (!reduceMotion || dirty) render(now);
    dirty = false;
    if (!reduceMotion || animals.some((a) => a.wiggle > 0))
      raf = requestAnimationFrame(step);
  }
  function kick(): void {
    dirty = true;
    if (running && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(step);
    } else if (!running && out) render(performance.now());
  }
  function start(): void {
    // Not under a scene that's still playing; it starts once that's gone.
    if (running || covered()) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(step);
  }
  function stop(): void {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  /* --------------------------------------------------------- discovery */
  function reveal(a: Animal): void {
    a.found = true;
    a.wiggle = reduceMotion ? 0 : 0.9;
    const sp = a.sp;
    const isNew = !discovered.has(sp.id);
    if (isNew) {
      discovered.add(sp.id);
      saveDiscovered(discovered);
      // The count waits for the find to hop into it when the card closes.
      if (reduceMotion) updateJournal();
    }
    showLastFind(sp);
    // It moves on while the card is open, so the road is clear behind it.
    setTimeout(() => {
      animals = animals.filter((o) => o !== a);
      kick();
    }, 1400);
    showCard(sp, isNew, a);
    cardFind = { animal: a, isNew, at: { x: a.sx, y: a.sy, len: a.len } };
    kick();
  }

  /**
   * The animal as it lay on the road, on its own canvas: every dot as if the
   * spotlight were on it, over its ring of paper, and the same shape in solid
   * ink for the end of the hop.
   */
  function hopSprite(a: Animal, len: number): HopSprite {
    const k = len / ART_PX;
    const size = Math.ceil(len * 1.5 + 12);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const cs = Math.cos(a.ang);
    const sn = Math.sin(a.ang);
    const make = () => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = Math.round(size * ratio);
      const c = cv.getContext("2d")!;
      c.setTransform(ratio, 0, 0, ratio, 0, 0);
      c.translate(size / 2, size / 2);
      return { cv, c };
    };
    const disc = (
      c: CanvasRenderingContext2D,
      lx: number,
      ly: number,
      r: number,
    ) => {
      const x = (lx * cs - ly * sn) * k;
      const y = (lx * sn + ly * cs) * k * SQUASH;
      c.moveTo(x + r, y);
      c.arc(x, y, r, 0, Math.PI * 2);
    };
    const { cv: color, c } = make();
    const h = a.art.holes;
    c.fillStyle = palette.paper;
    c.beginPath();
    for (let i = 0; i < h.length; i += 3)
      disc(c, h[i], h[i + 1], Math.max(1.2, h[i + 2] * k));
    c.fill();
    const fill = Math.min(1, Math.max(0.35, 2 * k * k));
    const rs = Math.min(1.3, k);
    const d = a.art.dots;
    c.fillStyle = palette.ink;
    c.beginPath();
    for (let i = 0, j = 0; i < d.length; i += 3, j++) {
      if (threshold(a.seed + j) >= (j < a.art.rim ? 1 : fill)) continue;
      disc(c, d[i], d[i + 1], Math.max(PEN, d[i + 2] * rs));
    }
    c.fill();
    const inked = make();
    inked.c.setTransform(1, 0, 0, 1, 0, 0);
    inked.c.drawImage(color, 0, 0);
    inked.c.globalCompositeOperation = "source-in";
    inked.c.fillStyle = palette.ink;
    inked.c.fillRect(0, 0, inked.cv.width, inked.cv.height);
    return { color, ink: inked.cv, size };
  }

  /** A first find hops from where it was on the road into the journal's
   *  count, and the count rolls and the rule fills as it lands. */
  function hopHome(f: NonNullable<typeof cardFind>): void {
    const a = f.animal;
    const dz = placeAnimal(cam(), a);
    // Where it is now that the car has stopped, or where it was found if
    // that's out of sight.
    const at = dz >= 0.8 && dz <= FAR ? { x: a.sx, y: a.sy, len: a.len } : f.at;
    const box = canvas!.getBoundingClientRect();
    journal.hop({
      sprite: hopSprite(a, at.len),
      from: { x: box.left + at.x, y: box.top + at.y },
      end: Math.min(0.8, 22 / (at.len * 1.5 + 12)),
    });
  }

  function paintRevealStipple(sp: HerpSpecies): void {
    if (photoEl) photoEl.classList.add("is-hidden");
    revealCanvas!.classList.remove("is-hidden");
    revealCanvas!.style.imageRendering = "auto";
    // The card's frame is 4:3, so the drawing sits in the middle of a 160 by
    // 120 plate.
    const w = 160;
    const size = 120;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    revealCanvas!.width = w * ratio;
    revealCanvas!.height = size * ratio;
    const c = rctx!;
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.fillStyle = palette.paper;
    c.fillRect(0, 0, w, size);
    const art = critterArt(sp.category, 92, inkTone(sp), 7, 2.1);
    c.fillStyle = palette.ink;
    c.beginPath();
    const cx = w / 2;
    const cy = size / 2;
    const d = art.dots;
    for (let i = 0; i < d.length; i += 3) {
      c.moveTo(cx + d[i] + d[i + 2], cy + d[i + 1]);
      c.arc(cx + d[i], cy + d[i + 1], d[i + 2], 0, Math.PI * 2);
    }
    for (let k = 0; k < 4; k += 2) {
      const x = cx + art.eyes[k];
      const y = cy + art.eyes[k + 1];
      c.moveTo(x + 2.2, y);
      c.arc(x, y, 2.2, 0, Math.PI * 2);
    }
    c.fill();
  }

  function photoUrlFor(sp: HerpSpecies): string | undefined {
    return sp.photo ?? PHOTOS[sp.id]?.photo;
  }

  // Warm every species' reveal photo in the background once the island is idle,
  // so the first time you find each animal the image is already cached and the
  // card shows it instantly (no per-reveal network round-trip). The browser caps
  // concurrent requests per host, so firing them together self-throttles; kept
  // refs are decoded early and prevent premature GC.
  const warmed: HTMLImageElement[] = [];
  let preloaded = false;
  function preloadPhotos(): void {
    if (preloaded) return;
    preloaded = true;
    const urls = Array.from(
      new Set(
        SPECIES.map(photoUrlFor).filter(
          (u): u is string => typeof u === "string",
        ),
      ),
    );
    const run = () => {
      for (const url of urls) {
        const img = new Image();
        img.decoding = "async";
        img.src = url;
        if (img.decode) img.decode().catch(() => {});
        warmed.push(img);
      }
    };
    const ric = (
      window as unknown as {
        requestIdleCallback?: (
          cb: () => void,
          opts?: { timeout: number },
        ) => void;
      }
    ).requestIdleCallback;
    if (ric) ric(run, { timeout: 2000 });
    else setTimeout(run, 400);
  }

  function showCard(sp: HerpSpecies, isNew: boolean, a: Animal): void {
    const override = PHOTOS[sp.id];
    const photo = sp.photo ?? override?.photo;
    const credit = sp.photoCredit ?? override?.credit ?? "";
    stopReveal();
    revealCanvas!.classList.add("is-hidden");
    if (photoEl) photoEl.classList.add("is-hidden");
    const loaded = new Promise<void>((res, rej) => {
      if (!photo || !photoEl) return rej(new Error("no photo"));
      photoEl.onload = () => res();
      photoEl.onerror = () => rej(new Error(photo));
      photoEl.alt = sp.common;
      if (
        photoEl.getAttribute("src") === photo &&
        photoEl.complete &&
        photoEl.naturalWidth
      )
        res();
      else photoEl.src = photo;
    });
    if (photoEl) upgradePhoto(photoEl, photo ?? "");
    if (creditEl) {
      creditEl.textContent = credit;
      creditEl.classList.toggle("is-hidden", !credit || !photo);
    }
    // The photo comes out of the animal as it lay on the road (specimen-reveal.ts).
    const box = canvas!.getBoundingClientRect();
    const sprite = hopSprite(a, a.len);
    const size = sprite.size;
    const pic = photoEl?.parentElement;
    nameEl!.textContent = sp.common;
    sciEl!.textContent = sp.scientific;
    factEl!.textContent = sp.facts[Math.floor(Math.random() * sp.facts.length)];
    badgeEl!.textContent = sp.nonNative
      ? "Non-native"
      : isNew
        ? "New to your journal"
        : "Found again";
    badgeEl!.classList.toggle("is-warn", !!sp.nonNative);
    if (markEl) stampFind(markEl, badgeEl!, isNew && !sp.nonNative);
    openCard();
    if (!photoEl || !pic) return;
    playReveal({
      card: card!.querySelector<HTMLElement>(".specimen") ?? card!,
      pic,
      img: photoEl,
      photo: loaded,
      from: {
        rect: {
          x: box.left + a.sx - a.len / 2,
          y: box.top + a.sy - a.len / 2,
          w: a.len,
          h: a.len,
        },
        // The drive draws in WebGL, which can't be copied outside a frame, so
        // the lens magnifies the animal itself.
        sprite: sprite.color,
        fill: a.len / size,
      },
      style: revealStyle(),
      reduced: reduceMotion,
      onFail: () => {
        upgradePhoto(photoEl, "");
        paintRevealStipple(sp);
        if (creditEl) creditEl.classList.add("is-hidden");
      },
    });
  }

  // The card is a modal: focus moves to its button, Escape or the scrim
  // closes it, and focus goes back where it was.
  let returnFocus: HTMLElement | null = null;
  function openCard(): void {
    if (!card!.classList.contains("is-open")) {
      returnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    card!.classList.add("is-open");
    closeBtn!.focus({ preventScroll: true });
  }
  function closeCard(): void {
    if (!card!.classList.contains("is-open")) return;
    stopReveal();
    card!.classList.remove("is-open");
    returnFocus?.focus({ preventScroll: true });
    returnFocus = null;
    const f = cardFind;
    cardFind = null;
    if (f?.isNew && !reduceMotion) hopHome(f);
  }

  function showLastFind(sp: HerpSpecies): void {
    if (lastEl) lastEl.textContent = `Last find: ${sp.common}`;
  }

  function updateJournal(): void {
    journal.show(discovered.size);
  }

  /**
   * The animal under a point, if the light is on it. A tap aims the beam
   * where it lands and the beam glides there, so light at the aim counts too.

  /** How lit an animal is, body or eyes, for tapping and for Enter. */
  function seen(c: Camera, a: Animal, at: { x: number; y: number }) {
    const dz = placeAnimal(c, a);
    if (dz < 0.8 || dz > FAR) return { body: 0, eyes: 0 };
    const xr = a.x - ROAD.camX;
    return {
      body: lightAt(c, at, xr, 0, dz, a.sx, a.sy),
      eyes: eyeshine(c, at, xr, dz, a.sx, a.sy),
    };
  }

  /**
   * The animal under a point, if the light is on it or its eyes are shining.
   * A tap aims the beam where it lands and the beam glides there, so light
   * at the aim counts too.
   */
  function hitTest(px: number, py: number): Animal | null {
    if (!W) return null;
    const c = cam();
    let best: Animal | null = null;
    let bestD = Infinity;
    for (const a of animals) {
      if (a.found) continue;
      const now = seen(c, a, beam);
      const then = seen(c, a, aim);
      const rad = Math.max(24, a.len * 0.75);
      const dd = Math.hypot(px - a.sx, py - a.sy);
      const lit =
        Math.max(now.body, then.body) >= 0.15 ||
        Math.max(now.eyes, then.eyes) >= 0.6;
      if (dd <= rad && lit && dd < bestD) {
        best = a;
        bestD = dd;
      }
    }
    return best;
  }

  /**
   * What Enter stops for: the animal nearest the middle of the spotlight,
   * or failing that the one whose eyes shine brightest.
   */
  function inBeam(): Animal | null {
    if (!W) return null;
    const c = cam();
    let best: Animal | null = null;
    let bestD = 1;
    for (const a of animals) {
      if (a.found) continue;
      const dz = placeAnimal(c, a);
      if (dz < 0.8 || dz > FAR) continue;
      const d = spotDistance(c, beam, a.sx, a.sy);
      if (d < bestD) {
        best = a;
        bestD = d;
      }
    }
    if (best) return best;
    let bright = 0.5;
    for (const a of animals) {
      if (a.found) continue;
      const { eyes } = seen(c, a, beam);
      if (eyes > bright) {
        best = a;
        bright = eyes;
      }
    }
    return best;
  }

  /* ------------------------------------------------------------ wiring */
  function pointToFrame(e: MouseEvent): { x: number; y: number } {
    const rect = canvas!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function aimAt(x: number, y: number): void {
    aimed = true;
    aim.x = Math.max(0, Math.min(W, x));
    aim.y = Math.max(H * 0.05, Math.min(H, y));
    kick();
  }

  frame.addEventListener("pointerdown", (e: PointerEvent) => {
    const p = pointToFrame(e);
    aimAt(p.x, p.y);
  });
  // Stop and ID on click, not pointerdown. The card opens over the road, so a
  // tap's click would land on its scrim and close it again, and the mousedown
  // that follows a pointerdown would pull focus off the card's button.
  frame.addEventListener("click", (e: MouseEvent) => {
    const p = pointToFrame(e);
    const a = hitTest(p.x, p.y);
    if (a) reveal(a);
  });
  frame.addEventListener("pointermove", (e: PointerEvent) => {
    if (e.pointerType === "touch" && e.buttons === 0) return; // only steer while dragging on touch
    const p = pointToFrame(e);
    aimAt(p.x, p.y);
    if (e.pointerType !== "touch") {
      canvas!.style.cursor = hitTest(p.x, p.y) ? "pointer" : "crosshair";
    }
  });

  // Keyboard play: the arrow keys steer the beam, and Enter or Space stops
  // for the animal nearest the middle of it.
  frame.addEventListener("keydown", (e: KeyboardEvent) => {
    const dx = Math.max(24, W * 0.06);
    const dy = Math.max(20, H * 0.08);
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-dx, 0],
      ArrowRight: [dx, 0],
      ArrowUp: [0, -dy],
      ArrowDown: [0, dy],
    };
    if (move[e.key]) {
      aimAt(aim.x + move[e.key][0], aim.y + move[e.key][1]);
    } else if (e.key === "Enter" || e.key === " ") {
      const a = inBeam();
      if (a) reveal(a);
      else if (live) live.textContent = "Nothing in the beam yet.";
    } else return;
    e.preventDefault();
  });

  mountRevealSwitch(root.querySelector<HTMLElement>("[data-hp-reveal-switch]"));
  closeBtn.addEventListener("click", closeCard);
  card.addEventListener("click", (e) => {
    if (e.target === card) closeCard();
  });
  card.addEventListener("keydown", (e) => {
    // One control in the card, so Tab stays on it.
    if (e.key === "Tab") {
      e.preventDefault();
      closeBtn.focus();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCard();
  });
  // A new road: another stretch of forest, new animals on it.
  resetBtn?.addEventListener("click", () => {
    salt++;
    tiles.clear();
    populate();
    kick();
  });

  // Follow the theme toggle: the other theme's drawings, in its ink.
  new MutationObserver(() => {
    const next = colors();
    if (next.ink === palette.ink && next.paper === palette.paper) return;
    palette = next;
    dark = document.documentElement.classList.contains("dark");
    for (const a of animals)
      a.art = critterArt(a.sp.category, ART_PX, inkTone(a.sp), a.seed, 1.6);
    out = makeOut();
    loadTheme();
    kick();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  const ro = new ResizeObserver(() => {
    const before = W;
    fit();
    if (W !== before) kick();
  });
  ro.observe(frame);

  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) onscreen = en.isIntersecting;
      if (onscreen && !document.hidden) start();
      else stop();
    },
    { threshold: 0.05 },
  );
  io.observe(frame);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (onscreen) start();
  });
  whenUncovered(() => {
    if (onscreen && !document.hidden) start();
  });

  /* -------------------------------------------------------------- init */
  fit();
  loadTheme();
  updateJournal();
  // The journal saves in the order things were found, so its last entry is
  // the most recent new find.
  const lastId = [...discovered].pop();
  const lastSpecies = SPECIES.find((s) => s.id === lastId);
  if (lastSpecies) showLastFind(lastSpecies);
  start();
  preloadPhotos();
}
