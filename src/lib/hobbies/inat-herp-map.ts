/**
 * "Reptiles & Amphibians" map — a real geographic map of the author's iNaturalist
 * herp observations, the personal counterpart to the road-cruise game.
 *
 * It fetches the user's Reptilia and Amphibia observations from the public iNat
 * API and draws them on a canvas at three zoom levels:
 *   - World: a real world map (country outlines from committed public-domain
 *     geometry) with a HEAT MAP of every observation's true coordinates. Click a
 *     country that has data to zoom in.
 *   - US states: clicking the US opens a US map (state outlines + Hawaii inset)
 *     with the same heat map; click a state to zoom to it.
 *   - State / country detail: that region's outline blown up with a PIN at every
 *     observation's true (or iNat-obscured) coordinate, and a grid below listing
 *     each observation's species, place, and date before you click through.
 *
 * A Reptiles / Amphibians / All toggle switches datasets. No map tiles and no
 * runtime geo fetch — the boundaries are baked/committed (scripts/build-herp-geo.mjs),
 * so nothing changes in the CSP; only the iNat API + photo CDNs are contacted,
 * and those are already allow-listed.
 *
 * Mounted by src/components/hobbies/INatHerpMap.astro via [data-herpmap] hooks.
 */
import geoData from "./herp-geo.json";

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

/** Class-coded pin colors. */
const CLS_COLOR: Record<Cls, string> = {
  reptiles: "#f59e0b",
  amphibians: "#38bdf8",
};

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

/** Interpolated heat color (blue -> lime -> yellow -> orange -> red) by density. */
function heatColor(t: number): [number, number, number, number] {
  const stops: [number, number[], number][] = [
    [0.12, [37, 99, 235], 70],
    [0.32, [132, 204, 22], 140],
    [0.55, [250, 204, 21], 190],
    [0.78, [249, 115, 22], 215],
    [1.0, [239, 68, 68], 235],
  ];
  if (t <= stops[0][0]) {
    const a = Math.max(0, (t / stops[0][0]) * stops[0][2]);
    return [stops[0][1][0], stops[0][1][1], stops[0][1][2], a];
  }
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0, a0] = stops[i - 1];
      const [t1, c1, a1] = stops[i];
      const f = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
        Math.round(a0 + (a1 - a0) * f),
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1][0], last[1][1], last[1][2], last[2]];
}

