/**
 * "Night Drive" road-cruising game — the interactive for the Herping hobby.
 *
 * A dark, wet Pacific Northwest back road scrolls toward you at night. Your
 * headlight beam follows the pointer / finger (you steer it). Herps sit on and
 * beside the road; as the beam nears one, a colored EYESHINE glint shimmers — the
 * real herper's tell — before the animal is lit. Tap an illuminated animal to
 * "brake and ID": it wiggles, and a reveal card shows the common + scientific
 * name, a real CC photo (when baked in), and a fun fact. A field journal tracks
 * how many of the ~15 species you've found, persisted in localStorage.
 *
 * Self-contained: no dependencies, no runtime fetch. Sprites are canvas fillRect;
 * the night is a dark veil punched by the beam via `destination-out`. Pauses
 * offscreen / when hidden; honors prefers-reduced-motion (the road stops moving
 * and it degrades to a stationary headlamp sweep). Photos per species can be
 * layered in via herping-photos.json (the card falls back to the pixel sprite).
 *
 * Mounted by src/components/hobbies/HerpingNight.astro via [data-hp-*] hooks.
 */
import {
  SPECIES,
  type HerpSpecies,
  type HerpCategory,
} from "./herping-species";
import photoData from "./herping-photos.json";

/** Optional real photos per species id (CC-licensed). See herping-photos.json. */
const PHOTOS = (photoData.species ?? {}) as Record<
  string,
  { photo?: string; credit?: string }
>;

const PIX = 4;
const STORE_KEY = "herping-discovered-v1";
const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 6,
  uncommon: 3,
  rare: 1,
};
/**
 * Spawn bias by category. Herping this game is salamander night — you're out on
 * a wet road mainly for the caudates — so salamanders and newts dominate what
 * turns up in the beam, with the occasional frog/toad and a rare snake/lizard.
 */
const CATEGORY_WEIGHT: Record<HerpCategory, number> = {
  salamander: 10,
  newt: 7,
  frog: 2,
  toad: 2,
  snake: 1.2,
  lizard: 1.2,
};
type Rarity = HerpSpecies["rarity"];

function snap(v: number): number {
  return Math.round(v / PIX) * PIX;
}
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  const mix = (c: number) => Math.round((t - c) * p + c);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// ----------------------------------------------------------- critter sprites
// Each draws centered at the origin, pointing "up" (head toward the top, i.e.
// toward the oncoming headlights). `u` is the pixel-block size.
type Ctx = CanvasRenderingContext2D;
type Sprite = (c: Ctx, u: number, color: string, accent: string) => void;

function rect(
  c: Ctx,
  u: number,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
): void {
  c.fillStyle = fill;
  c.fillRect(
    snap(x * u),
    snap(y * u),
    Math.max(u, snap(w * u)),
    Math.max(u, snap(h * u)),
  );
}

const salamander: Sprite = (c, u, col, acc) => {
  const dk = shade(col, -0.28);
  const hi = shade(col, 0.14);
  for (let i = 0; i < 6; i++) {
    const w = Math.max(1, 3 - Math.floor(i / 2));
    rect(c, u, -w / 2, 3 + i, w, 1, i % 2 ? col : dk);
  }
  rect(c, u, -2, -3, 4, 6, col);
  rect(c, u, -2, -3, 4, 1, hi);
  rect(c, u, -0.5, -4, 1, 13, acc); // dorsal stripe down back + tail
  rect(c, u, -2, -5, 4, 2, col);
  rect(c, u, -1, -6, 2, 1, col);
  rect(c, u, -4, -2, 2, 1, dk);
  rect(c, u, 2, -2, 2, 1, dk);
  rect(c, u, -4, 2, 2, 1, dk);
  rect(c, u, 2, 2, 2, 1, dk);
  rect(c, u, -5, -2, 1, 1, dk);
  rect(c, u, 4, -2, 1, 1, dk);
  rect(c, u, -5, 2, 1, 1, dk);
  rect(c, u, 4, 2, 1, 1, dk);
};

