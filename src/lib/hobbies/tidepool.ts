/**
 * Tide pooling: turn the rocks.
 *
 * You look straight down at a metre and a bit of Washington shore: one of six
 * beaches (tidepool-beaches.ts), built from CC0 scans of rock, gravel and sand
 * by scripts/tidepool/build-beaches.py. Loose rocks turn over to show what's
 * under them and go back the way they were (the big boulder takes three
 * heaves), the water in the pools moves and bends the light (tidepool-water.ts),
 * and in the surge channel the seaweed sways and parts when you brush it.
 * Every animal is a CC0 or public-domain photo of it seen from above
 * (scripts/tidepool/prep-animals.py), lit here by the scene's own sun at
 * whatever angle it lies, with a shadow on what it rests on. Nothing alive is
 * in the scene unless this put it there, so a tap is always named right.
 *
 * A find opens the reveal card (SpecimenCard.astro) through one of three
 * reveals (specimen-reveal.ts), a first find hops into the field journal when
 * the card closes (journal-hop.ts), and today's three are three animals on
 * today's beach, found from their clues.
 *
 * Layers: the beach and everything on it draws into an offscreen canvas; the
 * water pass draws that onto the bottom canvas with water over the pools; the
 * rocks, splashes, focus ring and the wave that brings a new beach draw on
 * the top canvas. Mounted by TidePool.astro through [data-tp-*] hooks.
 */
import { whenUncovered } from "../covered";
import {
  SPECIES,
  type TidepoolSpecies,
  type TidepoolCategory,
} from "./tidepool-species";
import photoData from "./tidepool-photos.json";
import animalData from "./tidepool-animals.json";
import { stampFind, upgradePhoto } from "./specimen";
import { journalHop } from "./journal-hop";
import {
  mountRevealSwitch,
  playReveal,
  revealStyle,
  stopReveal,
  type Box,
} from "./specimen-reveal";
import {
  ART_BASE,
  BEACHES,
  GROUND_SAYS,
  LABEL_SPECIES,
  OTHER_LIFE,
  WET_SLOTS,
  clueFor,
  dayNumber,
  deal,
  hingeReach,
  landing,
  todaysBeach,
  todaysThree,
  type BeachData,
  type BeachId,
  type Placed,
  type Rock,
  type Weed,
} from "./tidepool-beaches";
import {
  BACK_S,
  HEAVE_S,
  OVER,
  OVER_S,
  backAngle,
  critterReact,
  heaveAngle,
  heavePeak,
  makeTide,
  overAngle,
  reactionFor,
  reactionLength,
  tideDone,
  tideFront,
  type Tide,
} from "./tidepool-motion";
import {
  createWater,
  waterTint,
  type Ring,
  type Water,
} from "./tidepool-water";

const PHOTOS = (photoData.species ?? {}) as Record<
  string,
  { photo?: string; credit?: string }
>;
interface AnimalMeta {
  cm: number | null;
  view: string;
  w: number;
  h: number;
  box: [number, number, number, number];
}
const ANIMALS = animalData as unknown as Record<string, AnimalMeta>;
const BY_ID = new Map(SPECIES.map((s) => [s.id, s]));
const STORE_KEY = "tidepool-discovered-v1";
const TODAY_KEY = "tidepool-today-v1";

/** How tall each kind of animal stands, cm: sets its shadow and how strongly
 *  its surface takes the light. */
const THICK: Record<TidepoolCategory, number> = {
  crab: 2.5,
  hermit: 3,
  star: 1.8,
  anemone: 2.5,
  nudibranch: 1.4,
  chiton: 1,
  snail: 2.4,
  limpet: 1.4,
  urchin: 4,
  barnacle: 1.4,
  mussel: 3,
  sculpin: 2,
  eel: 1.6,
  shrimp: 1,
  cucumber: 4,
  octopus: 2.5,
};
/** Size in cm when an animal's own record has none. */
const DEFAULT_CM: Record<TidepoolCategory, number> = {
  crab: 6,
  hermit: 4,
  star: 15,
  anemone: 10,
  nudibranch: 5,
  chiton: 6,
  snail: 3,
  limpet: 3.5,
  urchin: 8,
  barnacle: 6,
  mussel: 10,
  sculpin: 7,
  eel: 15,
  shrimp: 3.5,
  cucumber: 25,
  octopus: 30,
};
const GLOSS: Partial<Record<TidepoolCategory, number>> = {
  anemone: 0.6,
  nudibranch: 0.6,
  snail: 0.5,
  mussel: 0.6,
  star: 0.3,
  cucumber: 0.4,
  octopus: 0.5,
  chiton: 0.4,
  limpet: 0.35,
};
/** The sun, from the upper left (the same as build-beaches.py). */
const LX = -0.5 / 0.9454;
const LY = -0.6 / 0.9454;
const LZ = 0.55 / 0.9454;
/** Shadows fall down and right. */
const SHX = 0.64;
const SHY = 0.77;

// -------------------------------------------------------------- loading

const imgs = new Map<string, Promise<HTMLImageElement>>();
function loadImg(url: string): Promise<HTMLImageElement> {
  let p = imgs.get(url);
  if (!p) {
    p = new Promise((res, rej) => {
      const im = new Image();
      im.decoding = "async";
      im.onload = () => res(im);
      im.onerror = () => rej(new Error(url));
      im.src = url;
    });
    imgs.set(url, p);
  }
  return p;
}

interface BeachArt {
  data: BeachData;
  base: HTMLImageElement;
  depth: HTMLImageElement;
  labels: Uint8Array;
  labW: number;
  labH: number;
  rocks: { top: HTMLImageElement; under: HTMLImageElement }[];
  tint: HTMLCanvasElement | null;
}
const beachArt = new Map<BeachId, Promise<BeachArt>>();
function loadBeach(id: BeachId): Promise<BeachArt> {
  let p = beachArt.get(id);
  if (!p) {
    const dir = `${ART_BASE}/${id}/`;
    p = (async () => {
      const data = (await (
        await fetch(dir + "beach.json")
      ).json()) as BeachData;
      const [base, depth, lab, ...rocks] = await Promise.all([
        loadImg(dir + "base.webp"),
        loadImg(dir + "water.png"),
        loadImg(dir + "labels.png"),
        ...data.rocks.map((r) =>
          Promise.all([loadImg(dir + r.file), loadImg(dir + r.under)]),
        ),
      ] as Promise<unknown>[]);
      const c = document.createElement("canvas");
      c.width = (lab as HTMLImageElement).naturalWidth;
      c.height = (lab as HTMLImageElement).naturalHeight;
      const x = c.getContext("2d", { willReadFrequently: true })!;
      x.drawImage(lab as HTMLImageElement, 0, 0);
      const px = x.getImageData(0, 0, c.width, c.height).data;
      const labels = new Uint8Array(c.width * c.height);
      for (let i = 0; i < labels.length; i++) labels[i] = px[i * 4];
      return {
        data,
        base: base as HTMLImageElement,
        depth: depth as HTMLImageElement,
        labels,
        labW: c.width,
        labH: c.height,
        rocks: (rocks as [HTMLImageElement, HTMLImageElement][]).map(
          ([top, under]) => ({ top, under }),
        ),
        tint: null,
      };
    })();
    p.catch(() => beachArt.delete(id));
    beachArt.set(id, p);
  }
  return p;
}

interface AnimalArt {
  img: HTMLImageElement;
  hmap: HTMLImageElement;
}
const animalArt = new Map<string, Promise<AnimalArt>>();
function loadAnimal(id: string): Promise<AnimalArt> {
  let p = animalArt.get(id);
  if (!p) {
    p = Promise.all([
      loadImg(`${ART_BASE}/animals/${id}.webp`),
      loadImg(`${ART_BASE}/animals/${id}-h.webp`),
    ]).then(([img, hmap]) => ({ img, hmap }));
    animalArt.set(id, p);
  }
  return p;
}

const WEED_FILES = [
  "surfgrass",
  "kelp",
  "rockweed",
  "sea-lettuce-0",
  "sea-lettuce-1",
  "sea-lettuce-2",
];
let weedArt: Promise<Record<string, HTMLImageElement>> | null = null;
function loadWeeds() {
  weedArt ??= Promise.all(
    WEED_FILES.map((n) => loadImg(`${ART_BASE}/weeds/${n}.webp`)),
  ).then((list) =>
    Object.fromEntries(list.map((im, i) => [WEED_FILES[i], im])),
  );
  return weedArt;
}

function cmFor(sp: TidepoolSpecies): number {
  return ANIMALS[sp.id]?.cm ?? DEFAULT_CM[sp.category];
}

function seeded(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function inside(pts: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      hit = !hit;
  }
  return hit;
}

// -------------------------------------------------------------- the scene

interface Animal {
  p: Placed;
  sp: TidepoolSpecies;
  art: AnimalArt;
  /** Field px across the cutout's opaque part. */
  len: number;
  wet: boolean;
  rock: RockState | null;
  /** Hidden under a clump of seaweed until it's parted. */
  weed: WeedClump | null;
  dx: number;
  dy: number;
  /** For anemones: 1 open, 0 shut. */
  open: number;
  react: { t0: number; dir: 1 | -1; ang: number } | null;
  /** Out from under a turned rock, where it ran to, field px. */
  run: { x: number; y: number; t0: number; back: boolean } | null;
  phase: number;
  baked: HTMLCanvasElement | null;
  shade: HTMLCanvasElement | null;
  /** Device px per field px the bake was made at, and its half size in field px. */
  bakedK: number;
  half: number;
}

