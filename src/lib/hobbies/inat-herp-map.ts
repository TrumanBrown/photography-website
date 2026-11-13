/**
 * "My reptiles & amphibians, mapped": a real map of my iNaturalist reptile and
 * amphibian finds, the personal side of the night-drive game.
 *
 * It fetches the Reptilia and Amphibia observations from the public iNat API
 * and draws them on a canvas in the page's own ink and paper: land in the band
 * colour, borders as 1px rules, water left as paper, and the finds as a heat
 * map in flat tints of ink, darker where I found more, with hard edges like a
 * range map in a field guide. It reads the tokens off <html>, so dark mode
 * flips it the way it flips the page. Three levels:
 *   - World: every country. Tap a shaded spot to zoom in.
 *   - US states: tapping the US opens the states and a Hawaii inset; tap a
 *     state to zoom to it.
 *   - State or country: the place outlined among its neighbours, a mark for
 *     each find (a dot for a reptile, a ring for an amphibian), and a list
 *     below with each find's species, town or region and date before you
 *     click through.
 * Pinch, the wheel, the + and − buttons and a drag zoom and pan any level.
 * From the keyboard the map is one Tab stop: arrows pan, + and − zoom, 0 fits
 * it again, Enter opens what's in the ring at the middle and Escape steps back
 * out. Moves from the keys and buttons ease over 260ms, or jump with reduced
 * motion. Labels are Libre Franklin 400 (../canvas-font.ts).
 *
 * Positions are snapped to a 0.1° grid and places cut down to a town or region
 * (inat-place.ts) before anything is drawn: an unobscured observation is exact
 * to metres, and a reptile's spot, or a backyard, shouldn't be mapped.
 *
 * No map tiles and no runtime geo fetch: the boundaries are baked
 * (scripts/build-herp-geo.mjs), so the CSP doesn't change. Only the iNat API
 * and photo CDNs are contacted, and those are already allow-listed.
 *
 * Mounted by src/components/hobbies/INatHerpMap.astro via [data-herpmap] hooks.
 */
import { canvasFont, canvasFontIsReady, canvasFontReady } from "../canvas-font";
import { covered, whenUncovered } from "../covered";
import { prefersReducedMotion } from "../motion";
import geoData from "./herp-geo.json";
import { coarseCoord, coarsePlace } from "./inat-place";

const API = "https://api.inaturalist.org/v1/observations";
const PHOTO_HOSTS = [
  "https://inaturalist-open-data.s3.amazonaws.com/",
  "https://static.inaturalist.org/",
];

/** iNat place ids for US states (admin_level 10). Used to bucket US observations. */
const STATE_ID: Record<string, number> = {
  AL: 19,
  AK: 6,
  AZ: 40,
  AR: 36,
  CA: 14,
  CO: 34,
  CT: 49,
  DE: 4,
  FL: 21,
  GA: 23,
  HI: 11,
  ID: 22,
  IL: 35,
  IN: 20,
  IA: 24,
  KS: 25,
  KY: 26,
  LA: 27,
  ME: 17,
  MD: 39,
  MA: 2,
  MI: 29,
  MN: 38,
  MS: 37,
  MO: 28,
  MT: 16,
  NE: 3,
  NV: 50,
  NH: 41,
  NJ: 51,
  NM: 9,
  NY: 48,
  NC: 30,
  ND: 13,
  OH: 31,
  OK: 12,
  OR: 10,
  PA: 42,
  RI: 8,
  SC: 43,
  SD: 44,
  TN: 45,
  TX: 18,
  UT: 52,
  VT: 47,
  VA: 7,
  WA: 46,
  WV: 33,
  WI: 32,
  WY: 15,
  DC: 5,
};
const ID_STATE = new Map<number, string>(
  Object.entries(STATE_ID).map(([k, v]) => [v, k]),
);

const STATE_NAME: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "D.C.",
};

interface RegionGeo {
  name: string;
  bbox: [number, number, number, number];
  rings: [number, number][][];
}
const GEO_STATES = (geoData as unknown as { states: Record<string, RegionGeo> })
  .states;
const GEO_COUNTRIES = (
  geoData as unknown as { countries: Record<string, RegionGeo> }
).countries;

/** World frame (drops Antarctica and the empty far north for a tighter fit). */
const WORLD_BBOX: [number, number, number, number] = [-180, -56, 180, 84];
/** Contiguous-US frame for the US states view (AK/HI are inset/omitted). */
const CONUS_SKIP = new Set(["AK", "HI", "PR"]);

type Cls = "reptiles" | "amphibians";
type View = "world" | "us" | "state" | "country";

/** The page tokens the map draws in, read off <html> so it follows the theme. */
interface Palette {
  paper: string;
  band: string;
  ink: string;
  ink2: string;
  rule: string;
  /** The ink as red, green and blue, for the heat map's pixels. */
  inkRgb: [number, number, number];
  key: string;
}
function rgbOf(color: string): [number, number, number] {
  const hex = color.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  const v = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(v)) return [22, 21, 15];
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  const paper = get("--paper", "#fbfaf8");
  const band = get("--band", "#f3f0ea");
  const ink = get("--ink", "#16150f");
  const ink2 = get("--ink-2", "#706c63");
  const rule = get("--rule", "#e4e0d7");
  return {
    paper,
    band,
    ink,
    ink2,
    rule,
    inkRgb: rgbOf(ink),
    key: [paper, band, ink, ink2, rule].join(),
  };
}

interface Obs {
  id: number;
  uri: string;
  cls: Cls;
  state: string | null; // US state abbr (via place_ids)
  country: string | null; // ISO A2 (via point-in-polygon / US fallback)
  lng: number | null;
  lat: number | null;
  obscured: boolean;
  name: string;
  sci: string;
  place: string;
  date: string;
  thumb: string;
}

interface INatPhoto {
  url?: string;
}
interface INatTaxon {
  name?: string;
  preferred_common_name?: string;
}
interface INatObs {
  id: number;
  uri?: string;
  taxon?: INatTaxon | null;
  species_guess?: string | null;
  photos?: INatPhoto[];
  place_guess?: string | null;
  place_ids?: number[];
  observed_on?: string | null;
  obscured?: boolean;
  geojson?: { coordinates?: [number, number] } | null;
  location?: string | null;
}

function upgrade(url: string): string {
  return url.replace("/square.", "/small.");
}
function allowedHost(url: string): boolean {
  return PHOTO_HOSTS.some((h) => url.startsWith(h));
}

function stateOf(o: INatObs): string | null {
  for (const pid of o.place_ids ?? []) {
    const abbr = ID_STATE.get(pid);
    if (abbr) return abbr;
  }
  return null;
}

function coordsOf(o: INatObs): [number | null, number | null] {
  const c = o.geojson?.coordinates;
  if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) return [c[0], c[1]];
  if (o.location) {
    const parts = o.location.split(",").map(Number);
    if (parts.length === 2 && parts.every((v) => Number.isFinite(v)))
      return [parts[1], parts[0]]; // "lat,lng" -> [lng, lat]
  }
  return [null, null];
}