const newt: Sprite = (c, u, col, acc) => {
  const dk = shade(col, -0.3);
  rect(c, u, -2, -3, 4, 6, col);
  for (let i = 0; i < 6; i++)
    rect(
      c,
      u,
      -Math.max(1, 2 - Math.floor(i / 3)) / 2,
      3 + i,
      Math.max(1, 2 - Math.floor(i / 3)),
      1,
      i % 2 ? col : dk,
    );
  rect(c, u, -2, -5, 4, 2, col);
  rect(c, u, -1, -6, 2, 1, col);
  // warty texture
  rect(c, u, -1, -2, 1, 1, dk);
  rect(c, u, 0, 0, 1, 1, dk);
  rect(c, u, -2, 1, 1, 1, dk);
  rect(c, u, 1, -1, 1, 1, dk);
  // belly-orange legs peeking
  rect(c, u, -4, -2, 2, 1, acc);
  rect(c, u, 2, -2, 2, 1, acc);
  rect(c, u, -4, 2, 2, 1, acc);
  rect(c, u, 2, 2, 2, 1, acc);
};

const lizard: Sprite = (c, u, col, acc) => {
  const dk = shade(col, -0.3);
  const hi = shade(col, 0.12);
  for (let i = 0; i < 9; i++) {
    const w = Math.max(1, 3 - Math.floor(i / 3));
    rect(c, u, -w / 2, 3 + i, w, 1, i % 2 ? col : dk);
  }
  rect(c, u, -2, -3, 4, 6, col);
  rect(c, u, -2, -3, 4, 1, hi);
  for (let i = 0; i < 4; i++)
    rect(c, u, -2, -2 + i * 2, 4, 1, i % 2 ? dk : acc); // banding
  rect(c, u, -2, -5, 4, 2, col);
  rect(c, u, -1, -6, 2, 1, col);
  rect(c, u, -4, -2, 2, 1, dk);
  rect(c, u, 2, -2, 2, 1, dk);
  rect(c, u, -4, 3, 2, 1, dk);
  rect(c, u, 2, 3, 2, 1, dk);
};

const frog: Sprite = (c, u, col, acc) => {
  const dk = shade(col, -0.28);
  const hi = shade(col, 0.12);
  rect(c, u, -5, 0, 3, 4, dk);
  rect(c, u, 2, 0, 3, 4, dk);
  rect(c, u, -6, 3, 2, 2, dk);
  rect(c, u, 4, 3, 2, 2, dk);
  rect(c, u, -3, -3, 6, 6, col);
  rect(c, u, -3, -3, 6, 1, hi);
  rect(c, u, -0.5, -3, 1, 6, acc);
  rect(c, u, -3, -5, 2, 2, col);
  rect(c, u, 1, -5, 2, 2, col);
  rect(c, u, -4, 2, 2, 1, dk);
  rect(c, u, 2, 2, 2, 1, dk);
};

const toad: Sprite = (c, u, col, acc) => {
  const dk = shade(col, -0.3);
  rect(c, u, -4, 0, 3, 3, dk);
  rect(c, u, 1, 0, 3, 3, dk);
  rect(c, u, -3, -3, 6, 6, col);
  rect(c, u, -0.5, -3, 1, 6, acc); // pale dorsal stripe
  // warts
  rect(c, u, -2, -1, 1, 1, dk);
  rect(c, u, 1, -2, 1, 1, dk);
  rect(c, u, 2, 1, 1, 1, dk);
  rect(c, u, -2, 2, 1, 1, dk);
  rect(c, u, -3, -5, 3, 2, col); // parotoid + eye ridge
  rect(c, u, 0, -5, 3, 2, col);
  rect(c, u, -4, 1, 1, 1, dk);
  rect(c, u, 3, 1, 1, 1, dk);
};