type RockMode = "rest" | "over" | "up" | "back" | "heave";
interface RockState {
  d: Rock;
  i: number;
  top: HTMLImageElement;
  under: HTMLImageElement;
  dark: { top: HTMLCanvasElement; under: HTMLCanvasElement };
  shadow: HTMLCanvasElement;
  e: number;
  thick: number;
  mode: RockMode;
  t0: number;
  from: number;
  peak: number;
  heaves: number;
  angle: number;
  landed: [number, number][];
  /** When light first got under it on this turn. */
  lit: number;
  /** When the last heave slipped back: heaves count for a few seconds. */
  heaveAt: number;
}

interface Blade {
  tex: string;
  len: number;
  w: number;
  ang: number;
  curl: number;
  phase: number;
  dx: number;
  dy: number;
  /** Sea lettuce: a whole sheet, drawn as a sprite. */
  sheet?: number;
}
interface WeedClump {
  w: Weed;
  blades: Blade[];
  part: number;
  partGoal: number;
  partUntil: number;
  partDir: number;
  reach: number;
}

interface Drop {
  x: number;
  y: number;
  t0: number;
  fall: number;
  sand: boolean;
}

function darkCopy(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext("2d")!;
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = "source-atop";
  x.fillStyle = "#060807";
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

/** A soft silhouette: the image's alpha, small, so it scales up blurred. */
function softShadow(
  src: CanvasImageSource,
  w: number,
  h: number,
  k = 6,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(w / k));
  c.height = Math.max(2, Math.round(h / k));
  const x = c.getContext("2d")!;
  x.drawImage(src, 0, 0, c.width, c.height);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = "#000";
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

export function initTidepool(root: HTMLElement): void {
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s);
  const frame = $<HTMLElement>("[data-tp-frame]");
  const waterCanvas = $<HTMLCanvasElement>("[data-tp-water]");
  const canvas = $<HTMLCanvasElement>("[data-tp-canvas]");
  const card = $<HTMLElement>("[data-tp-card]");
  const revealCanvas = $<HTMLCanvasElement>("[data-tp-reveal]");
  const nameEl = $<HTMLElement>("[data-tp-name]");
  const sciEl = $<HTMLElement>("[data-tp-sci]");
  const factEl = $<HTMLElement>("[data-tp-fact]");
  const badgeEl = $<HTMLElement>("[data-tp-badge]");
  const markEl = $<HTMLElement>("[data-tp-mark]");
  const closeBtn = $<HTMLButtonElement>("[data-tp-close]");
  const countEl = $<HTMLElement>("[data-tp-count]");
  const lastEl = $<HTMLElement>("[data-tp-last]");
  const barEl = $<HTMLElement>("[data-tp-bar]");
  const resetBtn = $<HTMLButtonElement>("[data-tp-reset]");
  const photoEl = $<HTMLImageElement>("[data-tp-photo]");
  const creditEl = $<HTMLElement>("[data-tp-credit]");
  const live = $<HTMLElement>("[data-tp-live]");
  const sayEl = $<HTMLElement>("[data-tp-say]");
  const threeEl = $<HTMLElement>("[data-tp-three]");
  const panEl = $<HTMLElement>("[data-tp-pan]");
  if (
    !frame ||
    !waterCanvas ||
    !canvas ||
    !card ||
    !revealCanvas ||
    !nameEl ||
    !sciEl ||
    !factEl ||
    !badgeEl ||
    !closeBtn ||
    !countEl ||
    !barEl ||
    !photoEl
  )
    return;
  const top = canvas.getContext("2d");
  if (!top) return;
  const pic = photoEl.parentElement!;
  const specimen = card.querySelector<HTMLElement>(".specimen") ?? card;

  const reduced = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // ?slow=4 plays the rocks and creatures four times slower, for checking motion.
  const slow = Math.max(
    1,
    Number(new URLSearchParams(location.search).get("slow")) || 1,
  );
  const isDark = () => document.documentElement.classList.contains("dark");

  // The bottom layer: water over the beach in WebGL, or a tint in 2D.
  let water: Water | null = null;
  try {
    water = createWater(waterCanvas);
  } catch {
    water = null;
  }
  const flat = water ? null : waterCanvas.getContext("2d");
  const under = document.createElement("canvas");
  const uctx = under.getContext("2d")!;

  // ------------------------------------------------------------ journal
  const discovered: Set<string> = (() => {
    try {
      return new Set(
        JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as string[],
      );
    } catch {
      return new Set<string>();
    }
  })();
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify([...discovered]));
    } catch {
      /* private mode */
    }
  };
  const journal = journalHop({
    count: countEl,
    bar: barEl,
    total: SPECIES.length,
    found: () => discovered.size,
    grid: () => canvas,
    pix: 1,
    smooth: true,
  });

  // ------------------------------------------------------------ today
  const day = dayNumber(new Date());
  const todayId = todaysBeach(day);
  let three: string[] = [];
  const foundToday: Set<string> = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(TODAY_KEY) ?? "{}") as {
        day?: number;
        found?: string[];
      };
      return new Set(raw.day === day ? (raw.found ?? []) : []);
    } catch {
      return new Set<string>();
    }
  })();
  const saveToday = () => {
    try {
      localStorage.setItem(
        TODAY_KEY,
        JSON.stringify({ day, found: [...foundToday] }),
      );
    } catch {
      /* ignore */
    }
  };

  // ------------------------------------------------------------ state
  let cur: BeachArt | null = null;
  let beachId: BeachId = todayId;
  let animals: Animal[] = [];
  let rocks: RockState[] = [];
  let clumps: WeedClump[] = [];
  let weeds: Record<string, HTMLImageElement> | null = null;
  const drops: Drop[] = [];
  const rings: Ring[] = [];
  let focus:
    | { kind: "animal"; a: Animal }
    | { kind: "rock"; r: RockState }
    | { kind: "weed"; c: WeedClump }
    | null = null;
  let tide: (Tide & { swapped: boolean }) | null = null;
  let wetUntil = 0;
  let cardFind: {
    a: Animal | null;
    sp: TidepoolSpecies;
    isNew: boolean;
    from: Box | null;
    sprite: HTMLCanvasElement | null;
  } | null = null;
  let underDirty = true;
  let running = false;
  let onscreen = true;
  let raf = 0;
  let t0 = performance.now();

  // ------------------------------------------------------------ view
  const view = { s: 1, ox: 0, oy: 0, W: 0, H: 0, dpr: 1, phone: false };
  const FW = 2400;
  const FH = 1500;
  function fit(): void {
    const w = frame!.clientWidth;
    if (!w) return;
    view.phone = w < 560;
    const h = view.phone
      ? Math.round(Math.min(620, w * 1.5))
      : Math.round((w * FH) / FW);
    view.W = w;
    view.H = h;
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    view.s = view.phone ? h / FH : w / FW;
    view.oy = 0;
    view.ox = view.phone
      ? clamp(view.ox || FW / 2 - w / view.s / 2, 0, FW - w / view.s)
      : 0;
    for (const c of [canvas!, waterCanvas!, under]) {
      c.width = Math.round(w * view.dpr);
      c.height = Math.round(h * view.dpr);
    }
    canvas!.style.height = waterCanvas!.style.height = `${h}px`;
    frame!.style.height = `${h}px`;
    water?.resize(waterCanvas!.width, waterCanvas!.height);
    for (const a of animals) a.baked = null;
    underDirty = true;
    kick();
  }
  const toField = (cx: number, cy: number) => ({
    x: cx / view.s + view.ox,
    y: cy / view.s + view.oy,
  });
  const toScreen = (x: number, y: number) => ({
    x: (x - view.ox) * view.s,
    y: (y - view.oy) * view.s,
  });

  // ------------------------------------------------------------ the deal
  function say(m: string): void {
    if (sayEl) sayEl.textContent = m;
  }
  function beachLine(): string {
    const b = BEACHES.find((x) => x.id === beachId)!;
    return `${b.title}. ${b.line}`;
  }

  async function setBeach(id: BeachId, seed: number): Promise<void> {
    if (!three.length)
      three = todaysThree(day, (await loadBeach(todayId)).data);
    const art = await loadBeach(id);
    const isToday = id === todayId && seed === day;
    const must = isToday ? three : [];
    const sizes = Object.fromEntries(SPECIES.map((s) => [s.id, cmFor(s)]));
    const placed = deal(art.data, seed, sizes, must);
    const arts = await Promise.all(
      placed.map((p) => loadAnimal(p.id).catch(() => null)),
    );
    if (id === "channel") weeds = await loadWeeds().catch(() => null);
    cur = art;
    beachId = id;
    rocks = art.data.rocks.map((d, i) => ({
      d,
      i,
      top: art.rocks[i].top,
      under: art.rocks[i].under,
      dark: {
        top: darkCopy(art.rocks[i].top),
        under: darkCopy(art.rocks[i].under),
      },
      shadow: softShadow(art.rocks[i].top, d.w, d.h, 5),
      e: hingeReach(d),
      thick: Math.min(d.thick, d.size * 0.6),
      mode: "rest",
      t0: 0,
      from: 0,
      peak: 0,
      heaves: 0,
      angle: 0,
      landed: landing(d),
      lit: 0,
      heaveAt: 0,
    }));
    clumps = id === "channel" ? art.data.weeds.map(makeClump) : [];
    const R = seeded(seed * 31 + 7);
    animals = [];
    placed.forEach((p, i) => {
      const a = arts[i];
      const sp = BY_ID.get(p.id);
      if (!a || !sp) return;
      const meta = ANIMALS[p.id];
      const an: Animal = {
        p,
        sp,
        art: a,
        len: p.cm * art.data.pxcm,
        wet: WET_SLOTS.has(p.on),
        rock: p.rock === null ? null : rocks[p.rock],
        weed: null,
        dx: 0,
        dy: 0,
        open: 1,
        react: null,
        run: null,
        phase: R() * 10,
        baked: null,
        shade: null,
        bakedK: 0,
        half: 0,
      };
      if (meta?.view === "side" && !an.rock)
        an.p.rot = (R() - 0.5) * 0.6 + (R() < 0.5 ? 0 : Math.PI);
      an.weed =
        clumps.find(
          (c) =>
            Math.hypot(c.w.x - p.x, c.w.y - p.y) < c.reach * 0.7 &&
            c.w.kind !== "rockweed",
        ) ?? null;
      animals.push(an);
    });
    // Bigger animals first, so a snail on a star sits on top.
    animals.sort((a, b) => b.len - a.len);
    if (water) water.setDepth(art.depth);
    else art.tint ??= waterTint(art.depth);
    focus = null;
    paintThree();
    say(beachLine());
    if (view.phone)
      view.ox = clamp(FW / 2 - view.W / view.s / 2, 0, FW - view.W / view.s);
    underDirty = true;
    kick();
    // Have the next beach ready before anyone asks for it.
    const next = nextBeach();
    (
      window.requestIdleCallback ??
      ((f: () => void) => window.setTimeout(f, 1200))
    )(() => void loadBeach(next).catch(() => undefined));
  }

  function nextBeach(): BeachId {
    const order = BEACHES.map((b) => b.id);
    return order[(order.indexOf(beachId) + 1) % order.length];
  }

  function makeClump(w: Weed): WeedClump {
    const R = seeded(w.seed);
    const blades: Blade[] = [];
    const flow = Math.PI / 2; // down the channel, toward the sea
    let reach = 200;
    if (w.kind === "surfgrass") {
      // A tuft: narrow blades from one patch, streaming with the surge.
      for (let i = 0; i < 16; i++)
        blades.push({
          tex: "surfgrass",
          len: 260 + R() * 260,
          w: 7 + R() * 3,
          ang: flow + (R() - 0.5) * 0.5,
          curl: (R() - 0.5) * 0.002,
          phase: R() * 6,
          dx: (R() - 0.5) * 36,
          dy: (R() - 0.5) * 20,
        });
      reach = 380;
    } else if (w.kind === "kelp") {
      for (let i = 0; i < 3; i++)
        blades.push({
          tex: "kelp",
          len: 360 + R() * 300,
          w: 64 + R() * 30,
          ang: flow + (R() - 0.5) * 0.7,
          curl: (R() - 0.5) * 0.0015,
          phase: R() * 6,
          dx: (R() - 0.5) * 24,
          dy: (R() - 0.5) * 24,
        });
      reach = 460;
    } else if (w.kind === "sea-lettuce") {
      for (let i = 0; i < 2; i++)
        blades.push({
          tex: "sea-lettuce",
          len: 120 + R() * 70,
          w: 0,
          ang: R() * Math.PI * 2,
          curl: 0,
          phase: R() * 6,
          dx: (R() - 0.5) * 60,
          dy: (R() - 0.5) * 60,
          sheet: Math.floor(R() * 3),
        });
      reach = 170;
    } else {
      // Rockweed lies over the bench edge, every frond hanging toward the water.
      const toward = w.toward ?? 0;
      for (let i = 0; i < 9; i++)
        blades.push({
          tex: "rockweed",
          len: 110 + R() * 90,
          w: 20 + R() * 6,
          ang: toward + (R() - 0.5) * 0.8,
          curl: (R() - 0.5) * 0.006,
          phase: R() * 6,
          dx: (R() - 0.5) * 70,
          dy: (R() - 0.5) * 70,
        });
      reach = 200;
    }
    return { w, blades, part: 0, partGoal: 0, partUntil: 0, partDir: 0, reach };
  }

  // ------------------------------------------------------------ bake
  /**
   * An animal at its angle and the view's scale, lit by the scene's sun from
   * its height map, with a soft shadow of its outline. Redone on resize.
   */
  function bake(a: Animal): void {
    const k = view.s * view.dpr;
    const meta = ANIMALS[a.sp.id];
    const im = a.art.img;
    const iw = im.naturalWidth;
    const ih = im.naturalHeight;
    const box = meta?.box ?? [0, 0, 1, 1];
    const bw = (box[2] - box[0]) * iw;
    const bh = (box[3] - box[1]) * ih;
    const sa = a.len / Math.max(bw, bh); // field px per art px
    const cx = ((box[0] + box[2]) / 2) * iw;
    const cy = ((box[1] + box[3]) / 2) * ih;
    const reach =
      Math.max(
        Math.hypot(cx, cy),
        Math.hypot(iw - cx, cy),
        Math.hypot(cx, ih - cy),
        Math.hypot(iw - cx, ih - cy),
      ) * sa;
    const size = Math.max(4, Math.ceil(reach * 2 * k) + 4);
    const draw = (src: CanvasImageSource, c: CanvasRenderingContext2D) => {
      c.setTransform(1, 0, 0, 1, size / 2, size / 2);
      c.rotate(a.p.rot);
      c.scale(sa * k, sa * k);
      c.drawImage(src, -cx, -cy);
    };
    const col = document.createElement("canvas");
    col.width = col.height = size;
    const cc = col.getContext("2d", { willReadFrequently: true })!;
    draw(im, cc);
    const hc = document.createElement("canvas");
    hc.width = hc.height = size;
    const hx = hc.getContext("2d", { willReadFrequently: true })!;
    draw(a.art.hmap, hx);
    const cd = cc.getImageData(0, 0, size, size);
    const hd = hx.getImageData(0, 0, size, size).data;
    const px = cd.data;
    // Height in device px: how tall the animal is, at this scale.
    const tall = THICK[a.sp.category] * (cur?.data.pxcm ?? 20) * k;
    const gloss = GLOSS[a.sp.category] ?? 0.2;
    const hv = [LX, LY, LZ + 1];
    const hl = Math.hypot(hv[0], hv[1], hv[2]);
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = (y * size + x) * 4;
        if (px[i + 3] === 0) continue;
        const gx = ((hd[i + 4] - hd[i - 4]) / 510) * tall;
        const gy = ((hd[i + size * 4] - hd[i - size * 4]) / 510) * tall;
        const nl = Math.hypot(gx, gy, 1);
        const nx = -gx / nl;
        const ny = -gy / nl;
        const nz = 1 / nl;
        const lam = Math.max(0, nx * LX + ny * LY + nz * LZ);
        // The photo has its own light already, so this only leans it toward
        // the scene's sun.
        const f = clamp(0.82 + 0.22 * (lam / LZ), 0.78, 1.12);
        const sp =
          Math.pow(
            Math.max(0, (nx * hv[0] + ny * hv[1] + nz * hv[2]) / hl),
            60,
          ) *
          gloss *
          120;
        px[i] = Math.min(255, px[i] * f + sp);
        px[i + 1] = Math.min(255, px[i + 1] * f + sp);
        px[i + 2] = Math.min(255, px[i + 2] * f + sp * 0.95);
      }
    }
    cc.putImageData(cd, 0, 0);
    a.baked = col;
    a.shade = softShadow(col, size, size, Math.max(3, Math.round(size / 40)));
    a.bakedK = k;
    a.half = size / 2 / k;
  }

  // ------------------------------------------------------------ drawing
  function drawAnimal(c: CanvasRenderingContext2D, a: Animal, k: number): void {
    if (!a.baked || a.bakedK !== view.s * view.dpr) bake(a);
    const x = a.p.x + a.dx;
    const y = a.p.y + a.dy;
    const h = a.half;
    const tall = THICK[a.sp.category] * (cur?.data.pxcm ?? 20);
    // Its shadow on what it's resting on: softer and lighter under water.
    const off = tall * (a.wet ? 0.35 : 0.55) * (a.run && !a.run.back ? 1.1 : 1);
    // Where it touches: a tight dark edge all round, so it sits down.
    c.globalAlpha = a.wet ? 0.3 : 0.5;
    const g = 1.04;
    c.drawImage(
      a.shade!,
      (x - h * g + 1.5 - view.ox) * k,
      (y - h * g + 2 - view.oy) * k,
      h * 2 * g * k,
      h * 2 * g * k,
    );
    // The shadow the sun casts.
    c.globalAlpha = a.wet ? 0.2 : 0.34;
    c.drawImage(
      a.shade!,
      (x - h + off * SHX - view.ox) * k,
      (y - h + off * SHY - view.oy) * k,
      h * 2 * k,
      h * 2 * k,
    );
    c.globalAlpha = 1;
    if (a.open < 1 || (a.react && a.sp.category !== "anemone")) {
      const s = 0.62 + 0.38 * a.open;
      const wig =
        a.react && /eel|sculpin/.test(a.sp.category)
          ? Math.sin((performance.now() - a.react.t0) / 45) *
            0.08 *
            Math.max(0, 1 - (performance.now() - a.react.t0) / 1400)
          : 0;
      c.save();
      c.translate((x - view.ox) * k, (y - view.oy) * k);
      c.rotate(wig);
      c.scale(s, s);
      c.drawImage(a.baked!, -h * k, -h * k, h * 2 * k, h * 2 * k);
      c.restore();
    } else {
      c.drawImage(
        a.baked!,
        (x - h - view.ox) * k,
        (y - h - view.oy) * k,
        h * 2 * k,
        h * 2 * k,
      );
    }
  }

  function drawWeeds(c: CanvasRenderingContext2D, k: number, t: number): void {
    if (!weeds) return;
    const still = reduced();
    for (const cl of clumps) {
      const wx = cl.w.x;
      const wy = cl.w.y;
      for (const b of cl.blades) {
        const tex =
          weeds[b.sheet !== undefined ? `sea-lettuce-${b.sheet}` : b.tex];
        if (!tex) continue;
        const surge = still
          ? 0
          : Math.sin(t * 0.7 + b.phase * 0.3 + wy * 0.002);
        if (b.sheet !== undefined) {
          const px =
            wx + b.dx + Math.cos(cl.partDir) * cl.part * 160 + surge * 6;
          const py =
            wy + b.dy + Math.sin(cl.partDir) * cl.part * 160 + surge * 10;
          c.save();
          c.translate((px - view.ox) * k, (py - view.oy) * k);
          c.rotate(b.ang + surge * 0.05);
          c.globalAlpha = 0.92;
          const s = (b.len * k) / tex.naturalWidth;
          c.scale(s * (1 + 0.03 * surge), s);
          c.drawImage(tex, -tex.naturalWidth / 2, -tex.naturalHeight / 2);
          c.restore();
          c.globalAlpha = 1;
          continue;
        }
        // A blade: a strip of its texture bent along its path, slice by slice.
        const n = 14;
        const seg = b.len / n;
        let x = wx + b.dx;
        let y = wy + b.dy;
        let ang = b.ang;
        const dry = cl.w.kind === "rockweed";
        const sway = dry ? 0 : surge * 0.035;
        // Parted: bent away from where it was brushed.
        const push = cl.part * (dry ? 0.5 : 1.2);
        let d = cl.partDir - ang;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const tw = tex.naturalWidth;
        const th = tex.naturalHeight / n;
        for (let i = 0; i < n; i++) {
          ang += b.curl * seg + sway + (push * d * 0.9) / n;
          const nx = x + Math.cos(ang) * seg;
          const ny = y + Math.sin(ang) * seg;
          c.setTransform(1, 0, 0, 1, (x - view.ox) * k, (y - view.oy) * k);
          c.rotate(ang - Math.PI / 2);
          c.drawImage(
            tex,
            0,
            i * th,
            tw,
            th,
            (-b.w / 2) * k,
            0,
            b.w * k,
            (seg + 1.5) * k,
          );
          x = nx;
          y = ny;
        }
        c.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
  }

  /** The beach, and everything that lies on it, into the offscreen canvas. */
  function drawUnder(t: number): void {
    if (!cur) return;
    const k = view.s * view.dpr;
    const c = uctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(
      cur.base,
      view.ox,
      view.oy,
      view.W / view.s,
      view.H / view.s,
      0,
      0,
      under.width,
      under.height,
    );
    for (const a of animals) if (a.wet && !a.rock) drawAnimal(c, a, k);
    drawWeeds(c, k, t);
    for (const a of animals) if (!a.wet && !a.rock) drawAnimal(c, a, k);
    // Under rocks: only once the rock is off them.
    for (const a of animals)
      if (a.rock && a.rock.angle > 0.05) drawAnimal(c, a, k);
    if (isDark()) {
      // Evening light in dark mode, so the frame doesn't glare.
      c.globalCompositeOperation = "multiply";
      c.fillStyle = "rgb(196,200,210)";
      c.fillRect(0, 0, under.width, under.height);
      c.globalCompositeOperation = "source-over";
    }
  }

  /**
   * A rock turning over about its hinge, seen from above. Along the fall
   * (hinge at 0, the rock lying over [-2e, 0]), a slab `T` thick turned by
   * `th` shows its top face over [-2e cos th + T sin th, T sin th] and its
   * far side over [-2e cos th, -2e cos th + T sin th]; past standing, its
   * underside over [0, 2e |cos th|]. Each face is the rock's own picture
   * squashed to that span and shaded by how it faces the sun.
   */
  function drawRock(
    c: CanvasRenderingContext2D,
    r: RockState,
    k: number,
  ): void {
    const d = r.d;
    const th = r.angle;
    const ux = Math.cos(d.fall);
    const uy = Math.sin(d.fall);
    const hx = d.cx + ux * r.e;
    const hy = d.cy + uy * r.e;
    const cs = Math.cos(th);
    const sn = Math.max(0, Math.sin(th));
    const T = r.thick;
    const E = 2 * r.e;
    const bright = (nx: number, ny: number, nz: number) =>
      clamp((nx * LX + ny * LY + nz * LZ) / LZ, 0.2, 1.3);
    // Draw `img` squashed so the rock's [-E, 0] lands on [a, b] along the fall.
    const span = (
      img: CanvasImageSource,
      a0: number,
      b0: number,
      dark?: { img: CanvasImageSource; k: number },
      ox = 0,
      oy = 0,
    ) => {
      const sx = (b0 - a0) / E;
      if (Math.abs(sx) < 0.004) return;
      const one = (src: CanvasImageSource) => {
        c.save();
        c.setTransform(
          k,
          0,
          0,
          k,
          (hx + ox - view.ox) * k,
          (hy + oy - view.oy) * k,
        );
        c.rotate(d.fall);
        c.translate(b0, 0);
        c.scale(sx, 1);
        c.rotate(-d.fall);
        c.translate(-hx, -hy);
        c.drawImage(src, d.x, d.y, d.w, d.h);
        c.restore();
      };
      one(img);
      if (dark && dark.k > 0.02) {
        c.globalAlpha = dark.k;
        one(dark.img);
        c.globalAlpha = 1;
      }
    };
    const lift = r.e * 2 * sn * (th < Math.PI / 2 ? 1 : 0.5);
    // Its shadow, thrown down and right, further the higher its far edge.
    const sh = T * 0.3 + lift * 0.7;
    c.globalAlpha = 0.42;
    if (th <= Math.PI / 2)
      span(r.shadow, -E * cs, T * sn, undefined, sh * SHX, sh * SHY);
    else span(r.shadow, E * -cs + T * sn, 0, undefined, sh * SHX, sh * SHY);
    c.globalAlpha = 1;
    // The rock's side shows as its face stacked down to the ground: dark
    // copies stepping from the ground up to the face, so the band hugs the
    // rock's own outline.
    const steps =
      sn > 0.03 ? Math.min(18, 2 + Math.round((T * sn * k) / 1.5)) : 0;
    if (th <= Math.PI / 2) {
      const sideK = clamp(
        0.85 - bright(-ux * cs, -uy * cs, sn) * 0.45,
        0.35,
        0.8,
      );
      for (let i = 0; i < steps; i++) {
        const t = (T * sn * i) / steps;
        span(r.top, -E * cs + t, t, { img: r.dark.top, k: sideK });
      }
      const b = bright(ux * sn, uy * sn, cs);
      span(r.top, -E * cs + T * sn, T * sn, {
        img: r.dark.top,
        k: clamp((1 - b) * 0.7, 0, 0.6),
      });
    } else {
      const ac = -cs;
      const sideK = clamp(
        0.85 - bright(ux * ac, uy * ac, sn) * 0.45,
        0.35,
        0.8,
      );
      for (let i = steps; i > 0; i--) {
        const t = (T * sn * i) / steps;
        span(r.under, E * ac + t, t, { img: r.dark.under, k: sideK });
      }
      const b = bright(-ux * sn, -uy * sn, ac);
      // The underside comes up mirrored, as a turned-over thing does.
      span(r.under, E * ac, 0, {
        img: r.dark.under,
        k: clamp((1 - b) * 0.7, 0, 0.6),
      });
    }
  }

  function drawDrops(
    c: CanvasRenderingContext2D,
    k: number,
    now: number,
  ): void {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      const age = (now - d.t0) / 1000;
      if (age > d.fall + 0.42) {
        drops.splice(i, 1);
        continue;
      }
      const p = toScreen(d.x, d.y);
      if (age < d.fall) {
        // Falling: seen from above it shrinks toward the ground.
        const s = (1 - age / d.fall) * 0.6 + 0.6;
        c.fillStyle = d.sand ? "rgba(70,62,48,0.9)" : "rgba(225,238,240,0.85)";
        c.beginPath();
        c.arc(
          p.x * view.dpr,
          p.y * view.dpr,
          Math.max(0.8, 1.5 * s * view.dpr),
          0,
          Math.PI * 2,
        );
        c.fill();
      } else if (!d.sand) {
        const u = (age - d.fall) / 0.42;
        c.strokeStyle = `rgba(230,240,240,${0.55 * (1 - u)})`;
        c.lineWidth = view.dpr;
        c.beginPath();
        c.ellipse(
          p.x * view.dpr,
          p.y * view.dpr,
          (2 + 7 * u) * view.dpr * Math.max(0.6, k / view.dpr),
          (2 + 7 * u) * view.dpr * Math.max(0.6, k / view.dpr),
          0,
          0,
          Math.PI * 2,
        );
        c.stroke();
      }
    }
  }

  function ringAt(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
  ): void {
    const p = toScreen(x, y);
    const css = getComputedStyle(document.documentElement);
    c.save();
    c.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    c.lineWidth = 4;
    c.strokeStyle = css.getPropertyValue("--paper").trim() || "#fbfaf8";
    c.beginPath();
    c.arc(p.x, p.y, r, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 2;
    c.strokeStyle = css.getPropertyValue("--ink").trim() || "#16150f";
    c.stroke();
    c.restore();
  }

  function drawTop(now: number): void {
    const c = top!;
    const k = view.s * view.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas!.width, canvas!.height);
    if (!cur) return;
    // Rocks lying over go under the ones still down, so draw them first.
    const order = [...rocks].sort((a, b) => b.angle - a.angle);
    for (const r of order) drawRock(c, r, k);
    drawDrops(c, k, now);
    if (tide) drawTide(c, now);
    else if (now < wetUntil) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = `rgba(20,30,32,${0.18 * ((wetUntil - now) / 1400)})`;
      c.fillRect(0, 0, canvas!.width, canvas!.height);
    }
    if (focus) {
      if (focus.kind === "animal") {
        const a = focus.a;
        ringAt(
          c,
          a.p.x + a.dx,
          a.p.y + a.dy,
          Math.max(20, (a.len / 2) * view.s + 6),
        );
      } else if (focus.kind === "rock") {
        const r = focus.r;
        const [x, y] = r.angle > 1.5 ? centroid(r.landed) : [r.d.cx, r.d.cy];
        ringAt(c, x, y, Math.max(r.d.rx, r.d.ry) * view.s + 6);
      } else {
        ringAt(c, focus.c.w.x, focus.c.w.y, 40);
      }
    }
  }

  function centroid(pts: [number, number][]): [number, number] {
    let x = 0;
    let y = 0;
    for (const p of pts) {
      x += p[0];
      y += p[1];
    }
    return [x / pts.length, y / pts.length];
  }

  // The wave that brings a new beach: churned water and a foam front washing
  // down over it, the beach changing underneath, then draining away.
  let foam: HTMLCanvasElement | null = null;
  function foamTex(): HTMLCanvasElement {
    if (foam) return foam;
    const n = 256;
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const x = c.getContext("2d")!;
    const R = seeded(77);
    for (let i = 0; i < 900; i++) {
      const r = 1 + R() * 6;
      x.fillStyle = `rgba(255,255,255,${0.15 + R() * 0.5})`;
      x.beginPath();
      x.arc(R() * n, R() * n, r, 0, Math.PI * 2);
      x.fill();
    }
    foam = c;
    return c;
  }
  function drawTide(c: CanvasRenderingContext2D, now: number): void {
    if (!tide) return;
    const t = (now - tide.start) / 1000;
    const W = view.W;
    const H = view.H;
    c.save();
    c.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    const step = 8;
    const front: number[] = [];
    for (let x = 0; x <= W + step; x += step) front.push(tideFront(tide, t, x));
    const back = t >= tide.up;
    const kb = back ? clamp((t - tide.up) / tide.back, 0, 1) : 0;
    // The sheet of water behind the front.
    c.beginPath();
    c.moveTo(0, 0);
    front.forEach((y, i) => c.lineTo(i * step, Math.max(0, y)));
    c.lineTo(W + step, 0);
    c.closePath();
    c.fillStyle = `rgba(52,82,84,${0.62 * (1 - kb * 0.6)})`;
    c.fill();
    c.save();
    c.clip();
    c.globalAlpha = 0.16 * (1 - kb);
    c.fillStyle = c.createPattern(foamTex(), "repeat")!;
    c.translate(0, t * 60);
    c.fillRect(0, -t * 60, W, H + 10);
    c.restore();
    // The foam front.
    c.lineCap = "round";
    for (let pass = 0; pass < 3; pass++) {
      c.beginPath();
      front.forEach((y, i) => {
        const yy = y - pass * 5 + Math.sin(i * 1.7 + pass + t * 6) * 2;
        if (i) c.lineTo(i * step, yy);
        else c.moveTo(0, yy);
      });
      c.strokeStyle = `rgba(245,250,248,${(0.75 - pass * 0.2) * (1 - kb * 0.8)})`;
      c.lineWidth = 7 - pass * 2;
      c.stroke();
    }
    c.restore();
    if (tideDone(tide, t)) {
      tide = null;
      wetUntil = now + 1400;
    }
  }

  // ------------------------------------------------------------ the clock
  // Slow background life (crawling snails, drifting hermits, swaying weed)
  // redraws the beach about ten times a second, not every frame.
  let ambientAt = 0;
  function step(now: number): boolean {
    const t = (now - t0) / 1000;
    let moving = false;
    const red = reduced();
    const ambient = now - ambientAt > (clumps.length ? 50 : 100);
    if (ambient) ambientAt = now;
    for (const r of rocks) {
      const age = (now - r.t0) / 1000 / slow;
      const prev = r.angle;
      if (r.mode === "over") {
        r.angle = red ? OVER : overAngle(age, r.from);
        if (red || age >= OVER_S) {
          r.mode = "up";
          r.angle = OVER;
        }
      } else if (r.mode === "back") {
        r.angle = red ? 0 : backAngle(age, r.from);
        if (red || age >= BACK_S) {
          r.mode = "rest";
          r.angle = 0;
        }
      } else if (r.mode === "heave") {
        const a = heaveAngle(age, r.peak);
        r.angle = red
          ? 0
          : r.from > 0 && age < HEAVE_S * 0.3
            ? r.from + (a - r.from) * ease(age / (HEAVE_S * 0.3))
            : a;
        if (red || age >= HEAVE_S) {
          r.mode = "rest";
          r.angle = 0;
          r.heaveAt = now;
        }
      }
      if (r.angle !== prev) {
        moving = true;
        underDirty = true;
        // Light gets under it: the animals react.
        if (r.angle > 0.9 && prev <= 0.9 && r.mode === "over") {
          r.lit = now;
          for (const a of animals) if (a.rock === r) startReact(a, now);
        }
        // Water and sand drip off the edge coming up.
        if (
          !red &&
          r.angle > 0.15 &&
          r.angle < 1.6 &&
          r.angle > prev &&
          Math.random() < 0.5
        ) {
          const len = r.e * 2 * Math.cos(Math.min(r.angle, 1.5));
          const ux = Math.cos(r.d.fall);
          const uy = Math.sin(r.d.fall);
          const across =
            (Math.random() - 0.5) *
            1.6 *
            (Math.abs(ux) > 0.5 ? r.d.ry : r.d.rx);
          drops.push({
            x:
              r.d.cx +
              ux * (r.e - len - r.thick * Math.sin(r.angle)) -
              uy * across,
            y:
              r.d.cy +
              uy * (r.e - len - r.thick * Math.sin(r.angle)) +
              ux * across,
            t0: now,
            fall: 0.12 + Math.random() * 0.18,
            sand: beachId === "sand" && Math.random() < 0.6,
          });
        }
      }
    }
    if (drops.length) moving = true;
    for (const a of animals) {
      if (a.react) {
        const age = (now - a.react.t0) / 1000;
        const kind = reactionFor(a.sp.category);
        if (kind === "clench") a.open = critterReact("clench", age, 1, 0).open;
        if (age > reactionLength(kind) + 1.2) a.react = null;
        moving = true;
        if (a.wet || a.rock) underDirty = true;
      }
      if (a.run) {
        const age = (now - a.run.t0) / 1000;
        const k = red ? 1 : ease(clamp(age / (a.run.back ? 0.25 : 0.38), 0, 1));
        const tx = a.run.back ? 0 : a.run.x;
        const ty = a.run.back ? 0 : a.run.y;
        a.dx = a.dx + (tx - a.dx) * k;
        a.dy = a.dy + (ty - a.dy) * k;
        if (k >= 1) {
          if (a.run.back) a.run = null;
        } else moving = true;
        underDirty = true;
      }
      if (!red && !a.rock && !a.react && !a.run) {
        const cat = a.sp.category;
        if (
          cat === "hermit" ||
          cat === "snail" ||
          cat === "nudibranch" ||
          cat === "shrimp"
        ) {
          moving = true;
          if (ambient) {
            if (cat === "hermit") {
              a.dx = Math.sin(t * 0.09 + a.phase) * 28;
              a.dy = Math.cos(t * 0.07 + a.phase * 1.3) * 18;
            } else if (cat === "shrimp") {
              a.dx = Math.sin(t * 0.5 + a.phase) * 6;
              a.dy = Math.sin(t * 1.7 + a.phase) * 3;
            } else a.dx = Math.sin(t * 0.02 + a.phase) * 8;
            underDirty = true;
          }
        }
      }
    }
    for (const cl of clumps) {
      if (cl.partUntil && now > cl.partUntil) {
        cl.partGoal = 0;
        cl.partUntil = 0;
      }
      if (Math.abs(cl.part - cl.partGoal) > 0.002) {
        cl.part += (cl.partGoal - cl.part) * (red ? 1 : 0.12);
        moving = true;
      }
    }
    if (clumps.length && !red) {
      moving = true;
      if (ambient) underDirty = true;
    }
    for (let i = rings.length - 1; i >= 0; i--)
      if (now - rings[i].at > 2200) rings.splice(i, 1);
    if (tide) {
      moving = true;
      // The water covers the frame: it waits there until the next beach is in.
      if (!tide.swapped && (now - tide.start) / 1000 > tide.up)
        tide.start = now - tide.up * 1000;
    }
    if (now < wetUntil) moving = true;
    return moving;
  }

  function startReact(a: Animal, now: number): void {
    const kind = reactionFor(a.sp.category);
    if (kind === "still" && a.sp.category !== "anemone") return;
    a.react = { t0: now, dir: Math.random() < 0.5 ? 1 : -1, ang: 0 };
    if (a.rock && (kind === "scuttle" || kind === "dart" || kind === "flick")) {
      // Off toward the shade of the rock lying beside it.
      const r = a.rock;
      const [lx, ly] = centroid(r.landed);
      const ang =
        Math.atan2(ly - a.p.y, lx - a.p.x) + (Math.random() - 0.5) * 0.9;
      const reach =
        Math.min(r.d.rx, r.d.ry) *
        (kind === "scuttle" ? 0.7 : 0.45) *
        (a.sp.category === "hermit" ? 0.5 : 1);
      a.run = {
        x: Math.cos(ang) * reach,
        y: Math.sin(ang) * reach,
        t0: now,
        back: false,
      };
    }
  }

  function frame_(now: number): void {
    raf = 0;
    const moving = step(now);
    const t = reduced() ? 0 : (now - t0) / 1000;
    if (underDirty) {
      drawUnder(t);
      if (water) water.setScene(under);
      underDirty = false;
    }
    if (cur) {
      if (water) {
        water.draw(
          { x: view.ox, y: view.oy, w: view.W / view.s, h: view.H / view.s },
          FW,
          FH,
          t,
          isDark(),
          rings,
        );
      } else if (flat) {
        flat.setTransform(1, 0, 0, 1, 0, 0);
        flat.drawImage(under, 0, 0);
        if (cur.tint) {
          flat.globalCompositeOperation = "multiply";
          const tx = cur.tint.width / FW;
          flat.drawImage(
            cur.tint,
            view.ox * tx,
            view.oy * tx,
            (view.W / view.s) * tx,
            (view.H / view.s) * tx,
            0,
            0,
            waterCanvas!.width,
            waterCanvas!.height,
          );
          flat.globalCompositeOperation = "source-over";
        }
      }
    }
    drawTop(now);
    if (view.phone && panEl) {
      const vis = view.W / view.s;
      panEl.style.left = `${(100 * view.ox) / FW}%`;
      panEl.style.width = `${(100 * vis) / FW}%`;
    }
    const waterMoves = !!water && !reduced() && cur !== null && hasWater();
    if (running && (moving || waterMoves)) raf = requestAnimationFrame(frame_);
  }
  let waterKnown: { id: BeachId; has: boolean } | null = null;
  function hasWater(): boolean {
    if (!cur) return false;
    if (waterKnown?.id !== beachId) {
      let has = false;
      for (let i = 0; i < cur.labels.length; i += 7)
        if (
          cur.data.labels[cur.labels[i]] === "water" ||
          cur.data.labels[cur.labels[i]] === "coralline"
        ) {
          has = true;
          break;
        }
      waterKnown = { id: beachId, has };
    }
    return waterKnown.has;
  }
  function kick(): void {
    if (!raf && running) raf = requestAnimationFrame(frame_);
    else if (!running && !raf) raf = requestAnimationFrame(frame_);
  }
  function start(): void {
    if (running) return;
    running = true;
    kick();
  }
  function stop(): void {
    running = false;
  }

  // ------------------------------------------------------------ hit tests
  function animalAt(x: number, y: number): Animal | null {
    const seen = animals.filter(
      (a) => (!a.rock || a.rock.angle > 2.4) && !(a.weed && a.weed.part < 0.5),
    );
    for (let i = seen.length - 1; i >= 0; i--) {
      const a = seen[i];
      if (!a.baked) continue;
      const k = a.bakedK;
      const lx = (x - (a.p.x + a.dx) + a.half) * k;
      const ly = (y - (a.p.y + a.dy) + a.half) * k;
      if (lx < 0 || ly < 0 || lx >= a.baked.width || ly >= a.baked.height)
        continue;
      const alpha = a.baked
        .getContext("2d", { willReadFrequently: true })!
        .getImageData(lx | 0, ly | 0, 1, 1).data[3];
      if (alpha > 60) return a;
    }
    // Small ones: the nearest within a fingertip.
    let best: Animal | null = null;
    let bd = 24 / view.s;
    for (const a of seen) {
      const d = Math.hypot(x - a.p.x - a.dx, y - a.p.y - a.dy) - a.len * 0.35;
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }
  function rockAt(x: number, y: number): RockState | null {
    for (const r of [...rocks].sort((a, b) => a.angle - b.angle)) {
      if (r.angle < 1.5 && inside(r.d.pts, x, y)) return r;
      if (r.angle >= 1.5 && inside(r.landed, x, y)) return r;
    }
    return null;
  }
  function clumpAt(x: number, y: number): WeedClump | null {
    let best: WeedClump | null = null;
    let bd = Infinity;
    for (const c of clumps) {
      // A clump covers the water downstream of where it's anchored.
      const dx = x - c.w.x;
      const dy = y - c.w.y;
      const along = dy;
      const acrossK = Math.abs(dx) / (c.reach * 0.45);
      const alongK =
        c.w.kind === "sea-lettuce" || c.w.kind === "rockweed"
          ? Math.hypot(dx, dy) / c.reach
          : along < -60
            ? 9
            : along / c.reach;
      const d =
        c.w.kind === "sea-lettuce" || c.w.kind === "rockweed"
          ? alongK
          : Math.max(acrossK, alongK);
      if (d < 0.85 && d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }
  function labelAt(x: number, y: number): string {
    if (!cur) return "rock";
    const lx = clamp(Math.round((x / FW) * cur.labW), 0, cur.labW - 1);
    const ly = clamp(Math.round((y / FH) * cur.labH), 0, cur.labH - 1);
    return cur.data.labels[cur.labels[ly * cur.labW + lx]] ?? "rock";
  }

  // ------------------------------------------------------------ actions
  function busy(): boolean {
    return !!tide || card!.classList.contains("is-open");
  }

  function turn(r: RockState): void {
    const now = performance.now();
    if (r.mode === "over" || r.mode === "back") return;
    if (r.mode === "up") {
      r.mode = "back";
      r.t0 = now;
      r.from = r.angle;
      // Whoever ran out goes back under first.
      for (const a of animals)
        if (a.rock === r && a.run) a.run = { ...a.run, back: true, t0: now };
      const left = rocks.filter((o) => o !== r && o.mode === "up").length;
      say(
        left
          ? "Back the way you found it."
          : "Every rock back the way you found it.",
      );
    } else if (r.d.heavy > 1) {
      if (r.mode === "rest" && now - r.heaveAt > 6000) r.heaves = 0;
      r.heaves++;
      if (r.heaves >= r.d.heavy) {
        r.mode = "over";
        r.from = r.angle;
        r.t0 = now;
        say(foundLine(r, "Over it goes."));
      } else {
        r.mode = "heave";
        r.from = r.angle;
        r.peak = heavePeak(r.heaves - 1, r.d.heavy);
        r.t0 = now;
        say(
          r.heaves === 1
            ? "It's heavy. It comes up a little and slips back. Heave again."
            : "Nearly. One more.",
        );
      }
    } else {
      r.mode = "over";
      r.from = 0;
      r.t0 = now;
      say(foundLine(r, ""));
    }
    if (live) live.textContent = sayEl?.textContent ?? "";
    underDirty = true;
    kick();
  }

  function foundLine(r: RockState, lead: string): string {
    const n = animals.filter((a) => a.rock === r).length;
    const under =
      beachId === "sand" ? "a damp hollow in the sand" : "damp gravel";
    const body =
      n === 0
        ? `Nothing under this one, just ${under}.`
        : n === 1
          ? "Something under it."
          : "A few things under it.";
    return `${lead ? lead + " " : ""}${body} Tap it again to put it back.`;
  }

  function brush(c: WeedClump, x: number, y: number): void {
    c.partDir = Math.atan2(c.w.y - y, c.w.x - x) + Math.PI;
    if (c.w.kind === "sea-lettuce")
      c.partDir = Math.atan2(c.w.y - y, c.w.x - x);
    c.partGoal = 1;
    c.partUntil = performance.now() + 9000;
    const hidden = animals.filter((a) => a.weed === c).length;
    const name = OTHER_LIFE[c.w.kind]?.common ?? "seaweed";
    say(
      hidden
        ? `You brush the ${name.toLowerCase()} aside. Something's under it.`
        : `You brush the ${name.toLowerCase()} aside. Nothing under this patch.`,
    );
    kick();
  }

  function tap(cx: number, cy: number): void {
    if (busy() || !cur) return;
    const { x, y } = toField(cx, cy);
    const r = rockAt(x, y);
    const a = animalAt(x, y);
    if (a && (!r || r.angle < 1.5 || a.rock === r)) return find(a);
    if (r) return turn(r);
    const cl = clumpAt(x, y);
    if (cl && cl.part < 0.5) return brush(cl, x, y);
    const lab = labelAt(x, y);
    if (lab === "water" || lab === "coralline")
      rings.push({ x, y, at: performance.now(), strength: 1 });
    if (LABEL_SPECIES.has(lab)) return findLabel(lab, x, y);
    if (OTHER_LIFE[lab]) return other(lab, x, y);
    if (cl) return other(cl.w.kind, x, y);
    say(GROUND_SAYS[lab] ?? "Bare rock.");
    kick();
  }

  // ------------------------------------------------------------ finds
  function snapshot(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = canvas!.width;
    c.height = canvas!.height;
    const x = c.getContext("2d")!;
    x.drawImage(waterCanvas!, 0, 0);
    x.drawImage(canvas!, 0, 0);
    return c;
  }
  function frameRect(): Box {
    const b = canvas!.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  }
  function crop(
    scene: HTMLCanvasElement,
    x: number,
    y: number,
    rField: number,
  ): HTMLCanvasElement {
    const p = toScreen(x, y);
    const r = rField * view.s * view.dpr;
    const c = document.createElement("canvas");
    c.width = c.height = Math.max(8, Math.round(r * 2));
    c.getContext("2d")!.drawImage(
      scene,
      p.x * view.dpr - r,
      p.y * view.dpr - r,
      r * 2,
      r * 2,
      0,
      0,
      c.width,
      c.height,
    );
    return c;
  }

  function find(a: Animal): void {
    if (a.sp.category === "anemone" && !reduced()) {
      a.react = { t0: performance.now(), dir: 1, ang: 0 };
      kick();
    }
    const p = toScreen(a.p.x + a.dx, a.p.y + a.dy);
    const fr = frameRect();
    const vis = Math.max(16, a.len * view.s);
    const rect = {
      x: fr.x + p.x - vis / 2,
      y: fr.y + p.y - vis / 2,
      w: vis,
      h: vis,
    };
    const where = a.rock
      ? "Under a rock."
      : a.wet
        ? "In the water."
        : "Out on the rock.";
    open(a.sp, { a, rect, sprite: a.baked, where });
  }
  function findLabel(id: string, x: number, y: number): void {
    const sp = BY_ID.get(id);
    if (!sp) return;
    const scene = snapshot();
    const r = 60;
    const p = toScreen(x, y);
    const fr = frameRect();
    const vis = r * 2 * view.s;
    open(sp, {
      a: null,
      rect: {
        x: fr.x + p.x - vis / 2,
        y: fr.y + p.y - vis / 2,
        w: vis,
        h: vis,
      },
      sprite: crop(scene, x, y, r),
      where: "Part of the rock here.",
    });
  }

  function open(
    sp: TidepoolSpecies,
    o: {
      a: Animal | null;
      rect: Box;
      sprite: HTMLCanvasElement | null;
      where: string;
    },
  ): void {
    const isNew = !discovered.has(sp.id);
    if (isNew) {
      discovered.add(sp.id);
      save();
      if (reduced()) journal.show(discovered.size);
    }
    if (three.includes(sp.id) && !foundToday.has(sp.id)) {
      foundToday.add(sp.id);
      saveToday();
      paintThree(sp.id);
    }
    if (lastEl) lastEl.textContent = `Last find: ${sp.common}`;
    const override = PHOTOS[sp.id];
    const photo = sp.photo ?? override?.photo ?? "";
    const credit = sp.photoCredit ?? override?.credit ?? "";
    nameEl!.textContent = sp.common;
    sciEl!.textContent = sp.scientific;
    factEl!.textContent = sp.facts[Math.floor(Math.random() * sp.facts.length)];
    badgeEl!.textContent = isNew ? "New to your journal" : "Found again";
    if (creditEl) {
      creditEl.textContent = credit;
      creditEl.classList.toggle("is-hidden", !credit);
    }
    if (markEl) stampFind(markEl, badgeEl!, isNew);
    revealCanvas!.classList.add("is-hidden");
    photoEl!.classList.add("is-hidden");
    photoEl!.alt = sp.common;
    const loaded = new Promise<void>((res, rej) => {
      if (!photo) return rej(new Error("no photo"));
      photoEl!.onload = () => res();
      photoEl!.onerror = () => rej(new Error(photo));
      if (
        photoEl!.getAttribute("src") === photo &&
        photoEl!.complete &&
        photoEl!.naturalWidth
      )
        res();
      else photoEl!.src = photo;
    });
    upgradePhoto(photoEl!, photo);
    cardFind = { a: o.a, sp, isNew, from: o.rect, sprite: o.sprite };
    openCard();
    const scene = snapshot();
    playReveal({
      card: specimen,
      pic,
      img: photoEl!,
      photo: loaded,
      from: o.sprite
        ? {
            rect: o.rect,
            sprite: o.sprite,
            scene: { canvas: scene, rect: frameRect() },
          }
        : null,
      style: revealStyle(),
      reduced: reduced(),
      onFail: () => standIn(o.sprite),
    });
    if (live) live.textContent = `${sp.common}. ${o.where}`;
  }

  function standIn(sprite: HTMLCanvasElement | null): void {
    const c = revealCanvas!;
    const r = pic.getBoundingClientRect();
    c.width = Math.round(r.width * view.dpr);
    c.height = Math.round(r.height * view.dpr);
    const x = c.getContext("2d")!;
    x.fillStyle = "#2b2a26";
    x.fillRect(0, 0, c.width, c.height);
    if (sprite) {
      const s =
        Math.min(c.width / sprite.width, c.height / sprite.height) * 0.8;
      x.drawImage(
        sprite,
        (c.width - sprite.width * s) / 2,
        (c.height - sprite.height * s) / 2,
        sprite.width * s,
        sprite.height * s,
      );
    }
    c.classList.remove("is-hidden");
    c.style.imageRendering = "auto";
    if (creditEl) creditEl.classList.add("is-hidden");
  }

  function other(kind: string, x: number, y: number): void {
    const o = OTHER_LIFE[kind];
    if (!o) return;
    const scene = snapshot();
    const shot = crop(scene, x, y, 110);
    const big = document.createElement("canvas");
    big.width = 800;
    big.height = 600;
    big
      .getContext("2d")!
      .drawImage(
        shot,
        0,
        shot.height * 0.125,
        shot.width,
        shot.height * 0.75,
        0,
        0,
        800,
        600,
      );
    nameEl!.textContent = o.common;
    sciEl!.textContent = o.scientific;
    factEl!.textContent = o.fact;
    badgeEl!.textContent = "Other life";
    badgeEl!.classList.remove("is-stamped");
    if (markEl) markEl.innerHTML = "";
    if (creditEl) creditEl.classList.add("is-hidden");
    revealCanvas!.classList.add("is-hidden");
    photoEl!.classList.add("is-hidden");
    photoEl!.alt = o.common;
    const url = big.toDataURL("image/jpeg", 0.9);
    const loaded = new Promise<void>((res, rej) => {
      photoEl!.onload = () => res();
      photoEl!.onerror = () => rej(new Error("crop"));
      photoEl!.src = url;
    });
    upgradePhoto(photoEl!, url);
    cardFind = null;
    openCard();
    const p = toScreen(x, y);
    const fr = frameRect();
    const vis = 110 * 2 * view.s;
    playReveal({
      card: specimen,
      pic,
      img: photoEl!,
      photo: loaded,
      from: {
        rect: {
          x: fr.x + p.x - vis / 2,
          y: fr.y + p.y - vis / 2,
          w: vis,
          h: vis,
        },
        sprite: shot,
        scene: { canvas: scene, rect: fr },
      },
      style: revealStyle(),
      reduced: reduced(),
    });
  }

  // ------------------------------------------------------------ card
  let returnFocus: HTMLElement | null = null;
  function openCard(): void {
    if (!card!.classList.contains("is-open"))
      returnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
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
    if (f?.isNew && !reduced() && f.sprite && f.from) {
      const size = Math.max(28, Math.min(120, f.from.w));
      const hop = document.createElement("canvas");
      hop.width = hop.height = Math.round(size * view.dpr);
      const hx = hop.getContext("2d")!;
      const s = Math.min(
        hop.width / f.sprite.width,
        hop.height / f.sprite.height,
      );
      hx.drawImage(
        f.sprite,
        (hop.width - f.sprite.width * s) / 2,
        (hop.height - f.sprite.height * s) / 2,
        f.sprite.width * s,
        f.sprite.height * s,
      );
      journal.hop({
        sprite: { color: hop, size },
        from: { x: f.from.x + f.from.w / 2, y: f.from.y + f.from.h / 2 },
        end: Math.min(0.8, 22 / size),
      });
    } else if (f?.isNew) journal.show(discovered.size);
  }

  // ------------------------------------------------------------ today's three
  function paintThree(justFound?: string): void {
    if (!threeEl) return;
    const away = beachId !== todayId;
    const today = BEACHES.find((b) => b.id === todayId)!;
    threeEl.innerHTML =
      `<div class="tp-three-head"><span class="u-label">Today's three</span><span class="tp-three-where">${today.title}${
        away
          ? ` · <button type="button" class="linkbtn" data-tp-today><span>Go back there</span></button>`
          : ""
      }</span></div><ol class="tp-three-list">` +
      three
        .map((id) => {
          const sp = BY_ID.get(id)!;
          const got = foundToday.has(id);
          return `<li class="tp-clue${got ? " is-found" : ""}${id === justFound ? " is-new" : ""}"><span class="tp-clue-text">${clueFor(sp)}</span>${got ? `<span class="tp-clue-name">${sp.common}</span>` : ""}</li>`;
        })
        .join("") +
      "</ol>";
    threeEl
      .querySelector("[data-tp-today]")
      ?.addEventListener("click", () => newBeach(todayId, day));
    if (justFound && !reduced()) {
      const li = threeEl.querySelector<HTMLElement>(".is-new .tp-clue-name");
      li?.animate(
        [
          { opacity: 0, transform: "translateY(-4px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 260, easing: "cubic-bezier(0.2,0,0.2,1)" },
      );
    }
  }

  // ------------------------------------------------------------ new beach
  function newBeach(id?: BeachId, seed?: number): void {
    if (tide) return;
    const nextId = id ?? nextBeach();
    const nextSeed = seed ?? Math.floor(Math.random() * 1e9);
    const left = rocks.filter((r) => r.mode === "up").length;
    const leftNote = left
      ? ` You left ${left === 1 ? "a rock" : `${left} rocks`} turned over on the last beach, so whatever lived under ${left === 1 ? "it" : "them"} dries out in the sun.`
      : "";
    if (reduced()) {
      void setBeach(nextId, nextSeed).then(
        () => leftNote && say(beachLine() + leftNote),
      );
      return;
    }
    const tt = makeTide(view.W, view.H, performance.now());
    tt.top = -20;
    tt.up *= slow;
    tt.back *= slow;
    tt.dry *= slow;
    const wave = { ...tt, swapped: false };
    tide = wave;
    const ready = loadBeach(nextId);
    const swap = () => {
      if (tide !== wave) return;
      const age = (performance.now() - wave.start) / 1000;
      if (age < wave.up * 0.96) {
        window.setTimeout(swap, (wave.up * 0.96 - age) * 1000 + 10);
        return;
      }
      void setBeach(nextId, nextSeed).then(() => {
        wave.swapped = true;
        if (leftNote) say(beachLine() + leftNote);
        kick();
      });
    };
    ready.then(swap, () => {
      tide = null;
      say("The next beach didn't load. Try again in a moment.");
      kick();
    });
    kick();
  }

  // ------------------------------------------------------------ input
  let down: {
    x: number;
    y: number;
    ox: number;
    moved: boolean;
    id: number;
  } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    down = {
      x: e.clientX,
      y: e.clientY,
      ox: view.ox,
      moved: false,
      id: e.pointerId,
    };
  });
  canvas.addEventListener("pointermove", (e) => {
    const b = canvas.getBoundingClientRect();
    if (down && view.phone) {
      const dx = e.clientX - down.x;
      if (
        !down.moved &&
        Math.abs(dx) > 8 &&
        Math.abs(dx) > Math.abs(e.clientY - down.y)
      ) {
        down.moved = true;
        canvas.setPointerCapture(down.id);
        frame.classList.add("is-grab");
      }
      if (down.moved) {
        view.ox = clamp(down.ox - dx / view.s, 0, FW - view.W / view.s);
        underDirty = true;
        kick();
      }
      return;
    }
    if (e.pointerType !== "mouse" || !cur) return;
    const { x, y } = toField(e.clientX - b.left, e.clientY - b.top);
    const hit =
      animalAt(x, y) ||
      rockAt(x, y) ||
      (clumpAt(x, y)?.part ?? 1) < 0.5 ||
      LABEL_SPECIES.has(labelAt(x, y)) ||
      !!OTHER_LIFE[labelAt(x, y)];
    canvas.style.cursor = hit ? "pointer" : "default";
  });
  // Act on click, not pointerdown: the card opens over the beach, and the
  // click from the same tap would land on its scrim and close it.
  canvas.addEventListener("click", (e) => {
    const was = down;
    down = null;
    frame.classList.remove("is-grab");
    if (was?.moved) return;
    const b = canvas.getBoundingClientRect();
    tap(e.clientX - b.left, e.clientY - b.top);
  });
  canvas.addEventListener("pointercancel", () => {
    down = null;
    frame.classList.remove("is-grab");
  });

  // Keyboard: the arrows walk everything you can act on, left to right.
  function targets(): NonNullable<typeof focus>[] {
    const list: NonNullable<typeof focus>[] = [];
    for (const r of rocks) list.push({ kind: "rock", r });
    for (const a of animals)
      if ((!a.rock || a.rock.angle > 2.4) && !(a.weed && a.weed.part < 0.5))
        list.push({ kind: "animal", a });
    for (const c of clumps)
      if (c.part < 0.5 && animals.some((a) => a.weed === c))
        list.push({ kind: "weed", c });
    const xOf = (f: NonNullable<typeof focus>) =>
      f.kind === "rock"
        ? f.r.d.cx
        : f.kind === "animal"
          ? f.a.p.x + f.a.dx
          : f.c.w.x;
    return list.sort((a, b) => xOf(a) - xOf(b));
  }
  function describe(
    f: NonNullable<typeof focus>,
    i: number,
    n: number,
  ): string {
    const what =
      f.kind === "rock"
        ? f.r.mode === "up"
          ? "a rock you turned over"
          : f.r.d.heavy > 1
            ? "the big boulder"
            : "a loose rock"
        : f.kind === "weed"
          ? `a patch of ${(OTHER_LIFE[f.c.w.kind]?.common ?? "seaweed").toLowerCase()}`
          : f.a.rock
            ? "something under a rock"
            : f.a.wet
              ? "something in the water"
              : "something on the rock";
    return `${i + 1} of ${n}: ${what}`;
  }
  frame.addEventListener("keydown", (e) => {
    if (busy()) {
      if (/^(Arrow|Home|End|Enter| )/.test(e.key)) e.preventDefault();
      return;
    }
    const list = targets();
    if (!list.length) return;
    const same = (a: NonNullable<typeof focus>, b: typeof focus) =>
      !!b &&
      a.kind === b.kind &&
      (a.kind === "rock"
        ? a.r === (b as typeof a).r
        : a.kind === "animal"
          ? a.a === (b as typeof a).a
          : a.c === (b as typeof a).c);
    let i = list.findIndex((f) => same(f, focus));
    if (e.key === "ArrowRight" || e.key === "ArrowDown")
      i = Math.min(list.length - 1, i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      i = Math.max(0, i < 0 ? 0 : i - 1);
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = list.length - 1;
    else if (e.key === "Enter" || e.key === " ") {
      const f = focus ?? list[0];
      e.preventDefault();
      if (f.kind === "rock") turn(f.r);
      else if (f.kind === "animal") find(f.a);
      else brush(f.c, f.c.w.x, f.c.w.y - 60);
      return;
    } else return;
    e.preventDefault();
    focus = list[i];
    if (view.phone) {
      const fx =
        focus.kind === "rock"
          ? focus.r.d.cx
          : focus.kind === "animal"
            ? focus.a.p.x
            : focus.c.w.x;
      view.ox = clamp(fx - view.W / view.s / 2, 0, FW - view.W / view.s);
      underDirty = true;
    }
    if (live) live.textContent = describe(focus, i, list.length);
    kick();
  });
  frame.addEventListener("blur", () => {
    focus = null;
    kick();
  });

  closeBtn.addEventListener("click", closeCard);
  card.addEventListener("click", (e) => {
    if (e.target === card) closeCard();
  });
  card.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      closeBtn.focus();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCard();
  });
  resetBtn?.addEventListener("click", () => newBeach());
  mountRevealSwitch($<HTMLElement>("[data-tp-reveal-switch]"));

  new ResizeObserver(() => fit()).observe(frame);
  new IntersectionObserver(
    (en) => {
      for (const x of en) onscreen = x.isIntersecting;
      if (onscreen && !document.hidden) start();
      else stop();
    },
    { threshold: 0.05 },
  ).observe(frame);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (onscreen) start();
  });
  new MutationObserver(() => {
    underDirty = true;
    kick();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  whenUncovered(() => {
    if (onscreen && !document.hidden) start();
  });

  // ------------------------------------------------------------ go
  fit();
  journal.show(discovered.size);
  const lastId = [...discovered].pop();
  const lastSp = lastId ? BY_ID.get(lastId) : undefined;
  if (lastSp && lastEl) lastEl.textContent = `Last find: ${lastSp.common}`;
  const q = new URLSearchParams(location.search).get("beach") as BeachId | null;
  const startId = q && BEACHES.some((b) => b.id === q) ? q : todayId;
  void setBeach(startId, startId === todayId ? day : day + 1).catch(() =>
    say("The beach didn't load. Try reloading the page."),
  );
  t0 = performance.now();
  start();

  // For the screenshot and tap checks.
  (window as unknown as { __tp?: unknown }).__tp = {
    state: () => ({
      beach: beachId,
      view: { ...view },
      rocks: rocks.map((r) => ({
        i: r.i,
        mode: r.mode,
        angle: r.angle,
        cx: r.d.cx,
        cy: r.d.cy,
        heavy: r.d.heavy,
      })),
      animals: animals.map((a) => ({
        id: a.p.id,
        on: a.p.on,
        rock: a.p.rock,
        x: a.p.x + a.dx,
        y: a.p.y + a.dy,
        len: a.len,
        weed: !!a.weed,
      })),
    }),
    tapField: (x: number, y: number) => {
      const p = toScreen(x, y);
      tap(p.x, p.y);
    },
    turnAll: () =>
      rocks.forEach((r) => {
        if (r.d.heavy > 1) {
          r.mode = "up";
          r.angle = OVER;
          for (const a of animals)
            if (a.rock === r) startReact(a, performance.now());
        } else turn(r);
        underDirty = true;
        kick();
      }),
    partAll: () => clumps.forEach((c) => brush(c, c.w.x, c.w.y - 60)),
    beach: (id: BeachId) => setBeach(id, day + 3),
    newBeach: () => newBeach(),
    pan: (ox: number) => {
      view.ox = clamp(ox, 0, FW - view.W / view.s);
      underDirty = true;
      kick();
    },
  };
}
