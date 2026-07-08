/**
 * "Reptiles & Amphibians" map — a real geographic map of the author's iNaturalist
 * herp observations, the personal counterpart to the road-cruise game.
 *
 * It fetches the user's Reptilia and Amphibia observations from the public iNat
 * API and draws them two ways on a canvas:
 *   - Overview: a real US map (state outlines projected from committed public-
 *     domain geometry, plus a Hawaii inset) with a HEAT MAP of the true
 *     observation coordinates. Denser areas glow hotter (e.g. more reptiles in
 *     eastern Washington). Click a state that has data to zoom in.
 *   - State view: that state's real outline blown up, with a PIN at every
 *     observation's true (or iNat-obscured) coordinate. A grid below lists each
 *     observation with its species, place, and date before you click through.
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

/** iNat place ids for US states (admin_level 10). Used to bucket observations. */
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

interface StateGeo {
  name: string;
  bbox: [number, number, number, number];
  rings: [number, number][][];
}
const GEO = (geoData as unknown as { states: Record<string, StateGeo> }).states;

type Cls = "reptiles" | "amphibians";
type View = "overview" | "state";

/** Class-coded pin/heat colors. */
const CLS_COLOR: Record<Cls, string> = {
  reptiles: "#f59e0b",
  amphibians: "#38bdf8",
};

interface Obs {
  id: number;
  uri: string;
  cls: Cls;
  state: string | null;
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