const snake: Sprite = (c, u, col, acc) => {
  const dk = shade(col, -0.32);
  for (let i = -6; i <= 6; i++) {
    const x = Math.round(Math.sin(i / 2.2) * 3);
    rect(c, u, x - 1, i, 2, 1, i % 2 ? col : dk);
    rect(c, u, x, i, 1, 1, i % 2 ? acc : col);
  }
  const hx = Math.round(Math.sin(-7 / 2.2) * 3);
  rect(c, u, hx - 1, -7, 3, 2, col);
  rect(c, u, hx - 1, -8, 2, 1, col);
};

const SPRITES: Record<HerpCategory, Sprite> = {
  salamander,
  newt,
  lizard,
  frog,
  toad,
  snake,
};

/** Head position (block units, pre-scale) where the eyeshine glint sits. */
const EYE: Record<HerpCategory, { dy: number; dx: number }> = {
  salamander: { dy: -5, dx: 1 },
  newt: { dy: -5, dx: 1 },
  lizard: { dy: -5, dx: 1 },
  frog: { dy: -4.5, dx: 2 },
  toad: { dy: -4.5, dx: 2 },
  snake: { dy: -7, dx: 0.6 },
};

// ----------------------------------------------------------------- the game
interface Animal {
  sp: HerpSpecies;
  x: number;
  y: number;
  size: number;
  wiggle: number; // set on reveal, decays — drives the little shimmy
  found: boolean;
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

export function initHerping(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>("[data-hp-canvas]");
  const card = root.querySelector<HTMLElement>("[data-hp-card]");
  const revealCanvas =
    root.querySelector<HTMLCanvasElement>("[data-hp-reveal]");
  const nameEl = root.querySelector<HTMLElement>("[data-hp-name]");
  const sciEl = root.querySelector<HTMLElement>("[data-hp-sci]");
  const factEl = root.querySelector<HTMLElement>("[data-hp-fact]");
  const badgeEl = root.querySelector<HTMLElement>("[data-hp-badge]");
  const closeBtn = root.querySelector<HTMLButtonElement>("[data-hp-close]");
  const progressEl = root.querySelector<HTMLElement>("[data-hp-progress]");
  const barEl = root.querySelector<HTMLElement>("[data-hp-bar]");
  const resetBtn = root.querySelector<HTMLButtonElement>("[data-hp-reset]");
  const photoEl = root.querySelector<HTMLImageElement>("[data-hp-photo]");
  const creditEl = root.querySelector<HTMLElement>("[data-hp-credit]");

  if (
    !canvas ||
    !card ||
    !revealCanvas ||
    !nameEl ||
    !sciEl ||
    !factEl ||
    !badgeEl ||
    !closeBtn ||
    !progressEl ||
    !barEl
  ) {
    return;
  }
  const ctx = canvas.getContext("2d");
  const rctx = revealCanvas.getContext("2d");
  if (!ctx || !rctx) return;

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const wrap: Element = canvas.parentElement ?? canvas;
  const total = SPECIES.length;
  const discovered = loadDiscovered();

  let W = 0;
  let H = 0;
  let dpr = 1;
  let bg: HTMLCanvasElement | null = null;
  let animals: Animal[] = [];
  let scrollY = 0; // road offset, grows downward
  let beamX = 0; // current headlight aim (px)
  let beamTargetX = 0; // where the pointer wants it
  let sceneSalt = 1;
  let onscreen = true;
  let running = false;
  let raf = 0;
  let last = 0;
  let spawnTimer = 0;
  let brake = 0; // brake-light flash, decays

  // Speed of the road (px/sec). Reduced motion parks the car — you sweep the
  // headlamp over stationary animals instead of dodging vestibular motion.
  const SPEED = reduceMotion ? 0 : 74;
  const rainDrops: { x: number; y: number; len: number; v: number }[] = [];

  function rng(seed: number): () => number {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

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

  // Road geometry: a lane down the middle with gravel shoulders. Animals live
  // between roadLeft()..roadRight() (including a little onto the shoulders).
  function roadHalf(): number {
    return Math.min(W * 0.34, 230);
  }
  function laneEdge(side: number): number {
    return W / 2 + side * roadHalf();
  }

  function spawnAnimal(atTop: boolean): void {
    const sp = pickSpecies();
    const half = roadHalf();
    const x = W / 2 + (Math.random() - 0.5) * 2 * (half * 1.05);
    const y = atTop ? -30 - Math.random() * 40 : Math.random() * H * 0.6;
    const size = sp.size * (0.9 + Math.random() * 0.15);
    animals.push({ sp, x, y, size, wiggle: 0, found: false });
  }

  function buildScene(): void {
    animals = [];
    scrollY = 0;
    const r = rng(Math.round(W) * 13 + sceneSalt * 101);
    const seed = Math.max(4, Math.round(H / 90));
    for (let i = 0; i < seed; i++) spawnAnimal(false);
    rainDrops.length = 0;
    const drops = reduceMotion ? 0 : Math.round((W * H) / 9000);
    for (let i = 0; i < drops; i++) {
      rainDrops.push({
        x: r() * W,
        y: r() * H,
        len: 6 + r() * 10,
        v: 340 + r() * 260,
      });
    }
    bakeRoad();
  }

  function fit(): void {
    const cssW =
      canvas!.clientWidth || (wrap as HTMLElement).clientWidth || 640;
    const cssH = Math.max(340, Math.min(560, Math.round(cssW * 0.7)));
    canvas!.style.height = `${cssH}px`;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas!.width = Math.round(cssW * dpr);
    canvas!.height = Math.round(cssH * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.imageSmoothingEnabled = false;
    W = cssW;
    H = cssH;
    if (!beamX) {
      beamX = W / 2;
      beamTargetX = W / 2;
    }
    buildScene();
  }

  // The asphalt + shoulders + forest edges are baked once into a tile of height
  // H and blitted twice with the scroll offset, so the whole road surface slides
  // seamlessly under the car. The scrolling centerline dashes are drawn live.
  function bakeRoad(): void {
    const c = document.createElement("canvas");
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const b = c.getContext("2d");
    if (!b) return;
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    b.imageSmoothingEnabled = false;
    const r = rng(Math.round(W) * 31 + sceneSalt * 101);
    const lx = laneEdge(-1);
    const rx = laneEdge(1);

    // forest floor / undergrowth on the far sides
    b.fillStyle = "#0d130c";
    b.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      const side = r() < 0.5 ? 0 : 1;
      const x = side ? rx + 8 + r() * (W - rx - 8) : r() * Math.max(1, lx - 8);
      const y = r() * H;
      b.fillStyle = r() < 0.5 ? "#152016" : "#0f1a10";
      b.fillRect(snap(x), snap(y), PIX, PIX);
    }

    // gravel shoulders
    for (const [sx, ex] of [
      [lx - 26, lx],
      [rx, rx + 26],
    ] as const) {
      b.fillStyle = "#2a2620";
      b.fillRect(snap(sx), 0, snap(ex - sx), H);
      for (let i = 0; i < 120; i++) {
        b.fillStyle = r() < 0.5 ? "#3a352c" : "#211d18";
        b.fillRect(snap(sx + r() * (ex - sx)), snap(r() * H), PIX, PIX);
      }
    }

    // asphalt
    const g = b.createLinearGradient(lx, 0, rx, 0);
    g.addColorStop(0, "#1c1e22");
    g.addColorStop(0.5, "#26282d");
    g.addColorStop(1, "#1c1e22");
    b.fillStyle = g;
    b.fillRect(snap(lx), 0, snap(rx - lx), H);
    // wet speckle + faint cracks
    for (let i = 0; i < 260; i++) {
      b.fillStyle = r() < 0.5 ? "rgba(70,76,86,0.5)" : "rgba(10,12,16,0.6)";
      b.fillRect(snap(lx + r() * (rx - lx)), snap(r() * H), PIX, PIX);
    }
    // damp puddle sheen patches
    for (let i = 0; i < 5; i++) {
      const px = lx + PIX + r() * (rx - lx - PIX * 2);
      const py = r() * H;
      const pw = 20 + r() * 60;
      b.fillStyle = "rgba(90,110,130,0.10)";
      for (let k = -3; k <= 3; k++) {
        const ww = Math.round(Math.sqrt(Math.max(0, 1 - (k / 3.5) ** 2)) * pw);
        b.fillRect(snap(px - ww / 2), snap(py + k * PIX * 2), ww, PIX * 2);
      }
    }
    // solid lane-edge paint (fog lines)
    b.fillStyle = "rgba(210,205,180,0.5)";
    b.fillRect(snap(lx + PIX), 0, PIX, H);
    b.fillRect(snap(rx - PIX * 2), 0, PIX, H);

    bg = c;
  }

  // ------------------------------------------------------------- lighting
  /** Elliptical beam metric: how far (0 = center) an (x,y) is from the pool. */
  function beamDist(x: number, y: number): number {
    const cy = H * 0.46;
    const rx = Math.max(60, W * 0.2);
    const ry = H * 0.4;
    const dx = (x - beamX) / rx;
    const dy = (y - cy) / ry;
    return Math.hypot(dx, dy);
  }

  function drawSprite(
    c: Ctx,
    a: Animal,
    cx: number,
    cy: number,
    unit: number,
  ): void {
    c.save();
    c.translate(snap(cx), snap(cy));
    if (a.wiggle > 0)
      c.rotate(Math.sin(a.wiggle * 22) * 0.14 * Math.min(1, a.wiggle));
    SPRITES[a.sp.category](c, unit, a.sp.color, a.sp.accent);
    c.restore();
  }

  function drawEyeshine(c: Ctx, a: Animal, intensity: number): void {
    const unit = PIX * a.size;
    const e = EYE[a.sp.category];
    const ey = a.y + e.dy * unit;
    const [rr, gg, bb] = hexToRgb(a.sp.eyeshine);
    const flick = 0.85 + 0.15 * Math.sin(performance.now() / 110 + a.x);
    // A tight coloured halo around a small bright pupil-glint, so it reads as
    // eyeshine rather than a glowing orb. Halo grows only modestly with intensity.
    const halo = unit * (1.6 + intensity * 1.9);
    for (const s of [-1, 1]) {
      const ex = a.x + s * e.dx * unit;
      const grd = c.createRadialGradient(ex, ey, 0, ex, ey, halo);
      grd.addColorStop(
        0,
        `rgba(${rr},${gg},${bb},${(0.85 * intensity * flick).toFixed(3)})`,
      );
      grd.addColorStop(
        0.45,
        `rgba(${rr},${gg},${bb},${(0.28 * intensity).toFixed(3)})`,
      );
      grd.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
      c.fillStyle = grd;
      c.beginPath();
      c.arc(ex, ey, halo, 0, Math.PI * 2);
      c.fill();
      // bright round pupil-glint
      c.fillStyle = `rgba(255,255,255,${(0.95 * intensity * flick).toFixed(3)})`;
      c.beginPath();
      c.arc(ex, ey, Math.max(1.1, unit * 0.32), 0, Math.PI * 2);
      c.fill();
    }
  }

  function render(): void {
    ctx!.clearRect(0, 0, W, H);

    // 1) scrolling road surface (two tiles)
    if (bg) {
      const off = ((scrollY % H) + H) % H;
      ctx!.drawImage(bg, 0, 0, bg.width, bg.height, 0, off, W, H);
      ctx!.drawImage(bg, 0, 0, bg.width, bg.height, 0, off - H, W, H);
    }

    // 2) scrolling centerline dashes
    const dash = 26;
    const gap = 22;
    const period = dash + gap;
    ctx!.fillStyle = "rgba(220,214,150,0.55)";
    let y = -((scrollY % period) + period) % period;
    for (; y < H; y += period)
      ctx!.fillRect(snap(W / 2 - PIX), snap(y), PIX * 2, dash);

    // 3) animals (drawn bright; the night veil below hides the unlit ones)
    for (const a of animals) {
      const d = beamDist(a.x, a.y);
      if (d < 1.35) drawSprite(ctx!, a, a.x, a.y, PIX * a.size);
    }

    // 4) the night veil, punched by the headlight beam
    ctx!.save();
    ctx!.fillStyle = "rgba(3,5,10,0.95)";
    ctx!.fillRect(0, 0, W, H);
    ctx!.globalCompositeOperation = "destination-out";
    const cy = H * 0.46;
    const rx = Math.max(60, W * 0.2);
    const ry = H * 0.4;
    ctx!.save();
    ctx!.translate(beamX, cy);
    ctx!.scale(rx / ry, 1);
    const beam = ctx!.createRadialGradient(0, 0, 0, 0, 0, ry);
    beam.addColorStop(0, "rgba(0,0,0,1)");
    beam.addColorStop(0.55, "rgba(0,0,0,0.85)");
    beam.addColorStop(1, "rgba(0,0,0,0)");
    ctx!.fillStyle = beam;
    ctx!.fillRect(
      -ry * (rx / ry) - 10,
      -ry - 10,
      (ry * (rx / ry) + 10) * 2,
      (ry + 10) * 2,
    );
    ctx!.restore();
    ctx!.restore();

    // 5) warm headlight tint over the lit pool
    ctx!.save();
    ctx!.globalCompositeOperation = "overlay";
    ctx!.translate(beamX, cy);
    ctx!.scale(rx / ry, 1);
    const warm = ctx!.createRadialGradient(0, 0, 0, 0, 0, ry);
    warm.addColorStop(0, "rgba(255,238,190,0.28)");
    warm.addColorStop(1, "rgba(255,238,190,0)");
    ctx!.fillStyle = warm;
    ctx!.fillRect(-ry * (rx / ry), -ry, ry * (rx / ry) * 2, ry * 2);
    ctx!.restore();

    // 6) eyeshine glints — a ring of tells around the beam's edge, so animals
    //    betray themselves as you sweep toward them, before the body fades in.
    for (const a of animals) {
      if (a.found) continue;
      const d = beamDist(a.x, a.y);
      // Brightest when the beam is on the animal (d small), fading with distance
      // so a faint glint still tips you off as you sweep toward it.
      const intensity = Math.max(0, Math.min(1, 1.25 - d / 1.35));
      if (intensity > 0.04) drawEyeshine(ctx!, a, intensity);
    }

    // 7) rain streaks
    if (rainDrops.length) {
      ctx!.strokeStyle = "rgba(150,170,200,0.25)";
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      for (const p of rainDrops) {
        ctx!.moveTo(p.x, p.y);
        ctx!.lineTo(p.x - 2, p.y + p.len);
      }
      ctx!.stroke();
    }

    // 8) the car hood + twin headlamps at the bottom
    drawHood();

    // 9) brake-light flash on a successful ID
    if (brake > 0) {
      ctx!.fillStyle = `rgba(220,40,40,${(0.35 * brake).toFixed(3)})`;
      ctx!.fillRect(0, H - 10, W, 10);
    }
  }

  function drawHood(): void {
    const hoodTop = H - 18;

    // hood silhouette with a faint top rim so it reads as a car
    ctx!.fillStyle = "#06080c";
    ctx!.beginPath();
    ctx!.moveTo(W * 0.5 - 160, H + 6);
    ctx!.quadraticCurveTo(W * 0.5 - 94, hoodTop - 8, W * 0.5 - 74, hoodTop);
    ctx!.lineTo(W * 0.5 + 74, hoodTop);
    ctx!.quadraticCurveTo(W * 0.5 + 94, hoodTop - 8, W * 0.5 + 160, H + 6);
    ctx!.closePath();
    ctx!.fill();
    ctx!.strokeStyle = "rgba(140,150,170,0.2)";
    ctx!.lineWidth = 1;
    ctx!.beginPath();
    ctx!.moveTo(W * 0.5 - 74, hoodTop + 0.5);
    ctx!.lineTo(W * 0.5 + 74, hoodTop + 0.5);
    ctx!.stroke();

    // two round headlamps: soft glow + housing ring + bright lens + hot core
    for (const s of [-1, 1]) {
      const hx = W / 2 + s * 54;
      const hy = hoodTop - 2;

      ctx!.save();
      ctx!.globalCompositeOperation = "lighter";
      const glow = ctx!.createRadialGradient(hx, hy, 0, hx, hy, 32);
      glow.addColorStop(0, "rgba(255,246,210,0.5)");
      glow.addColorStop(0.4, "rgba(255,236,180,0.2)");
      glow.addColorStop(1, "rgba(255,236,180,0)");
      ctx!.fillStyle = glow;
      ctx!.beginPath();
      ctx!.arc(hx, hy, 32, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.restore();

      // housing ring
      ctx!.fillStyle = "#0e1116";
      ctx!.beginPath();
      ctx!.ellipse(hx, hy, 13, 8, 0, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.strokeStyle = "rgba(120,130,150,0.4)";
      ctx!.lineWidth = 1;
      ctx!.stroke();

      // bright lens
      const lens = ctx!.createRadialGradient(hx, hy, 0, hx, hy, 11);
      lens.addColorStop(0, "rgba(255,255,255,1)");
      lens.addColorStop(0.4, "rgba(255,248,214,0.95)");
      lens.addColorStop(1, "rgba(255,214,130,0)");
      ctx!.fillStyle = lens;
      ctx!.beginPath();
      ctx!.ellipse(hx, hy, 11, 6.5, 0, 0, Math.PI * 2);
      ctx!.fill();

      // hot core
      ctx!.fillStyle = "#fffdf6";
      ctx!.beginPath();
      ctx!.ellipse(hx, hy, 3.2, 2.2, 0, 0, Math.PI * 2);
      ctx!.fill();
    }
  }

  // ------------------------------------------------------------- the loop
  function update(dt: number): void {
    scrollY += SPEED * dt;
    beamX += (beamTargetX - beamX) * Math.min(1, dt * 9);
    if (brake > 0) brake = Math.max(0, brake - dt * 2);

    for (const a of animals) {
      a.y += SPEED * dt;
      if (a.wiggle > 0) a.wiggle = Math.max(0, a.wiggle - dt);
    }
    // recycle animals that slid past the car
    animals = animals.filter((a) => a.y < H + 60);

    // keep the road populated
    if (SPEED > 0) {
      spawnTimer -= dt;
      const target = Math.max(4, Math.round(H / 90));
      if (spawnTimer <= 0 && animals.length < target + 2) {
        spawnAnimal(true);
        spawnTimer = 0.5 + Math.random() * 0.9;
      }
    }
  }

  function updateRain(dt: number): void {
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
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(reduceMotion ? 0 : dt);
    updateRain(reduceMotion ? 0 : dt);
    render();
    raf = requestAnimationFrame(step);
  }
  function start(): void {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(step);
  }
  function stop(): void {
    running = false;
    cancelAnimationFrame(raf);
  }

  // ----------------------------------------------------------- discovery
  function reveal(a: Animal): void {
    a.found = true;
    a.wiggle = 0.9;
    brake = 1;
    const sp = a.sp;
    const isNew = !discovered.has(sp.id);
    if (isNew) {
      discovered.add(sp.id);
      saveDiscovered(discovered);
      updateJournal();
    }
    // drift the found animal off after a moment so it doesn't linger forever
    setTimeout(() => {
      a.y = H + 100;
    }, 1400);
    showCard(sp, isNew);
  }

  function paintRevealSprite(sp: HerpSpecies): void {
    if (photoEl) photoEl.classList.add("hp-hidden");
    revealCanvas!.classList.remove("hp-hidden");
    const size = 120;
    revealCanvas!.width = size * dpr;
    revealCanvas!.height = size * dpr;
    rctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    rctx!.imageSmoothingEnabled = false;
    rctx!.clearRect(0, 0, size, size);
    rctx!.fillStyle = "#0b1020";
    rctx!.fillRect(0, 0, size, size);
    // a hint of headlight glow behind the sprite
    const grd = rctx!.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size * 0.6,
    );
    grd.addColorStop(0, "rgba(255,238,190,0.16)");
    grd.addColorStop(1, "rgba(255,238,190,0)");
    rctx!.fillStyle = grd;
    rctx!.fillRect(0, 0, size, size);
    rctx!.save();
    rctx!.translate(size / 2, size / 2 + 8);
    SPRITES[sp.category](rctx!, PIX * 2 * sp.size, sp.color, sp.accent);
    rctx!.restore();
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

  function showCard(sp: HerpSpecies, isNew: boolean): void {
    const override = PHOTOS[sp.id];
    const photo = sp.photo ?? override?.photo;
    const credit = sp.photoCredit ?? override?.credit ?? "";
    if (photo && photoEl) {
      photoEl.classList.remove("hp-hidden");
      revealCanvas!.classList.add("hp-hidden");
      photoEl.onerror = () => {
        paintRevealSprite(sp);
        if (creditEl) creditEl.classList.add("hp-hidden");
      };
      photoEl.alt = sp.common;
      photoEl.src = photo;
      if (creditEl) {
        creditEl.textContent = credit;
        creditEl.classList.toggle("hp-hidden", !credit);
      }
    } else {
      paintRevealSprite(sp);
      if (creditEl) creditEl.classList.add("hp-hidden");
    }

    nameEl!.textContent = sp.common;
    sciEl!.textContent = sp.scientific;
    factEl!.textContent = sp.facts[Math.floor(Math.random() * sp.facts.length)];
    badgeEl!.textContent = sp.nonNative
      ? "Non-native"
      : isNew
        ? "New find!"
        : "Found again";
    badgeEl!.classList.toggle("hp-badge-new", isNew && !sp.nonNative);
    badgeEl!.classList.toggle("hp-badge-warn", !!sp.nonNative);
    card!.classList.add("hp-open");
  }

  function updateJournal(): void {
    progressEl!.textContent = `${discovered.size} / ${total} species`;
    barEl!.style.width = `${(discovered.size / total) * 100}%`;
  }

  /** Topmost tappable (at least partly lit) animal under a point. */
  function hitTest(px: number, py: number): Animal | null {
    let best: Animal | null = null;
    let bestD = Infinity;
    for (const a of animals) {
      if (a.found) continue;
      const unit = PIX * a.size;
      const rad = unit * 9;
      const dd = Math.hypot(px - a.x, py - a.y);
      if (dd <= rad && beamDist(a.x, a.y) < 1.3 && dd < bestD) {
        best = a;
        bestD = dd;
      }
    }
    return best;
  }

  // -------------------------------------------------------------- wiring
  function pointToCanvas(e: PointerEvent): { x: number; y: number } {
    const rect2 = canvas!.getBoundingClientRect();
    return { x: e.clientX - rect2.left, y: e.clientY - rect2.top };
  }

  canvas.addEventListener("pointerdown", (e: PointerEvent) => {
    const p = pointToCanvas(e);
    beamTargetX = p.x;
    const a = hitTest(p.x, p.y);
    if (a) reveal(a);
  });
  canvas.addEventListener("pointermove", (e: PointerEvent) => {
    const p = pointToCanvas(e);
    if (e.pointerType === "touch" && e.buttons === 0) return; // only steer while dragging on touch
    beamTargetX = p.x;
    if (e.pointerType !== "touch") {
      canvas.style.cursor = hitTest(p.x, p.y) ? "pointer" : "crosshair";
    }
  });

  closeBtn.addEventListener("click", () => card.classList.remove("hp-open"));
  card.addEventListener("click", (e) => {
    if (e.target === card) card.classList.remove("hp-open");
  });
  resetBtn?.addEventListener("click", () => {
    sceneSalt++;
    buildScene();
  });

  const ro = new ResizeObserver(() => {
    fit();
    if (!running && onscreen && !document.hidden) render();
  });
  ro.observe(wrap);

  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) onscreen = en.isIntersecting;
      if (onscreen && !document.hidden) start();
      else stop();
    },
    { threshold: 0.05 },
  );
  io.observe(canvas);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (onscreen) start();
  });

  // --------------------------------------------------------------- init
  fit();
  updateJournal();
  render();
  start();
  preloadPhotos();
}