function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Which country (ISO A2) contains lon/lat, via bbox pre-filter + point-in-poly. */
function countryOf(lng: number, lat: number): string | null {
  for (const [iso, g] of Object.entries(GEO_COUNTRIES)) {
    const [minLon, minLat, maxLon, maxLat] = g.bbox;
    if (lng < minLon || lng > maxLon || lat < minLat || lat > maxLat) continue;
    for (const ring of g.rings) if (pointInRing(lng, lat, ring)) return iso;
  }
  return null;
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Projection from lon/lat to canvas x/y for a given bbox, fit with padding. */
type Project = (lon: number, lat: number) => [number, number];
function makeProjection(
  bbox: [number, number, number, number],
  w: number,
  h: number,
  pad: number,
): Project {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const geoW = (maxLon - minLon) * kx;
  const geoH = maxLat - minLat;
  const scale = Math.min((w - 2 * pad) / geoW, (h - 2 * pad) / geoH);
  const offX = (w - geoW * scale) / 2;
  const offY = (h - geoH * scale) / 2;
  return (lon, lat) => [
    offX + (lon - minLon) * kx * scale,
    offY + (maxLat - lat) * scale,
  ];
}

/** A point on the canvas, in CSS pixels. */
export interface Pt {
  x: number;
  y: number;
}

/**
 * The heat map's bands: [density at least, share of ink]. A density of 1 is
 * one find right on that spot, so a lone find makes a pale patch with a
 * slightly deeper middle, and the two darkest bands take several finds
 * stacked up.
 */
export const HEAT_BANDS: readonly (readonly [number, number])[] = [
  [0.12, 0.14],
  [0.6, 0.28],
  [1.8, 0.48],
  [4.5, 0.72],
];

/** Reused between frames: the density, then the share of ink, per pixel. */
let field = new Float32Array(0);
let shares = new Float32Array(0);

/**
 * The heat map in the page's ink. Every find adds a soft bump of density (a
 * Gaussian `sigma` px wide) on a 1px grid over `box`, and the density is cut
 * into the flat bands above, each a stronger share of ink. Edges are eased
 * just enough not to stair-step, so the patches print like a range map in a
 * field guide instead of glowing, and nothing is inked more than about two
 * sigma from a find. Returns where the grid sits and the share of ink on each
 * pixel (valid until the next call), or null when no find reaches the box.
 */
export function heatBands(
  pts: readonly Pt[],
  sigma: number,
  box: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number; ink: Float32Array } | null {
  const R = sigma * 3;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const p of pts) {
    left = Math.min(left, p.x - R);
    top = Math.min(top, p.y - R);
    right = Math.max(right, p.x + R);
    bottom = Math.max(bottom, p.y + R);
  }
  const x0 = Math.max(Math.floor(left), Math.floor(box.x));
  const y0 = Math.max(Math.floor(top), Math.floor(box.y));
  const w = Math.min(Math.ceil(right), Math.ceil(box.x + box.w)) - x0;
  const h = Math.min(Math.ceil(bottom), Math.ceil(box.y + box.h)) - y0;
  if (!(w > 0 && h > 0)) return null;
  const n = w * h;
  if (field.length < n) {
    field = new Float32Array(n);
    shares = new Float32Array(n);
  } else field.fill(0, 0, n);
  const inv = 1 / (2 * sigma * sigma);
  for (const p of pts) {
    const a0 = Math.max(0, Math.floor(p.x - R) - x0);
    const a1 = Math.min(w - 1, Math.ceil(p.x + R) - x0);
    const b0 = Math.max(0, Math.floor(p.y - R) - y0);
    const b1 = Math.min(h - 1, Math.ceil(p.y + R) - y0);
    for (let b = b0; b <= b1; b++) {
      const dy = y0 + b + 0.5 - p.y;
      for (let a = a0; a <= a1; a++) {
        const dx = x0 + a + 0.5 - p.x;
        field[b * w + a] += Math.exp(-(dx * dx + dy * dy) * inv);
      }
    }
  }
  const floor = HEAT_BANDS[0][0] * 0.9;
  for (let i = 0; i < n; i++) {
    const d = field[i];
    let ink = 0;
    if (d >= floor) {
      let below = 0;
      for (const [at, share] of HEAT_BANDS) {
        // Each band steps up across 8% either side of its threshold.
        const t = Math.min(1, Math.max(0, (d / at - 0.92) / 0.16));
        ink += (share - below) * t;
        below = share;
      }
    }
    shares[i] = ink;
  }
  return { x: x0, y: y0, w, h, ink: shares.subarray(0, n) };
}

/** Finds the map can name together: a US state, or a country. */
export interface Place {
  name: string;
  country: string;
  x: number;
  y: number;
  n: number;
}

/**
 * Labels for the heat map's patches. Places whose patches run together share
 * one label, so a label never names one corner of a patch. It's named after the
 * places that hold most of its finds, 80% or more: one place, or two
 * ("Washington and Oregon"), or the country when it takes three or more.
 * Biggest first, which is the order they're placed in.
 */
export function nameClusters(
  places: readonly Place[],
  near: number,
  countryName: (iso: string) => string,
): { name: string; x: number; y: number; n: number }[] {
  const clusters: { members: Place[]; n: number; sx: number; sy: number }[] =
    [];
  for (const p of [...places].sort((a, b) => b.n - a.n)) {
    const hit = clusters.find(
      (c) => Math.hypot(c.sx / c.n - p.x, c.sy / c.n - p.y) < near,
    );
    if (hit) {
      hit.members.push(p);
      hit.n += p.n;
      hit.sx += p.x * p.n;
      hit.sy += p.y * p.n;
    } else {
      clusters.push({ members: [p], n: p.n, sx: p.x * p.n, sy: p.y * p.n });
    }
  }
  return clusters.map((c) => {
    const most: Place[] = [];
    let held = 0;
    for (const m of c.members) {
      most.push(m);
      held += m.n;
      if (held >= c.n * 0.8) break;
    }
    const countries = new Set(most.map((m) => m.country));
    const name =
      most.length === 1
        ? most[0].name
        : most.length === 2
          ? `${most[0].name} and ${most[1].name}`
          : countries.size === 1
            ? countryName(most[0].country)
            : most[0].name;
    return { name, x: c.sx / c.n, y: c.sy / c.n, n: c.n };
  });
}

function countryName(iso: string): string {
  if (iso === "US") return "United States";
  return GEO_COUNTRIES[iso]?.name ?? iso;
}

let conus: [number, number, number, number] | null = null;
/** The contiguous US, for the states level. */
function conusBox(): [number, number, number, number] {
  if (conus) return conus;
  const box: [number, number, number, number] = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
  ];
  for (const [abbr, g] of Object.entries(GEO_STATES)) {
    if (CONUS_SKIP.has(abbr)) continue;
    box[0] = Math.min(box[0], g.bbox[0]);
    box[1] = Math.min(box[1], g.bbox[1]);
    box[2] = Math.max(box[2], g.bbox[2]);
    box[3] = Math.max(box[3], g.bbox[3]);
  }
  conus = box;
  return box;
}