  // CONUS bbox = union of all states except AK/HI/PR (inset or omitted).
  const CONUS_SKIP = new Set(["AK", "HI", "PR"]);
  const conus: [number, number, number, number] = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
  ];
  for (const [abbr, g] of Object.entries(GEO)) {
    if (CONUS_SKIP.has(abbr)) continue;
    conus[0] = Math.min(conus[0], g.bbox[0]);
    conus[1] = Math.min(conus[1], g.bbox[1]);
    conus[2] = Math.max(conus[2], g.bbox[2]);
    conus[3] = Math.max(conus[3], g.bbox[3]);
  }

  let all: Obs[] = [];
  let active: Cls | "all" = "all";
  let selected: string | null = null;
  let view: View = "overview";
  let started = false;
  let W = 0;
  let H = 0;
  let dpr = 1;

  // Per-render caches for hit-testing.
  let statePolys: { abbr: string; pts: [number, number][][] }[] = [];
  let pinHits: { x: number; y: number; o: Obs }[] = [];
  let hiInset: { x: number; y: number; w: number; h: number } | null = null;

  function pool(): Obs[] {
    return active === "all" ? all : all.filter((o) => o.cls === active);
  }
  function counts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const o of pool())
      if (o.state) m.set(o.state, (m.get(o.state) ?? 0) + 1);
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
    g: StateGeo,
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

  /** Heatmap: accumulate alpha blobs offscreen, then colorize by density. */
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
    within: [number, number, number, number] | null,
    offX = 0,
    offY = 0,
  ): {
    heat: { x: number; y: number }[];
    pins: { x: number; y: number; o: Obs }[];
  } {
    const heat: { x: number; y: number }[] = [];
    const pins: { x: number; y: number; o: Obs }[] = [];
    for (const o of pool()) {
      if (o.lng == null || o.lat == null) continue;
      if (
        within &&
        (o.lng < within[0] ||
          o.lng > within[2] ||
          o.lat < within[1] ||
          o.lat > within[3])
      )
        continue;
      const [px, py] = project(o.lng, o.lat);
      const x = px + offX;
      const y = py + offY;
      heat.push({ x, y });
      pins.push({ x, y, o });
    }
    return { heat, pins };
  }

  function renderOverview(): void {
    ctx!.clearRect(0, 0, W, H);
    ctx!.fillStyle = "#0b1220";
    ctx!.fillRect(0, 0, W, H);
    statePolys = [];
    pinHits = [];

    const cnt = counts();
    const project = makeProjection(conus, W, H, 16);
    for (const [abbr, g] of Object.entries(GEO)) {
      if (CONUS_SKIP.has(abbr)) continue;
      const n = cnt.get(abbr) ?? 0;
      const fill = n > 0 ? "rgba(56,80,60,0.9)" : "rgba(30,41,59,0.9)";
      const pr = drawRings(g, project, fill, "rgba(120,140,120,0.4)", 0.6);
      statePolys.push({ abbr, pts: pr });
    }
    const { heat } = projectedPoints(project, conus);
    drawHeat(heat, Math.max(14, W * 0.03));

    // Hawaii inset (bottom-left) — HI has data for this user.
    const hg = GEO.HI;
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
      const hiPts = projectedPoints(
        makeProjection(hg.bbox, iw, ih, 8),
        hg.bbox,
        ix,
        iy,
      );
      drawHeat(hiPts.heat, Math.max(10, iw * 0.12));
      ctx!.strokeStyle = "rgba(120,140,120,0.5)";
      ctx!.lineWidth = 1;
      ctx!.strokeRect(ix, iy, iw, ih);
      ctx!.fillStyle = "rgba(200,210,220,0.8)";
      ctx!.font = "600 10px system-ui, sans-serif";
      ctx!.fillText("HI", ix + 6, iy + 14);
    } else {
      hiInset = null;
    }

    ctx!.fillStyle = "rgba(200,210,220,0.7)";
    ctx!.font = "600 12px system-ui, sans-serif";
    ctx!.fillText("Tap a highlighted state to zoom in", 14, 22);
  }

  function renderState(abbr: string): void {
    ctx!.clearRect(0, 0, W, H);
    ctx!.fillStyle = "#0b1220";
    ctx!.fillRect(0, 0, W, H);
    pinHits = [];
    statePolys = [];
    const g = GEO[abbr];
    if (!g) return;
    const project = makeProjection(g.bbox, W, H, 24);
    drawRings(g, project, "rgba(26,38,28,0.95)", "rgba(150,170,150,0.6)", 1.2);

    const { heat, pins } = projectedPoints(project, g.bbox);
    drawHeat(heat, Math.max(18, W * 0.05));

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

    ctx!.fillStyle = "rgba(230,235,240,0.95)";
    ctx!.font = "600 14px system-ui, sans-serif";
    ctx!.fillText(STATE_NAME[abbr] ?? abbr, 14, 22);

    const legend: [Cls, string][] = [
      ["reptiles", "Reptiles"],
      ["amphibians", "Amphibians"],
    ];
    let lx = 14;
    const ly = H - 14;
    for (const [cls, label] of legend) {
      ctx!.beginPath();
      ctx!.arc(lx + 5, ly - 4, 4.5, 0, Math.PI * 2);
      ctx!.fillStyle = CLS_COLOR[cls];
      ctx!.fill();
      ctx!.strokeStyle = "rgba(255,255,255,0.9)";
      ctx!.lineWidth = 1;
      ctx!.stroke();
      ctx!.fillStyle = "rgba(210,220,228,0.9)";
      ctx!.font = "500 11px system-ui, sans-serif";
      ctx!.fillText(label, lx + 14, ly);
      lx += 14 + ctx!.measureText(label).width + 16;
    }
  }

  function render(): void {
    if (view === "state" && selected) renderState(selected);
    else renderOverview();
    if (backBtn) backBtn.classList.toggle("hidden", view !== "state");
  }

  function pointInPoly(
    x: number,
    y: number,
    poly: [number, number][],
  ): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  }

  function stateAt(x: number, y: number): string | null {
    if (
      hiInset &&
      x >= hiInset.x &&
      x <= hiInset.x + hiInset.w &&
      y >= hiInset.y &&
      y <= hiInset.y + hiInset.h
    )
      return "HI";
    for (const sp of statePolys) {
      for (const poly of sp.pts) if (pointInPoly(x, y, poly)) return sp.abbr;
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

  function openState(abbr: string): void {
    if (!(counts().get(abbr) ?? 0)) return;
    selected = abbr;
    view = "state";
    render();
    renderDetail();
  }

  function renderDetail(): void {
    if (!detailEl) return;
    const inState = view === "state" && !!selected;
    const items = inState ? pool().filter((o) => o.state === selected) : [];
    if (statusEl) {
      if (inState) {
        statusEl.textContent = "";
      } else {
        const cnt = counts();
        const states = cnt.size;
        const mapped = pool().filter((o) => o.lng != null).length;
        statusEl.textContent = states
          ? `${pool().length} observations across ${states} state${states === 1 ? "" : "s"} (${mapped} mapped). Tap a highlighted state to zoom in.`
          : "";
      }
    }
    if (!inState || items.length === 0) {
      detailEl.replaceChildren();
      return;
    }
    const head = document.createElement("h3");
    head.className = "mb-3 text-sm font-semibold";
    head.textContent = `${STATE_NAME[selected!]} — ${items.length} observation${items.length === 1 ? "" : "s"}`;

    const grid = document.createElement("div");
    grid.className = "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3";
    grid.setAttribute("role", "list");
    for (const o of items) {
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
        out.push({
          id: o.id,
          uri: o.uri || `https://www.inaturalist.org/observations/${o.id}`,
          cls,
          state: stateOf(o),
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
    if (view === "state") {
      const o = pinAt(x, y);
      if (o) window.open(o.uri, "_blank", "noopener");
    } else {
      const abbr = stateAt(x, y);
      if (abbr) openState(abbr);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const [x, y] = toCanvas(e);
    if (view === "state") {
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
      const abbr = stateAt(x, y);
      const has = abbr && (counts().get(abbr) ?? 0) > 0;
      canvas!.style.cursor = has ? "pointer" : "default";
      if (has && tooltip) {
        tooltip.textContent = `${STATE_NAME[abbr!]} · ${counts().get(abbr!)} obs`;
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

  backBtn?.addEventListener("click", () => {
    view = "overview";
    selected = null;
    render();
    renderDetail();
  });

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
      if (view === "state" && selected && !(counts().get(selected) ?? 0)) {
        view = "overview";
        selected = null;
      }
      render();
      renderDetail();
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