export function initHerpMap(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>("[data-herpmap-canvas]");
  const tooltip = root.querySelector<HTMLElement>("[data-herpmap-tip]");
  const detailEl = root.querySelector<HTMLElement>("[data-herpmap-detail]");
  const statusEl = root.querySelector<HTMLElement>("[data-herpmap-status]");
  const backBtn = root.querySelector<HTMLButtonElement>("[data-herpmap-back]");
  const toggleEls = Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-herpmap-cls]"),
  );
  const userId = root.dataset.herpmapUser;
  const limit = Math.max(
    1,
    Math.min(500, Number(root.dataset.herpmapLimit) || 300),
  );
  if (!canvas || !userId) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let all: Obs[] = [];
  let active: Cls | "all" = "all";
  let view: View = "world";
  let selState: string | null = null;
  let selCountry: string | null = null; // ISO A2 for the country detail view
  let started = false;
  let W = 0;
  let H = 0;
  let dpr = 1;

  // Per-render caches for hit-testing.
  let regionPolys: { key: string; pts: [number, number][][] }[] = [];
  let pinHits: { x: number; y: number; o: Obs }[] = [];
  let hiInset: { x: number; y: number; w: number; h: number } | null = null;

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

  function fit(): void {
    const cssW = canvas!.clientWidth || 640;
    const cssH = Math.max(300, Math.min(520, Math.round(cssW * 0.6)));
    canvas!.style.height = `${cssH}px`;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas!.width = Math.round(cssW * dpr);
    canvas!.height = Math.round(cssH * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = cssW;
    H = cssH;
  }

  function drawRings(
    g: RegionGeo,
    project: Project,
    fill: string,
    stroke: string,
    lw: number,
  ): [number, number][][] {
    const projected: [number, number][][] = [];
    for (const ring of g.rings) {
      ctx!.beginPath();
      const pr: [number, number][] = [];
      ring.forEach(([lon, lat], i) => {
        const [x, y] = project(lon, lat);
        pr.push([x, y]);
        if (i === 0) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
      });
      ctx!.closePath();
      ctx!.fillStyle = fill;
      ctx!.fill();
      ctx!.lineWidth = lw;
      ctx!.strokeStyle = stroke;
      ctx!.stroke();
      projected.push(pr);
    }
    return projected;
  }

  /** Heatmap: accumulate alpha blobs offscreen, then colourise by density. */
  function drawHeat(pts: { x: number; y: number }[], radius: number): void {
    if (pts.length === 0) return;
    const off = document.createElement("canvas");
    off.width = Math.round(W * dpr);
    off.height = Math.round(H * dpr);
    const octx = off.getContext("2d");
    if (!octx) return;
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.globalCompositeOperation = "lighter";
    for (const p of pts) {
      const grd = octx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      grd.addColorStop(0, "rgba(0,0,0,0.5)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      octx.fillStyle = grd;
      octx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
    }
    const img = octx.getImageData(0, 0, off.width, off.height);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      const t = Math.min(1, data[i + 3] / 255);
      if (t <= 0.02) {
        data[i + 3] = 0;
        continue;
      }
      const [r, g, b, a] = heatColor(t);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
    octx.putImageData(img, 0, 0);
    ctx!.save();
    ctx!.globalAlpha = 0.9;
    ctx!.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);
    ctx!.restore();
  }

  function projectedPoints(
    project: Project,
    keep: (o: Obs) => boolean,
  ): {
    heat: { x: number; y: number }[];
    pins: { x: number; y: number; o: Obs }[];
  } {
    const heat: { x: number; y: number }[] = [];
    const pins: { x: number; y: number; o: Obs }[] = [];
    for (const o of pool()) {
      if (o.lng == null || o.lat == null || !keep(o)) continue;
      const [x, y] = project(o.lng, o.lat);
      heat.push({ x, y });
      pins.push({ x, y, o });
    }
    return { heat, pins };
  }

  function label(text: string): void {
    ctx!.fillStyle = "rgba(230,235,240,0.95)";
    ctx!.font = "600 13px system-ui, sans-serif";
    ctx!.fillText(text, 14, 22);
  }

  function drawLegend(): void {
    const legend: [Cls, string][] = [
      ["reptiles", "Reptiles"],
      ["amphibians", "Amphibians"],
    ];
    let lx = 14;
    const ly = H - 14;
    for (const [cls, lbl] of legend) {
      ctx!.beginPath();
      ctx!.arc(lx + 5, ly - 4, 4.5, 0, Math.PI * 2);
      ctx!.fillStyle = CLS_COLOR[cls];
      ctx!.fill();
      ctx!.strokeStyle = "rgba(255,255,255,0.9)";
      ctx!.lineWidth = 1;
      ctx!.stroke();
      ctx!.fillStyle = "rgba(210,220,228,0.9)";
      ctx!.font = "500 11px system-ui, sans-serif";
      ctx!.fillText(lbl, lx + 14, ly);
      lx += 14 + ctx!.measureText(lbl).width + 16;
    }
  }

  function drawPins(pins: { x: number; y: number; o: Obs }[]): void {
    for (const p of pins) {
      pinHits.push(p);
      ctx!.beginPath();
      ctx!.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx!.fillStyle = CLS_COLOR[p.o.cls];
      ctx!.fill();
      ctx!.lineWidth = 1.5;
      ctx!.strokeStyle = "rgba(255,255,255,0.9)";
      ctx!.stroke();
    }
  }

  function clearFrame(): void {
    ctx!.clearRect(0, 0, W, H);
    ctx!.fillStyle = "#0b1220";
    ctx!.fillRect(0, 0, W, H);
    regionPolys = [];
    pinHits = [];
    hiInset = null;
  }

  // ---------------------------------------------------------- world view
  function renderWorld(): void {
    clearFrame();
    const cnt = countBy((o) => o.country);
    const project = makeProjection(WORLD_BBOX, W, H, 8);
    for (const [iso, g] of Object.entries(GEO_COUNTRIES)) {
      const n = cnt.get(iso) ?? 0;
      const fill = n > 0 ? "rgba(56,80,60,0.95)" : "rgba(28,38,54,0.9)";
      const pr = drawRings(g, project, fill, "rgba(90,110,120,0.35)", 0.5);
      regionPolys.push({ key: iso, pts: pr });
    }
    const { heat } = projectedPoints(project, () => true);
    drawHeat(heat, Math.max(9, W * 0.018));
    label("Tap a highlighted country to zoom in");
  }

  // ------------------------------------------------------- US states view
  function renderUS(): void {
    clearFrame();
    const cnt = countBy((o) => o.state);
    const conus: [number, number, number, number] = [
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
    ];
    for (const [abbr, g] of Object.entries(GEO_STATES)) {
      if (CONUS_SKIP.has(abbr)) continue;
      conus[0] = Math.min(conus[0], g.bbox[0]);
      conus[1] = Math.min(conus[1], g.bbox[1]);
      conus[2] = Math.max(conus[2], g.bbox[2]);
      conus[3] = Math.max(conus[3], g.bbox[3]);
    }
    const project = makeProjection(conus, W, H, 16);
    for (const [abbr, g] of Object.entries(GEO_STATES)) {
      if (CONUS_SKIP.has(abbr)) continue;
      const n = cnt.get(abbr) ?? 0;
      const fill = n > 0 ? "rgba(56,80,60,0.9)" : "rgba(30,41,59,0.9)";
      const pr = drawRings(g, project, fill, "rgba(120,140,120,0.4)", 0.6);
      regionPolys.push({ key: abbr, pts: pr });
    }
    const { heat } = projectedPoints(
      project,
      (o) => o.state != null && o.state !== "HI",
    );
    drawHeat(heat, Math.max(14, W * 0.03));

    // Hawaii inset (bottom-left)
    const hg = GEO_STATES.HI;
    if (hg) {
      const iw = Math.max(90, W * 0.16);
      const ih = iw * 0.62;
      const ix = 10;
      const iy = H - ih - 10;
      hiInset = { x: ix, y: iy, w: iw, h: ih };
      ctx!.save();
      ctx!.beginPath();
      ctx!.rect(ix, iy, iw, ih);
      ctx!.clip();
      ctx!.fillStyle = "rgba(11,18,32,0.95)";
      ctx!.fillRect(ix, iy, iw, ih);
      ctx!.translate(ix, iy);
      const hiProj = makeProjection(hg.bbox, iw, ih, 8);
      const n = cnt.get("HI") ?? 0;
      drawRings(
        hg,
        hiProj,
        n > 0 ? "rgba(56,80,60,0.9)" : "rgba(30,41,59,0.9)",
        "rgba(120,140,120,0.4)",
        0.6,
      );
      ctx!.restore();
      const hiProj2 = makeProjection(hg.bbox, iw, ih, 8);
      const hiHeat = pool()
        .filter((o) => o.state === "HI" && o.lng != null)
        .map((o) => {
          const [x, y] = hiProj2(o.lng!, o.lat!);
          return { x: x + ix, y: y + iy };
        });
      drawHeat(hiHeat, Math.max(10, iw * 0.12));
      ctx!.strokeStyle = "rgba(120,140,120,0.5)";
      ctx!.lineWidth = 1;
      ctx!.strokeRect(ix, iy, iw, ih);
      ctx!.fillStyle = "rgba(200,210,220,0.8)";
      ctx!.font = "600 10px system-ui, sans-serif";
      ctx!.fillText("HI", ix + 6, iy + 14);
    }
    label("United States — tap a state to zoom in");
  }

  // --------------------------------------------------- state / country detail
  function renderDetailMap(
    g: RegionGeo,
    title: string,
    keep: (o: Obs) => boolean,
  ): void {
    clearFrame();
    const project = makeProjection(g.bbox, W, H, 24);
    drawRings(g, project, "rgba(26,38,28,0.95)", "rgba(150,170,150,0.6)", 1.2);
    const { heat, pins } = projectedPoints(project, keep);
    drawHeat(heat, Math.max(16, W * 0.045));
    drawPins(pins);
    label(title);
    drawLegend();
  }

  function render(): void {
    if (view === "world") renderWorld();
    else if (view === "us") renderUS();
    else if (view === "state" && selState)
      renderDetailMap(
        GEO_STATES[selState],
        STATE_NAME[selState] ?? selState,
        (o) => o.state === selState,
      );
    else if (view === "country" && selCountry)
      renderDetailMap(
        GEO_COUNTRIES[selCountry],
        GEO_COUNTRIES[selCountry]?.name ?? selCountry,
        (o) => o.country === selCountry,
      );
    if (backBtn) backBtn.classList.toggle("hidden", view === "world");
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
    for (const sp of regionPolys) {
      for (const poly of sp.pts) if (pointInRing(x, y, poly)) return sp.key;
    }
    return null;
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
    render();
    renderDetail();
  }

  function detailItems(): { title: string; items: Obs[] } | null {
    if (view === "state" && selState)
      return {
        title: `${STATE_NAME[selState] ?? selState} — `,
        items: pool().filter((o) => o.state === selState),
      };
    if (view === "country" && selCountry)
      return {
        title: `${GEO_COUNTRIES[selCountry]?.name ?? selCountry} — `,
        items: pool().filter((o) => o.country === selCountry),
      };
    return null;
  }

  function renderDetail(): void {
    if (!detailEl) return;
    const detail = detailItems();
    if (statusEl) {
      if (detail) {
        statusEl.textContent = "";
      } else if (view === "us") {
        const states = countBy((o) => o.state).size;
        statusEl.textContent = `United States — ${pool().filter((o) => o.state).length} observations across ${states} state${states === 1 ? "" : "s"}. Tap a state to zoom in.`;
      } else {
        const cc = countBy((o) => o.country);
        const mapped = pool().filter((o) => o.lng != null).length;
        statusEl.textContent = cc.size
          ? `${pool().length} observations across ${cc.size} countr${cc.size === 1 ? "y" : "ies"} (${mapped} mapped). Tap a highlighted country to zoom in.`
          : "";
      }
    }
    if (!detail || detail.items.length === 0) {
      detailEl.replaceChildren();
      return;
    }
    const head = document.createElement("h3");
    head.className = "mb-3 text-sm font-semibold";
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
        "group flex gap-3 rounded-lg border border-neutral-200 p-2 no-underline transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900";
      a.setAttribute("role", "listitem");

      const img = document.createElement("img");
      img.src = o.thumb;
      img.alt = o.name;
      img.loading = "lazy";
      img.decoding = "async";
      img.width = 64;
      img.height = 64;
      img.className = "h-16 w-16 shrink-0 rounded-md object-cover";
      a.appendChild(img);

      const meta = document.createElement("div");
      meta.className = "min-w-0 flex-1";
      const nm = document.createElement("p");
      nm.className =
        "truncate text-sm font-medium text-neutral-900 dark:text-neutral-100";
      nm.textContent = o.name;
      const sci = document.createElement("p");
      sci.className =
        "truncate text-xs italic text-neutral-500 dark:text-neutral-400";
      sci.textContent = o.sci;
      const sub = document.createElement("p");
      sub.className =
        "mt-1 truncate text-xs text-neutral-500 dark:text-neutral-500";
      const bits = [fmtDate(o.date), o.place].filter(Boolean);
      sub.textContent = bits.join(" · ");
      if (o.obscured) {
        const tag = document.createElement("span");
        tag.className =
          "ml-1 whitespace-nowrap rounded bg-neutral-200 px-1 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
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
    render();
    renderDetail();
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
          lng,
          lat,
          obscured: !!o.obscured,
          name:
            o.taxon?.preferred_common_name ||
            o.taxon?.name ||
            o.species_guess ||
            "Observation",
          sci: o.taxon?.name || "",
          place: o.place_guess || "",
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
    try {
      const [rep, amp] = await Promise.all([
        fetchClass("reptiles", "Reptilia"),
        fetchClass("amphibians", "Amphibia"),
      ]);
      all = [...rep, ...amp];
      if (all.length === 0) {
        if (statusEl)
          statusEl.textContent =
            "No reptile or amphibian observations to show yet.";
        return;
      }
      fit();
      render();
      renderDetail();
    } catch {
      if (statusEl)
        statusEl.textContent =
          "Could not load observations right now. See them on iNaturalist.";
    }
  };

  // ---------------------------------------------------------------- wiring
  function toCanvas(e: PointerEvent): [number, number] {
    const r = canvas!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = toCanvas(e);
    if (view === "state" || view === "country") {
      const o = pinAt(x, y);
      if (o) window.open(o.uri, "_blank", "noopener");
    } else {
      const key = regionAt(x, y);
      if (key) openRegion(key);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const [x, y] = toCanvas(e);
    if (view === "state" || view === "country") {
      const o = pinAt(x, y);
      canvas!.style.cursor = o ? "pointer" : "default";
      if (o && tooltip) {
        tooltip.textContent = `${o.name} · ${fmtDate(o.date)}${o.obscured ? " (approx.)" : ""}`;
        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${y}px`;
        tooltip.classList.remove("hidden");
      } else if (tooltip) {
        tooltip.classList.add("hidden");
      }
    } else {
      const key = regionAt(x, y);
      const byKey =
        view === "us" ? countBy((o) => o.state) : countBy((o) => o.country);
      const n = key ? (byKey.get(key) ?? 0) : 0;
      canvas!.style.cursor = n > 0 ? "pointer" : "default";
      if (n > 0 && key && tooltip) {
        const nm =
          view === "us"
            ? (STATE_NAME[key] ?? key)
            : (GEO_COUNTRIES[key]?.name ?? key);
        tooltip.textContent = `${nm} · ${n} obs`;
        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${y}px`;
        tooltip.classList.remove("hidden");
      } else if (tooltip) {
        tooltip.classList.add("hidden");
      }
    }
  });
  canvas.addEventListener("pointerleave", () => {
    if (tooltip) tooltip.classList.add("hidden");
  });

  backBtn?.addEventListener("click", goBack);

  for (const btn of toggleEls) {
    btn.addEventListener("click", () => {
      active = (btn.dataset.herpmapCls as Cls | "all") ?? "all";
      for (const b of toggleEls) {
        const on = b === btn;
        b.setAttribute("aria-pressed", String(on));
        b.classList.toggle("bg-lime-600", on);
        b.classList.toggle("text-white", on);
        b.classList.toggle("border-lime-600", on);
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

  const ro = new ResizeObserver(() => {
    if (!started) return;
    fit();
    render();
  });
  ro.observe(canvas);

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
}