type Find = { x: number; y: number; o: Obs };
type Rings = [number, number][][];

export function initHerpMap(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>("[data-herpmap-canvas]");
  const frame = root.querySelector<HTMLElement>("[data-herpmap-frame]");
  const tooltip = root.querySelector<HTMLElement>("[data-herpmap-tip]");
  const detailEl = root.querySelector<HTMLElement>("[data-herpmap-detail]");
  const statusEl = root.querySelector<HTMLElement>("[data-herpmap-status]");
  const liveEl = root.querySelector<HTMLElement>("[data-herpmap-live]");
  const backBtn = root.querySelector<HTMLButtonElement>("[data-herpmap-back]");
  const zoomInBtn = root.querySelector<HTMLButtonElement>(
    '[data-herpmap-zoom="in"]',
  );
  const zoomOutBtn = root.querySelector<HTMLButtonElement>(
    '[data-herpmap-zoom="out"]',
  );
  const toggleEls = Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-herpmap-cls]"),
  );
  const userId = root.dataset.herpmapUser;
  const limit = Math.max(
    1,
    Math.min(500, Number(root.dataset.herpmapLimit) || 300),
  );
  if (!canvas || !frame || !userId) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let all: Obs[] = [];
  let loaded = false;
  let active: Cls | "all" = "all";
  let view: View = "world";
  let selState: string | null = null;
  let selCountry: string | null = null; // ISO A2 for the country level
  let started = false;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let palette = readPalette();

  // Per-render caches for hit-testing.
  let regionPolys: { key: string; pts: Rings }[] = [];
  let pinHits: Find[] = [];
  let hiInset: { x: number; y: number; w: number; h: number } | null = null;
  /** Each find on screen at the world and US levels, keyed by its place. */
  let dotHits: { x: number; y: number; key: string }[] = [];
  /** The place under the mouse, outlined (world and US levels). */
  let hoverKey: string | null = null;
  /** Where the keyboard's ring sits; NaN puts it in the middle of the map. */
  let ringX = NaN;
  let ringY = NaN;
  /** Label boxes already drawn this frame, so labels never overlap. */
  let placed: [number, number, number, number][] = [];

  // Zoom and pan on top of each level's own fit (zoom 1), so clustered areas
  // like Puget Sound can be blown up on any device. Finds sit on a 0.1° grid,
  // so zooming past 6 would only spread the grid out.
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 6;
  const STEP = 1.6;
  let rafPending = false;

  function scheduleRender(): void {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      render();
    });
  }
  /** Wrap a base projection with the current zoom + pan. */
  function zoomedProject(base: Project): Project {
    return (lon, lat) => {
      const [x, y] = base(lon, lat);
      return [x * zoom + panX, y * zoom + panY];
    };
  }
  function clampView(z: number, x: number, y: number) {
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    return {
      z: k,
      x: Math.max(Math.min(0, W * (1 - k)), Math.min(0, x)),
      y: Math.max(Math.min(0, H * (1 - k)), Math.min(0, y)),
    };
  }
  function clampPan(): void {
    const c = clampView(zoom, panX, panY);
    zoom = c.z;
    panX = c.x;
    panY = c.y;
  }
  /** One-finger scroll on phones until zoomed in; then one finger pans the map. */
  function updateTouchAction(): void {
    canvas!.style.touchAction = zoom > 1.01 ? "none" : "pan-y";
  }

  // The buttons and keys ease the map to where it's going. The wheel, a pinch
  // and a drag move it directly, and stop any ease that's running.
  let tween = 0;
  let goal: { z: number; x: number; y: number } | null = null;
  function stopTween(): void {
    if (tween) cancelAnimationFrame(tween);
    tween = 0;
    goal = null;
  }
  /** Where the map is headed: the ease's end while one runs, so key repeats add up. */
  function heading(): { z: number; x: number; y: number } {
    return goal ?? { z: zoom, x: panX, y: panY };
  }
  function moveTo(z: number, x: number, y: number, then?: () => void): void {
    const to = clampView(z, x, y);
    stopTween();
    const settle = () => {
      zoom = to.z;
      panX = to.x;
      panY = to.y;
      updateTouchAction();
    };
    if (!W || prefersReducedMotion()) {
      settle();
      render();
      then?.();
      return;
    }
    goal = to;
    // Ease the window onto the map, its centre and its width (1 / zoom), the
    // way Narrow nature's map moves, so a zoom doesn't swing out and back.
    const from = { z: zoom, x: panX, y: panY };
    const c0x = (W / 2 - from.x) / from.z;
    const c0y = (H / 2 - from.y) / from.z;
    const c1x = (W / 2 - to.x) / to.z;
    const c1y = (H / 2 - to.y) / to.z;
    const s0 = 1 / from.z;
    const s1 = 1 / to.z;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 260);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      if (t < 1) {
        zoom = 1 / (s0 + (s1 - s0) * e);
        panX = W / 2 - (c0x + (c1x - c0x) * e) * zoom;
        panY = H / 2 - (c0y + (c1y - c0y) * e) * zoom;
        updateTouchAction();
        render();
        tween = requestAnimationFrame(step);
        return;
      }
      tween = 0;
      goal = null;
      settle();
      render();
      then?.();
    };
    tween = requestAnimationFrame(step);
  }
  function zoomAround(k: number, fx: number, fy: number, then?: () => void) {
    const t = heading();
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, t.z * k));
    const f = z / t.z;
    moveTo(z, fx - (fx - t.x) * f, fy - (fy - t.y) * f, then);
  }
  function resetZoom(): void {
    stopTween();
    zoom = 1;
    panX = 0;
    panY = 0;
    centreRing();
    updateTouchAction();
  }
  function ringAt(): [number, number] {
    return Number.isFinite(ringX) ? [ringX, ringY] : [W / 2, H / 2];
  }
  function centreRing(): void {
    ringX = NaN;
    ringY = NaN;
  }
  /** Zoom to `nz` keeping the focal point (fx, fy) fixed on screen. */
  function applyZoom(nz: number, fx: number, fy: number): void {
    stopTween();
    nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nz));
    if (Math.abs(nz - zoom) < 1e-3) return;
    const k = nz / zoom;
    panX = fx - (fx - panX) * k;
    panY = fy - (fy - panY) * k;
    zoom = nz;
    clampPan();
    updateTouchAction();
    scheduleRender();
  }

  function pool(): Obs[] {
    return active === "all" ? all : all.filter((o) => o.cls === active);
  }
  function countBy(key: (o: Obs) => string | null): Map<string, number> {
    const m = new Map<string, number>();
    for (const o of pool()) {
      const k = key(o);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }
  /** Finds per place at the world or US level, the ones a tap can open. */
  function levelCounts(): Map<string, number> {
    return view === "us" ? countBy((o) => o.state) : countBy((o) => o.country);
  }
  function placeName(key: string): string {
    return view === "us" ? (STATE_NAME[key] ?? key) : countryName(key);
  }

  function fit(): boolean {
    const cssW = canvas!.clientWidth;
    if (!cssW) return false;
    const cssH = Math.max(300, Math.min(520, Math.round(cssW * 0.6)));
    canvas!.style.height = `${cssH}px`;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas!.width = Math.round(cssW * dpr);
    canvas!.height = Math.round(cssH * dpr);
    W = cssW;
    H = cssH;
    return true;
  }

  // ------------------------------------------------------------- drawing
  function trace(rings: Rings): void {
    ctx!.beginPath();
    for (const ring of rings) {
      ring.forEach(([x, y], i) => {
        if (i === 0) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
      });
      ctx!.closePath();
    }
  }
  /** A place's outline on screen, or null when it's off the canvas. */
  function onScreen(g: RegionGeo, project: Project): Rings | null {
    const [x0, y0] = project(g.bbox[0], g.bbox[3]);
    const [x1, y1] = project(g.bbox[2], g.bbox[1]);
    if (x1 < 0 || x0 > W || y1 < 0 || y0 > H) return null;
    return g.rings.map((ring) => ring.map(([lon, lat]) => project(lon, lat)));
  }
  /** Land in the band colour with a 1px rule for its edge. */
  function drawLand(g: RegionGeo, project: Project): Rings | null {
    const rings = onScreen(g, project);
    if (!rings) return null;
    trace(rings);
    ctx!.fillStyle = palette.band;
    ctx!.fill();
    ctx!.strokeStyle = palette.rule;
    ctx!.lineWidth = 1;
    ctx!.stroke();
    return rings;
  }
  /** The place a level is about, or the one under the mouse, ruled in ink-2. */
  function outline(rings: Rings): void {
    trace(rings);
    ctx!.strokeStyle = palette.ink2;
    ctx!.lineWidth = 1;
    ctx!.stroke();
  }
  // The heat map's pixels go on a canvas of their own, then onto the map. It's
  // worked out at the screen's own pixels, so the band edges stay crisp on a
  // phone instead of going soft (and glowing) when scaled up.
  const heat = document.createElement("canvas");
  const hctx = heat.getContext("2d");
  function drawHeat(
    pts: readonly Pt[],
    sigma: number,
    box = { x: 0, y: 0, w: W, h: H },
  ): void {
    if (!hctx || !pts.length) return;
    const k = dpr;
    const bands = heatBands(
      pts.map((p) => ({ x: p.x * k, y: p.y * k })),
      sigma * k,
      { x: box.x * k, y: box.y * k, w: box.w * k, h: box.h * k },
    );
    if (!bands) return;
    if (heat.width < bands.w) heat.width = bands.w;
    if (heat.height < bands.h) heat.height = bands.h;
    const img = hctx.createImageData(bands.w, bands.h);
    const [r, g, b] = palette.inkRgb;
    for (let i = 0; i < bands.ink.length; i++) {
      const a = bands.ink[i];
      if (!a) continue;
      const j = i * 4;
      img.data[j] = r;
      img.data[j + 1] = g;
      img.data[j + 2] = b;
      img.data[j + 3] = Math.round(a * 255);
    }
    hctx.putImageData(img, 0, 0);
    ctx!.drawImage(
      heat,
      0,
      0,
      bands.w,
      bands.h,
      bands.x / k,
      bands.y / k,
      bands.w / k,
      bands.h / k,
    );
  }
  /** How far each find's ink spreads, in CSS px, at each level. */
  function sigmaFor(level: "world" | "us" | "place"): number {
    if (level === "world") return Math.max(2.4, Math.min(4.6, W * 0.0038));
    if (level === "us") return Math.max(2.4, Math.min(6, W * 0.0052));
    return Math.max(4, Math.min(7.5, W * 0.0064));
  }
  function projected(project: Project, keep: (o: Obs) => boolean): Find[] {
    const out: Find[] = [];
    for (const o of pool()) {
      if (o.lng == null || o.lat == null || !keep(o)) continue;
      const [x, y] = project(o.lng, o.lat);
      out.push({ x, y, o });
    }
    return out;
  }

  /** Where a label could go, given its width: the left end of its baseline. */
  type Spot = (w: number) => [number, number];
  const at =
    (x: number, y: number): Spot =>
    () => [x, y];
  /**
   * A label on a rim of paper, so it reads over the heat and the rules. Caps
   * are the site's .u-label: 10px, tracked, upper case. It takes the first of
   * `spots` that fits on the canvas without covering a label already down,
   * or stays out.
   */
  function label(text: string, spots: Spot[], caps = false): void {
    if (!canvasFontIsReady()) return;
    const c = ctx!;
    c.save();
    c.font = canvasFont(caps ? 10 : 11);
    if (caps && "letterSpacing" in c) c.letterSpacing = "1.6px";
    const s = caps ? text.toUpperCase() : text;
    const w = c.measureText(s).width;
    for (const spot of spots) {
      const [x, y] = spot(w);
      if (x < 4 || x + w > W - 4 || y < 12 || y > H - 4) continue;
      const box: [number, number, number, number] = [
        x - 3,
        y - 11,
        x + w + 3,
        y + 4,
      ];
      if (
        placed.some(
          (b) =>
            b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3],
        )
      )
        continue;
      placed.push(box);
      c.lineJoin = "round";
      c.lineWidth = 3;
      c.strokeStyle = palette.paper;
      c.strokeText(s, x, y);
      c.fillStyle = palette.ink2;
      c.fillText(s, x, y);
      break;
    }
    c.restore();
  }
  /** Name the patches, biggest first. */
  function namePatches(finds: Find[], sigma: number, near: number): void {
    const groups = new Map<string, Place>();
    for (const f of finds) {
      const o = f.o;
      const key = o.state ? `US-${o.state}` : o.country;
      if (!key) continue;
      const g = groups.get(key);
      if (g) {
        g.x += f.x;
        g.y += f.y;
        g.n++;
      } else {
        groups.set(key, {
          name: o.state
            ? (STATE_NAME[o.state] ?? o.state)
            : countryName(o.country!),
          country: o.state ? "US" : o.country!,
          x: f.x,
          y: f.y,
          n: 1,
        });
      }
    }
    const places = [...groups.values()].map((g) => ({
      ...g,
      x: g.x / g.n,
      y: g.y / g.n,
    }));
    const off = sigma * 2.4 + 4;
    for (const c of nameClusters(places, near, countryName)) {
      if (c.x < 0 || c.x > W || c.y < 0 || c.y > H) continue;
      label(c.name, [
        () => [c.x + off, c.y + 4],
        (w) => [c.x - off - w, c.y + 4],
        (w) => [c.x - w / 2, c.y + off + 11],
        (w) => [c.x - w / 2, c.y - off - 3],
      ]);
    }
  }

  /** One find: a dot for a reptile, a ring for an amphibian. */
  function mark(x: number, y: number, cls: Cls): void {
    ctx!.beginPath();
    ctx!.arc(x, y, 2.9, 0, Math.PI * 2);
    if (cls === "reptiles") {
      ctx!.fillStyle = palette.ink;
      ctx!.fill();
    } else {
      ctx!.fillStyle = palette.paper;
      ctx!.fill();
      ctx!.strokeStyle = palette.ink;
      ctx!.lineWidth = 1.3;
      ctx!.stroke();
    }
  }
  /** Each find's mark, on a rim of paper so it stands off the heat. */
  function drawFinds(finds: Find[]): void {
    ctx!.beginPath();
    for (const f of finds) {
      ctx!.moveTo(f.x + 4.6, f.y);
      ctx!.arc(f.x, f.y, 4.6, 0, Math.PI * 2);
    }
    ctx!.fillStyle = palette.paper;
    ctx!.fill();
    for (const f of finds) {
      pinHits.push(f);
      mark(f.x, f.y, f.o.cls);
    }
  }
  function drawLegend(finds: Find[]): void {
    if (!canvasFontIsReady()) return;
    const kinds = (["reptiles", "amphibians"] as Cls[]).filter((c) =>
      finds.some((f) => f.o.cls === c),
    );
    let x = 14;
    const y = H - 14;
    for (const cls of kinds) {
      const text = cls === "reptiles" ? "Reptiles" : "Amphibians";
      ctx!.beginPath();
      ctx!.arc(x + 4, y - 4, 4.6, 0, Math.PI * 2);
      ctx!.fillStyle = palette.paper;
      ctx!.fill();
      mark(x + 4, y - 4, cls);
      label(text, [at(x + 13, y)]);
      ctx!.font = canvasFont(11);
      x += 13 + ctx!.measureText(text).width + 18;
    }
  }

  /** While the frame has keyboard focus, a ring marks what Enter opens. */
  function keyboardOn(): boolean {
    return frame!.matches(":focus-visible");
  }
  function drawRing(): void {
    if (!keyboardOn()) return;
    const [x, y] = ringAt();
    ctx!.lineWidth = 2;
    ctx!.strokeStyle = palette.paper;
    ctx!.beginPath();
    ctx!.arc(x, y, 9, 0, Math.PI * 2);
    ctx!.stroke();
    ctx!.strokeStyle = palette.ink;
    ctx!.beginPath();
    ctx!.arc(x, y, 11, 0, Math.PI * 2);
    ctx!.stroke();
  }
  /** Outline the place under the mouse, or under the ring, if it has finds. */
  function highlight(counts: Map<string, number>): void {
    const key = keyboardOn() ? placeAt(...ringAt()) : hoverKey;
    if (!key || !(counts.get(key) ?? 0)) return;
    const r = regionPolys.find((p) => p.key === key);
    if (r) outline(r.pts);
  }

  // ---------------------------------------------------------- world level
  function renderWorld(): void {
    const project = zoomedProject(makeProjection(WORLD_BBOX, W, H, 8));
    const finds = projected(project, () => true);
    dotHits = finds.flatMap((f) =>
      f.o.country ? [{ x: f.x, y: f.y, key: f.o.country }] : [],
    );
    for (const [iso, g] of Object.entries(GEO_COUNTRIES)) {
      const pts = drawLand(g, project);
      if (pts) regionPolys.push({ key: iso, pts });
    }
    highlight(countBy((o) => o.country));
    const sigma = sigmaFor("world");
    drawHeat(finds, sigma);
    namePatches(finds, sigma, sigma * 5);
  }

  // ------------------------------------------------------- US states level
  function renderUS(): void {
    const project = zoomedProject(makeProjection(conusBox(), W, H, 16));
    const finds = projected(
      project,
      (o) => o.state != null && !CONUS_SKIP.has(o.state),
    );
    // Hawaii sits in its own box at the bottom left, as US maps do.
    const iw = Math.max(90, W * 0.16);
    const ih = iw * 0.62;
    const ix = 10;
    const iy = H - ih - 10;
    const hg = GEO_STATES.HI;
    const base = hg ? makeProjection(hg.bbox, iw, ih, 8) : null;
    const hiProject: Project = (lon, lat) => {
      const [x, y] = base!(lon, lat);
      return [x + ix, y + iy];
    };
    const hiFinds = base ? projected(hiProject, (o) => o.state === "HI") : [];
    if (hg) hiInset = { x: ix, y: iy, w: iw, h: ih };
    dotHits = [...finds, ...hiFinds].map((f) => ({
      x: f.x,
      y: f.y,
      key: f.o.state!,
    }));
    for (const [abbr, g] of Object.entries(GEO_STATES)) {
      if (CONUS_SKIP.has(abbr)) continue;
      const pts = drawLand(g, project);
      if (pts) regionPolys.push({ key: abbr, pts });
    }
    const counts = countBy((o) => o.state);
    highlight(counts);
    const sigma = sigmaFor("us");
    drawHeat(finds, sigma);
    // Labels keep off the inset, all but its own caption.
    const keepOff: [number, number, number, number] = [0, iy - 10, iw + 20, H];
    placed.push(keepOff);
    namePatches(finds, sigma, sigma * 4);
    placed.splice(placed.indexOf(keepOff), 1);
    if (hg && hiInset) drawHawaii(hg, hiProject, hiFinds, counts, sigma);
  }

  function drawHawaii(
    hg: RegionGeo,
    project: Project,
    finds: Find[],
    counts: Map<string, number>,
    sigma: number,
  ): void {
    const { x: ix, y: iy, w: iw, h: ih } = hiInset!;
    ctx!.save();
    ctx!.beginPath();
    ctx!.rect(ix, iy, iw, ih);
    ctx!.clip();
    ctx!.fillStyle = palette.paper;
    ctx!.fillRect(ix, iy, iw, ih);
    drawLand(hg, project);
    drawHeat(finds, Math.max(2.4, sigma * 0.8), hiInset!);
    ctx!.restore();
    const key = keyboardOn() ? placeAt(...ringAt()) : hoverKey;
    const lit = key === "HI" && (counts.get("HI") ?? 0) > 0;
    ctx!.strokeStyle = lit ? palette.ink2 : palette.rule;
    ctx!.lineWidth = 1;
    ctx!.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1);
    // Top right, which is open sea; the islands run from the top left.
    label("Hawaii", [(w) => [ix + iw - 7 - w, iy + 16]], true);
  }

  // ------------------------------------------------- state or country level
  function renderPlace(
    g: RegionGeo,
    title: string,
    keep: (o: Obs) => boolean,
    isState: boolean,
  ): void {
    const project = zoomedProject(makeProjection(g.bbox, W, H, 24));
    // Its neighbours too, so the place sits on a map instead of floating on
    // the paper. For a state, the states stand in for the US outline.
    for (const [iso, cg] of Object.entries(GEO_COUNTRIES)) {
      if (isState && iso === "US") continue;
      drawLand(cg, project);
    }
    if (isState)
      for (const sg of Object.values(GEO_STATES)) drawLand(sg, project);
    const rings = onScreen(g, project);
    if (rings) outline(rings);
    // Every find feeds the heat, so it's true past the border too; the
    // marks you can tap are this place's.
    const every = projected(project, () => true);
    drawHeat(every, sigmaFor("place"));
    const finds = every.filter((f) => keep(f.o));
    drawFinds(finds);
    label(title, [at(14, 22)], true);
    drawLegend(finds);
  }

  let deferred = false;
  function render(): void {
    // Under a card's opening scene, the map waits until the scene's gone:
    // none of it shows yet, and drawing it (again with every change of
    // layout while the page loads) takes the GPU from the scene.
    if (covered()) {
      if (!deferred) {
        deferred = true;
        whenUncovered(() => {
          deferred = false;
          render();
        });
      }
      return;
    }
    if (!W && !fit()) return;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.fillStyle = palette.paper;
    ctx!.fillRect(0, 0, W, H);
    regionPolys = [];
    pinHits = [];
    dotHits = [];
    hiInset = null;
    // Labels keep clear of the zoom buttons in the top right corner.
    placed = [[W - 56, 0, W, 100]];
    if (view === "world") renderWorld();
    else if (view === "us") renderUS();
    else if (view === "state" && selState)
      renderPlace(
        GEO_STATES[selState],
        STATE_NAME[selState] ?? selState,
        (o) => o.state === selState,
        true,
      );
    else if (view === "country" && selCountry)
      renderPlace(
        GEO_COUNTRIES[selCountry],
        countryName(selCountry),
        (o) => o.country === selCountry,
        false,
      );
    drawRing();
    syncControls();
  }

  function syncControls(): void {
    const t = heading();
    if (zoomInBtn) zoomInBtn.disabled = t.z >= MAX_ZOOM - 0.01;
    if (zoomOutBtn) zoomOutBtn.disabled = t.z <= MIN_ZOOM + 0.01;
    if (backBtn) backBtn.classList.toggle("hidden", view === "world");
  }

  // The one line under the map: what a tap does at this level, then how to
  // move around, in the words for the device in hand.
  const LOOK = matchMedia("(pointer: coarse)").matches
    ? "Pinch to zoom and drag to look around."
    : "Scroll to zoom, and drag or use the arrow keys to look around.";
  function syncStatus(): void {
    if (!statusEl || !loaded) return;
    const tap =
      view === "world"
        ? "Tap a shaded spot to see what I found there."
        : view === "us"
          ? "Tap a shaded spot to see what I found in that state."
          : "Tap one of my finds to open it on iNaturalist.";
    statusEl.textContent = `${tap} ${LOOK}`;
  }
  function announce(text: string): void {
    if (liveEl) liveEl.textContent = text;
  }
  /** Say what's in the ring, after the keyboard moves the map. */
  function describeRing(): void {
    if (view === "world" || view === "us") {
      const key = placeAt(...ringAt());
      const n = key ? (levelCounts().get(key) ?? 0) : 0;
      announce(
        key && n
          ? `${placeName(key)}, ${n} observation${n === 1 ? "" : "s"}. Enter zooms in.`
          : "No finds in the ring.",
      );
    } else {
      const o = pinAt(...ringAt());
      announce(
        o
          ? `${o.name}, ${fmtDate(o.date)}. Enter opens it on iNaturalist.`
          : "No finds in the ring.",
      );
    }
  }

  function polyAt(x: number, y: number): string | null {
    for (const sp of regionPolys) {
      for (const poly of sp.pts) if (pointInRing(x, y, poly)) return sp.key;
    }
    return null;
  }
  function regionAt(x: number, y: number): string | null {
    if (
      hiInset &&
      x >= hiInset.x &&
      x <= hiInset.x + hiInset.w &&
      y >= hiInset.y &&
      y <= hiInset.y + hiInset.h
    )
      return "HI";
    return polyAt(x, y);
  }

  /**
   * The place a tap or the ring is on, at the world and US levels: the land
   * under it if that place has finds, or else the place of the nearest find
   * within three sigma and 10px to spare, past the edge of its patch. So a
   * patch can be tapped where it spills past a coarse outline into the sea,
   * and the ring needn't land on a country a few pixels wide.
   */
  function placeAt(x: number, y: number): string | null {
    const counts = levelCounts();
    const key = regionAt(x, y);
    if (key && (counts.get(key) ?? 0) > 0) return key;
    let best: string | null = null;
    const reach = sigmaFor(view === "us" ? "us" : "world") * 3 + 10;
    let bestD = reach * reach;
    for (const d of dotHits) {
      const dd = (d.x - x) ** 2 + (d.y - y) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = d.key;
      }
    }
    return best;
  }

  function pinAt(x: number, y: number): Obs | null {
    let best: Obs | null = null;
    let bestD = 12 * 12;
    for (const p of pinHits) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p.o;
      }
    }
    return best;
  }

  function goBack(): void {
    if (view === "state") view = "us";
    else if (view === "us" || view === "country") view = "world";
    selState = null;
    if (view === "world") selCountry = null;
    hoverKey = null;
    hideTip();
    resetZoom();
    render();
    renderDetail();
    syncStatus();
    announce(view === "us" ? "United States." : "The whole world.");
  }

  function detailItems(): { title: string; items: Obs[] } | null {
    if (view === "state" && selState)
      return {
        title: `${STATE_NAME[selState] ?? selState} · `,
        items: pool().filter((o) => o.state === selState),
      };
    if (view === "country" && selCountry)
      return {
        title: `${GEO_COUNTRIES[selCountry]?.name ?? selCountry} · `,
        items: pool().filter((o) => o.country === selCountry),
      };
    return null;
  }

  function renderDetail(): void {
    if (!detailEl) return;
    const detail = detailItems();
    if (!detail || detail.items.length === 0) {
      detailEl.replaceChildren();
      return;
    }
    const head = document.createElement("h3");
    head.className = "mb-3 text-sm font-normal text-ink";
    head.textContent = `${detail.title}${detail.items.length} observation${detail.items.length === 1 ? "" : "s"}`;

    const grid = document.createElement("div");
    grid.className = "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3";
    grid.setAttribute("role", "list");
    for (const o of detail.items) {
      const a = document.createElement("a");
      a.href = o.uri;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className =
        "group flex gap-3 border-b border-rule-soft py-2 pr-2 no-underline transition-colors hover:bg-hover hover:no-underline";
      a.setAttribute("role", "listitem");

      const img = document.createElement("img");
      img.src = o.thumb;
      img.alt = o.name;
      img.loading = "lazy";
      img.decoding = "async";
      img.width = 64;
      img.height = 64;
      img.className = "h-16 w-16 shrink-0 bg-band object-cover";
      a.appendChild(img);

      const meta = document.createElement("div");
      meta.className = "min-w-0 flex-1";
      const nm = document.createElement("p");
      nm.className = "truncate text-sm text-ink";
      nm.textContent = o.name;
      const sci = document.createElement("p");
      sci.className = "truncate text-xs italic text-ink-3";
      sci.textContent = o.sci;
      const sub = document.createElement("p");
      sub.className = "mt-1 truncate text-xs text-ink-2";
      const bits = [fmtDate(o.date), o.place].filter(Boolean);
      sub.textContent = bits.join(" · ");
      if (o.obscured) {
        const tag = document.createElement("span");
        tag.className = "ml-1 whitespace-nowrap text-[10px] text-ink-2";
        tag.textContent = "approx.";
        sub.appendChild(tag);
      }
      meta.append(nm, sci, sub);
      a.appendChild(meta);
      grid.appendChild(a);
    }
    detailEl.replaceChildren(head, grid);
  }

  function openRegion(key: string): void {
    if (view === "world") {
      if (!(countBy((o) => o.country).get(key) ?? 0)) return;
      if (key === "US") {
        view = "us";
      } else {
        selCountry = key;
        view = "country";
      }
    } else if (view === "us") {
      if (!(countBy((o) => o.state).get(key) ?? 0)) return;
      selState = key;
      view = "state";
    }
    hoverKey = null;
    hideTip();
    resetZoom();
    render();
    renderDetail();
    syncStatus();
    const detail = detailItems();
    announce(
      detail
        ? `${detail.title}${detail.items.length} observation${detail.items.length === 1 ? "" : "s"}, listed under the map.`
        : "United States.",
    );
  }

  async function fetchClass(cls: Cls, iconic: string): Promise<Obs[]> {
    const out: Obs[] = [];
    const perPage = 200;
    let page = 1;
    while (out.length < limit) {
      const q = new URLSearchParams({
        user_id: userId!,
        iconic_taxa: iconic,
        photos: "true",
        per_page: String(Math.min(perPage, limit - out.length)),
        page: String(page),
        order_by: "observed_on",
        order: "desc",
        locale: "en",
      });
      const res = await fetch(`${API}?${q.toString()}`, {
        headers: { Accept: "application/json" },
        // A hung request would leave the map on its loading line forever.
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        results?: INatObs[];
        total_results?: number;
      };
      const results = data.results ?? [];
      for (const o of results) {
        const raw = o.photos?.[0]?.url;
        if (!raw) continue;
        const thumb = upgrade(raw);
        if (!allowedHost(thumb)) continue;
        const [lng, lat] = coordsOf(o);
        const state = stateOf(o);
        // Country from coordinates; fall back to US when a US state matched.
        let country: string | null = null;
        if (lng != null && lat != null) country = countryOf(lng, lat);
        if (!country && state) country = "US";
        out.push({
          id: o.id,
          uri: o.uri || `https://www.inaturalist.org/observations/${o.id}`,
          cls,
          state,
          country,
          // Drawn on a 0.1° grid, never at the spot itself (inat-place.ts).
          lng: lng == null ? null : coarseCoord(lng),
          lat: lat == null ? null : coarseCoord(lat),
          obscured: !!o.obscured,
          name:
            o.taxon?.preferred_common_name ||
            o.taxon?.name ||
            o.species_guess ||
            "Observation",
          sci: o.taxon?.name || "",
          place: coarsePlace(o.place_guess),
          date: o.observed_on || "",
          thumb,
        });
      }
      if (
        results.length < perPage ||
        out.length >= (data.total_results ?? out.length)
      )
        break;
      page++;
    }
    return out;
  }

  const load = async (): Promise<void> => {
    if (started) return;
    started = true;
    if (statusEl) statusEl.textContent = "Loading my finds from iNaturalist...";
    try {
      const [rep, amp] = await Promise.all([
        fetchClass("reptiles", "Reptilia"),
        fetchClass("amphibians", "Amphibia"),
      ]);
      all = [...rep, ...amp];
      if (all.length === 0) {
        if (statusEl)
          statusEl.textContent = "No reptiles or amphibians to show yet.";
        return;
      }
      loaded = true;
      fit();
      updateTouchAction();
      render();
      renderDetail();
      syncStatus();
    } catch {
      if (statusEl)
        statusEl.textContent =
          "Couldn't load my finds right now. See them on iNaturalist.";
    }
  };

  // ---------------------------------------------------------------- wiring
  function toCanvas(e: { clientX: number; clientY: number }): [number, number] {
    const r = canvas!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  const pointers = new Map<number, { x: number; y: number }>();
  let pinchPrevDist = 0;
  let pinchPrevMid = { x: 0, y: 0 };
  let downX = 0;
  let downY = 0;
  let downT = 0;
  let moved = false;

  function midOfPointers(): { d: number; x: number; y: number } {
    const pts = [...pointers.values()];
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    return {
      d: Math.hypot(dx, dy),
      x: (pts[0].x + pts[1].x) / 2,
      y: (pts[0].y + pts[1].y) / 2,
    };
  }

  /** What a tap does here; the keyboard's Enter taps the ring. */
  function tapAt(x: number, y: number): void {
    if (view === "state" || view === "country") {
      const o = pinAt(x, y);
      if (o) window.open(o.uri, "_blank", "noopener");
      return;
    }
    const key = placeAt(x, y);
    if (key) openRegion(key);
  }

  function showTip(text: string, x: number, y: number): void {
    if (!tooltip) return;
    tooltip.textContent = text;
    // The frame's 1px rule sits between the wrapper and the canvas.
    tooltip.style.left = `${x + 1}px`;
    tooltip.style.top = `${y - 6}px`;
    tooltip.classList.remove("hidden");
  }
  function hideTip(): void {
    tooltip?.classList.add("hidden");
  }

  function showHover(x: number, y: number): void {
    const grab = zoom > 1.01 ? "grab" : "default";
    if (view === "state" || view === "country") {
      const o = pinAt(x, y);
      canvas!.style.cursor = o ? "pointer" : grab;
      if (o)
        showTip(
          `${o.name} · ${fmtDate(o.date)}${o.obscured ? " (approx.)" : ""}`,
          x,
          y,
        );
      else hideTip();
      return;
    }
    const key = placeAt(x, y);
    const n = key ? (levelCounts().get(key) ?? 0) : 0;
    canvas!.style.cursor = n > 0 ? "pointer" : grab;
    const next = n > 0 ? key : null;
    if (next !== hoverKey) {
      hoverKey = next;
      scheduleRender();
    }
    if (n > 0 && key)
      showTip(
        `${placeName(key)} · ${n} observation${n === 1 ? "" : "s"}`,
        x,
        y,
      );
    else hideTip();
  }

  canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = toCanvas(e);
    stopTween();
    pointers.set(e.pointerId, { x, y });
    if (pointers.size === 1) {
      downX = x;
      downY = y;
      downT = performance.now();
      moved = false;
    } else if (pointers.size === 2) {
      const m = midOfPointers();
      pinchPrevDist = m.d;
      pinchPrevMid = { x: m.x, y: m.y };
      moved = true;
      hideTip();
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const [x, y] = toCanvas(e);
    const p = pointers.get(e.pointerId);

    // two-finger pinch: zoom around the midpoint + pan by its movement
    if (pointers.size === 2) {
      if (p) {
        p.x = x;
        p.y = y;
      }
      const m = midOfPointers();
      if (pinchPrevDist > 0) {
        const nz = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, zoom * (m.d / pinchPrevDist)),
        );
        const k = nz / zoom;
        panX = m.x - (m.x - panX) * k;
        panY = m.y - (m.y - panY) * k;
        zoom = nz;
        panX += m.x - pinchPrevMid.x;
        panY += m.y - pinchPrevMid.y;
        clampPan();
        updateTouchAction();
        scheduleRender();
      }
      pinchPrevDist = m.d;
      pinchPrevMid = { x: m.x, y: m.y };
      return;
    }

    // single-pointer drag: pan when zoomed in
    if (p) {
      const dx = x - p.x;
      const dy = y - p.y;
      p.x = x;
      p.y = y;
      if (Math.hypot(x - downX, y - downY) > 6) moved = true;
      if (zoom > 1.01 && moved) {
        panX += dx;
        panY += dy;
        clampPan();
        scheduleRender();
        hideTip();
        canvas!.style.cursor = "grabbing";
      }
      return;
    }

    // hover (mouse only)
    if (e.pointerType === "touch") return;
    showHover(x, y);
  });

  function endPointer(e: PointerEvent): void {
    const wasSize = pointers.size;
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (wasSize === 1 && p && !moved && performance.now() - downT < 500) {
      tapAt(p.x, p.y);
    }
    if (pointers.size < 2) pinchPrevDist = 0;
    if (pointers.size === 1) {
      // one finger remains after a pinch: keep panning, don't treat as a tap
      const rp = [...pointers.values()][0];
      downX = rp.x;
      downY = rp.y;
      downT = performance.now();
      moved = true;
    }
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", () => {
    hideTip();
    if (hoverKey) {
      hoverKey = null;
      scheduleRender();
    }
  });

  // desktop scroll-wheel zoom, around the cursor
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const [x, y] = toCanvas(e);
      applyZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), x, y);
    },
    { passive: false },
  );

  // The keyboard: the arrows move the ring, by 5% of the width or 20% with
  // Shift held, fine enough to land on a small country. Once zoomed in they
  // pan the map under it; + and − zoom about the ring, 0 fits the level again, Enter or
  // Space opens what's in the ring and Escape steps back out a level.
  frame.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !W) return;
    const dir: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const d = dir[e.key];
    if (d) {
      e.preventDefault();
      const by = (e.shiftKey ? 0.2 : 0.05) * W;
      walk(d[0] * by, d[1] * by);
      return;
    }
    if (e.key === "+" || e.key === "=")
      zoomAround(STEP, ...ringAt(), describeRing);
    else if (e.key === "-" || e.key === "_")
      zoomAround(1 / STEP, ...ringAt(), describeRing);
    else if (e.key === "0") {
      centreRing();
      moveTo(1, 0, 0, describeRing);
    } else if (e.key === "Enter" || e.key === " ") enterRing();
    else if (e.key === "Escape" && view !== "world") goBack();
    else return;
    e.preventDefault();
  });
  /**
   * Move what the keyboard looks at by (dx, dy). A ring that's off to one
   * side drifts back to the middle first, then the map pans under it, and
   * whatever the map can't take, at its edges or at the whole-map view, moves
   * the ring itself. So every place can be reached, the Hawaii inset too.
   */
  function walk(dx: number, dy: number): void {
    let [rx, ry] = ringAt();
    const back = (r: number, mid: number, by: number): [number, number] => {
      if ((r > mid && by < 0) || (r < mid && by > 0)) {
        const next = by < 0 ? Math.max(mid, r + by) : Math.min(mid, r + by);
        return [next, by - (next - r)];
      }
      return [r, by];
    };
    [rx, dx] = back(rx, W / 2, dx);
    [ry, dy] = back(ry, H / 2, dy);
    const t = heading();
    const to = clampView(t.z, t.x - dx, t.y - dy);
    ringX = Math.max(12, Math.min(W - 12, rx + dx - (t.x - to.x)));
    ringY = Math.max(12, Math.min(H - 12, ry + dy - (t.y - to.y)));
    moveTo(to.z, to.x, to.y, describeRing);
  }
  /** Enter does what a tap on the ring would, or says nothing's there. */
  function enterRing(): void {
    const [x, y] = ringAt();
    const hit =
      view === "state" || view === "country"
        ? pinAt(x, y) != null
        : placeAt(x, y) != null;
    if (hit) tapAt(x, y);
    else describeRing();
  }
  // The ring shows and hides with keyboard focus.
  frame.addEventListener("focus", () => {
    render();
    if (keyboardOn() && loaded) describeRing();
  });
  frame.addEventListener("blur", () => render());

  // + and − buttons (work on every device)
  zoomInBtn?.addEventListener("click", () => zoomAround(STEP, W / 2, H / 2));
  zoomOutBtn?.addEventListener("click", () =>
    zoomAround(1 / STEP, W / 2, H / 2),
  );

  backBtn?.addEventListener("click", goBack);

  for (const btn of toggleEls) {
    btn.addEventListener("click", () => {
      active = (btn.dataset.herpmapCls as Cls | "all") ?? "all";
      for (const b of toggleEls) {
        b.setAttribute("aria-checked", String(b === btn));
      }
      // if the current detail region lost all data under the new filter, back out
      if (
        view === "state" &&
        selState &&
        !(countBy((o) => o.state).get(selState) ?? 0)
      )
        goBack();
      else if (
        view === "country" &&
        selCountry &&
        !(countBy((o) => o.country).get(selCountry) ?? 0)
      )
        goBack();
      else {
        render();
        renderDetail();
      }
    });
  }

  // Follow the theme toggle: redraw in the other theme's tokens.
  new MutationObserver(() => {
    const next = readPalette();
    if (next.key === palette.key) return;
    palette = next;
    render();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  // Labels wait for Libre Franklin, then the map draws again with them.
  void canvasFontReady().then(() => render());

  let lastWidth = 0;
  const ro = new ResizeObserver(() => {
    const w = frame.clientWidth;
    if (!w || w === lastWidth) return;
    lastWidth = w;
    stopTween();
    centreRing();
    if (!fit()) return;
    clampPan();
    render();
  });
  ro.observe(frame);

  const io = new IntersectionObserver(
    (entries, obs) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          obs.disconnect();
          void load();
        }
      }
    },
    { rootMargin: "200px" },
  );
  io.observe(root);

  // The land goes down straight away, so the frame has its size and the
  // world is there while the finds load.
  if (fit()) {
    lastWidth = frame.clientWidth;
    render();
  }
}
