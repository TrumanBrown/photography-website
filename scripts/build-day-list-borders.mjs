#!/usr/bin/env node
/**
 * Builds the country and state borders drawn over the Day list map, from
 * Natural Earth's 1:10m boundary lines (v5.1.2, public domain).
 *
 *   npm run build:day-list-borders    (downloads ~62 MB to .cache once)
 *
 * Lines stay in degrees, because the map is plate carrée and a degree is the
 * same number of pixels both ways, so nothing is reprojected. There are three
 * levels of detail, each simplified (Douglas-Peucker) to within half a CSS
 * pixel at the closest zoom it's drawn at. Level 0 is one file for the whole
 * world. Levels 1 and 2 are cut into cells (60° and 30°), so a zoomed-in map
 * loads only the part of the world in view.
 *
 * Country borders always show. State and province lines fade in country by
 * country, once that country's states average STATE_PX pixels across on
 * screen, so every country's states arrive at the same apparent size: the
 * US at about 1.2x on a laptop, Mexico at 2x, Germany at 3.4x, and the UK's
 * 232 councils not until 16x. (Natural Earth's own MIN_ZOOM favours the big
 * federations, which left Mexico blank beside a fully drawn US.) Lines
 * between regions, like France's regions as against its departments, go by
 * the size of the regions. Sizes come from the state polygons. A level only
 * carries the lines that can show at its zooms.
 *
 * Natural Earth hands borders over in about 53,000 short fragments, so
 * fragments that meet end to end are joined first; that lets the
 * simplification run across the joins and saves restarting a line at each.
 * Lines are then grouped by kind and the zoom they show from, so the map
 * strokes each group in one go:
 *   kind 0  country border
 *   kind 1  disputed or indefinite border, or a line of control (dashed)
 *   kind 2  state or province border
 * Lease limits, the edges of UN buffer zones, state lines drawn across bays
 * and straits, and a few unrecognised state lines that belong to no country
 * are left out. The one indefinite border
 * over water, the US and Canada through the Strait of Juan de Fuca, is just a
 * water boundary and stays solid.
 *
 * A group is one string: its lines polyline-encoded (Google's algorithm,
 * longitude first) and separated by spaces. Each line's first point is an
 * offset from the last point of the line before, so starting a line costs a
 * few bytes rather than a full coordinate.
 *
 * Output (committed; Prettier skips the folder):
 *   src/lib/hobbies/day-list-borders/index.json     the levels and their cells
 *   src/lib/hobbies/day-list-borders/l0.json
 *   src/lib/hobbies/day-list-borders/l<level>-<col>-<row>.json
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/";
const CACHE = join(root, ".cache/natural-earth");
const OUT = join(root, "src/lib/hobbies/day-list-borders");

const COUNTRIES = "ne_10m_admin_0_boundary_lines_land";
const STATES = "ne_10m_admin_1_states_provinces_lines";
const STATE_SHAPES = "ne_10m_admin_1_states_provinces";

/** How wide, in CSS pixels, a country's average state is when its lines start. */
const STATE_PX = 10;
/** Zooms are rounded to this, which keeps the number of strokes down. */
const ZOOM_STEP = 0.25;
/** Country borders show at every zoom. */
const ALWAYS = -1;
/** The world's width in CSS pixels at the map's widest and closest (64x). */
const MAX_WORLD_PX = 900 * 64;

/**
 * Each level is drawn while a CSS pixel covers at least `from` degrees, and
 * is simplified for the finest end of that range (where the next level takes
 * over). `piece` caps the points per line, so lines that run off screen can
 * be skipped a piece at a time.
 */
const LEVELS = [
  { from: 0.1, precision: 50, piece: 256 },
  { from: 0.025, precision: 100, piece: 128, cell: 60 },
  { from: 0, finest: 360 / MAX_WORLD_PX, precision: 500, piece: 64, cell: 30 },
];

const INTERNATIONAL = "International boundary (verify)";
const DASHED = new Set([
  "Disputed (please verify)",
  "Indefinite (please verify)",
  "Line of control (please verify)",
  "Indeterminant frontier",
  "Unrecognized",
]);
const LEFT_OUT = new Set(["Lease limit", "Overlay limit"]);

async function geojson(name) {
  const file = join(CACHE, `${name}.geojson`);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.log(`Downloading ${name}`);
    const res = await fetch(`${NE}${name}.geojson`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${name}`);
    text = await res.text();
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, text);
  }
  return JSON.parse(text);
}

function* partsOf(geometry) {
  if (!geometry) return;
  if (geometry.type === "LineString") yield geometry.coordinates;
  else if (geometry.type === "MultiLineString") yield* geometry.coordinates;
  else throw new Error(`Unexpected geometry ${geometry.type}`);
}

/** Douglas-Peucker, iterative, keeping both ends. */
function simplify(pts, tolerance) {
  const n = pts.length;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = tolerance * tolerance;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const dx = pts[b][0] - ax;
    const dy = pts[b][1] - ay;
    const len2 = dx * dx + dy * dy;
    let max = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] - ax;
      const py = pts[i][1] - ay;
      const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const d2 = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      if (d2 > max) {
        max = d2;
        at = i;
      }
    }
    if (max > tol2) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Snap to the level's grid and drop points that land on the one before. */
function quantize(pts, precision) {
  const out = [];
  for (const [lon, lat] of pts) {
    const x = Math.round(lon * precision);
    const y = Math.round(lat * precision);
    const last = out[out.length - 1];
    if (!last || last[0] !== x || last[1] !== y) out.push([x, y]);
  }
  return out;
}

function encodeNumber(v) {
  let z = v < 0 ? ~(v << 1) : v << 1;
  let s = "";
  while (z >= 0x20) {
    s += String.fromCharCode((0x20 | (z & 0x1f)) + 63);
    z >>= 5;
  }
  return s + String.fromCharCode(z + 63);
}

function encode(ints, cursor) {
  let s = "";
  for (const [x, y] of ints) {
    s += encodeNumber(x - cursor[0]) + encodeNumber(y - cursor[1]);
    cursor[0] = x;
    cursor[1] = y;
  }
  return s;
}

/**
 * Join fragments that meet end to end, only where exactly two ends meet, so a
 * junction of three borders stays a junction.
 */
function stitch(parts) {
  const key = (p) => `${p[0]},${p[1]}`;
  const ends = new Map();
  parts.forEach((pts, i) => {
    for (const [p, atStart] of [
      [pts[0], true],
      [pts.at(-1), false],
    ]) {
      const k = key(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push({ i, atStart });
    }
  });
  const used = new Uint8Array(parts.length);
  const next = (p) => {
    const list = ends.get(key(p));
    if (!list || list.length !== 2) return null;
    return list.find((e) => !used[e.i]) ?? null;
  };
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain = parts[i];
    for (let e = next(chain.at(-1)); e; e = next(chain.at(-1))) {
      used[e.i] = 1;
      const pts = e.atStart ? parts[e.i] : parts[e.i].toReversed();
      chain = chain.concat(pts.slice(1));
    }
    for (let e = next(chain[0]); e; e = next(chain[0])) {
      used[e.i] = 1;
      const pts = e.atStart ? parts[e.i].toReversed() : parts[e.i];
      chain = pts.slice(0, -1).concat(chain);
    }
    out.push(chain);
  }
  return out;
}

function bboxOf(ints, precision) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of ints) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w / precision, s / precision, e / precision, n / precision];
}

/**
 * Map zoom, where 0 is the world 256 CSS pixels across and each step doubles
 * it: the zoom at which a CSS pixel covers `degPerPx` degrees.
 */
const zoomAt = (degPerPx) => Math.log2(360 / degPerPx / 256);

/** The zoom at which something `km` across at the equator is STATE_PX wide. */
const zoomForSize = (km) =>
  Math.round(Math.log2((STATE_PX * 40075) / km / 256) / ZOOM_STEP) * ZOOM_STEP;

const EARTH_KM = 6371.0088;
const RAD = Math.PI / 180;

/** Area of a lon/lat ring on the sphere, in km². */
function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    a += (x2 - x1) * RAD * (2 + Math.sin(y1 * RAD) + Math.sin(y2 * RAD));
  }
  return Math.abs((a * EARTH_KM * EARTH_KM) / 2);
}

function areaOf(geometry) {
  const polygons =
    geometry?.type === "Polygon"
      ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  let area = 0;
  for (const rings of polygons) {
    rings.forEach((ring, i) => {
      area += (i ? -1 : 1) * ringArea(ring);
    });
  }
  return area;
}

/**
 * A test for land, from the state polygons, which stop at the coast. Natural
 * Earth draws some state lines across bays and straits (Chesapeake Bay, or
 * Valencia to the Balearics), which look like stray marks on open water.
 */
function landTest(features) {
  const polygons = [];
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    for (const rings of g.type === "Polygon"
      ? [g.coordinates]
      : g.coordinates) {
      const [w, s, e, n] = rings[0].reduce(
        (b, [x, y]) => [
          Math.min(b[0], x),
          Math.min(b[1], y),
          Math.max(b[2], x),
          Math.max(b[3], y),
        ],
        [Infinity, Infinity, -Infinity, -Infinity],
      );
      polygons.push({ rings, w, s, e, n });
    }
  }
  // Which polygons reach into each 1° square.
  const grid = new Map();
  polygons.forEach((poly, i) => {
    for (let x = Math.floor(poly.w); x <= Math.floor(poly.e); x++) {
      for (let y = Math.floor(poly.s); y <= Math.floor(poly.n); y++) {
        const key = x * 1000 + y;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
      }
    }
  });
  const inRing = (x, y, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };
  return (x, y) => {
    for (const i of grid.get(Math.floor(x) * 1000 + Math.floor(y)) ?? []) {
      const { rings, w, s, e, n } = polygons[i];
      if (x < w || x > e || y < s || y > n) continue;
      if (
        inRing(x, y, rings[0]) &&
        !rings.slice(1).some((h) => inRing(x, y, h))
      ) {
        return true;
      }
    }
    return false;
  };
}

/** True when most of a line has water on both sides. */
function overWater(pts, onLand) {
  let water = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    // A step of 0.01° (about a kilometre) to each side of the middle.
    const ox = (-(y2 - y1) / len) * 0.01;
    const oy = ((x2 - x1) / len) * 0.01;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    if (!onLand(mx + ox, my + oy) && !onLand(mx - ox, my - oy)) water++;
  }
  return water / Math.max(1, pts.length - 1) > 0.5;
}

/* ------------------------------------------------------------ the lines */

const countries = await geojson(COUNTRIES);
const states = await geojson(STATES);
const shapes = await geojson(STATE_SHAPES);

// Each country's average state, and average region where it has regions.
const sizes = new Map();
for (const f of shapes.features) {
  const { adm0_a3: country, region } = f.properties;
  if (!sizes.has(country)) {
    sizes.set(country, { area: 0, states: 0, regions: new Set() });
  }
  const size = sizes.get(country);
  size.area += areaOf(f.geometry);
  size.states++;
  if (region) size.regions.add(region);
}
const stateZoom = new Map();
for (const [country, size] of sizes) {
  const regions = size.regions.size;
  stateZoom.set(country, {
    state: zoomForSize(Math.sqrt(size.area / size.states)),
    region:
      regions > 1
        ? zoomForSize(Math.sqrt(size.area / regions))
        : zoomForSize(Math.sqrt(size.area / size.states)),
  });
}

const raw = new Map();
const add = (kind, zoom, pts) => {
  const key = `${kind}|${zoom}`;
  if (!raw.has(key)) raw.set(key, { kind, zoom, parts: [] });
  raw.get(key).parts.push(pts);
};
const unknown = new Set();
let fragments = 0;
for (const f of countries.features) {
  const cls = f.properties.FEATURECLA;
  if (LEFT_OUT.has(cls)) continue;
  if (cls !== INTERNATIONAL && !DASHED.has(cls)) unknown.add(cls);
  const overWater =
    cls === "Indefinite (please verify)" &&
    f.properties.TYPE === "Water Indicator";
  const kind = DASHED.has(cls) && !overWater ? 1 : 0;
  for (const pts of partsOf(f.geometry)) {
    add(kind, ALWAYS, pts);
    fragments++;
  }
}
if (unknown.size) {
  throw new Error(
    `New kinds of country border to sort: ${[...unknown].join(", ")}`,
  );
}
const onLand = landTest(shapes.features);
let orphans = 0;
let wet = 0;
for (const f of states.features) {
  const zooms = stateZoom.get(f.properties.ADM0_A3);
  if (!zooms) {
    orphans++;
    continue;
  }
  const zoom =
    f.properties.FEATURECLA === "Admin-1 region boundary"
      ? zooms.region
      : zooms.state;
  for (const pts of partsOf(f.geometry)) {
    if (overWater(pts, onLand)) {
      wet++;
      continue;
    }
    add(2, zoom, pts);
    fragments++;
  }
}
if (orphans > 10) {
  throw new Error(`${orphans} state lines belong to no country with states`);
}
const lines = [];
for (const { kind, zoom, parts } of raw.values()) {
  for (const pts of stitch(parts)) lines.push({ kind, zoom, pts });
}
console.log(
  `${fragments} fragments joined into ${lines.length} lines ` +
    `(left out: ${orphans} with no country, ${wet} over water)`,
);
for (const country of ["USA", "MEX", "DEU", "FRA", "GBR"]) {
  const z = stateZoom.get(country);
  console.log(`  ${country} states from zoom ${z.state}, regions ${z.region}`);
}

/* ----------------------------------------------------------- the levels */

// Files are overwritten in place, and only the ones this build no longer
// makes are deleted at the end. Deleting the whole folder loses the dev
// server's watch on it, and it then keeps serving the old lines.
mkdirSync(OUT, { recursive: true });
const written = new Set(["index.json"]);

/** Z-order of a point on a 1024 x 512 grid, so nearby lines sit together. */
function zOrder([x, y], precision) {
  const gx = Math.min(1023, Math.floor(((x / precision + 180) / 360) * 1024));
  const gy = Math.min(511, Math.floor(((90 - y / precision) / 180) * 512));
  let z = 0;
  for (let bit = 0; bit < 10; bit++) {
    z |= ((gx >> bit) & 1) << (2 * bit);
    z |= ((gy >> bit) & 1) << (2 * bit + 1);
  }
  return z;
}

/** One string per kind and zoom, lines in the order given. */
function groupsOf(pieces) {
  const byKey = new Map();
  for (const p of pieces) {
    const key = `${p.kind}|${p.zoom}`;
    if (!byKey.has(key)) {
      byKey.set(key, { kind: p.kind, zoom: p.zoom, cursor: [0, 0], lines: [] });
    }
    const group = byKey.get(key);
    group.lines.push(encode(p.ints, group.cursor));
  }
  return [...byKey.values()]
    .sort((a, b) => a.kind - b.kind || a.zoom - b.zoom)
    .map((g) => [g.kind, g.zoom, g.lines.join(" ")]);
}

function write(name, precision, pieces) {
  const body = JSON.stringify({ precision, groups: groupsOf(pieces) });
  writeFileSync(join(OUT, `${name}.json`), body);
  written.add(`${name}.json`);
  return { bytes: body.length, gzip: gzipSync(body, { level: 9 }).length };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

const index = {
  source:
    "Natural Earth 1:10m, admin 0 boundary lines (land) and admin 1 states and provinces lines, v5.1.2",
  levels: [],
};

for (let i = 0; i < LEVELS.length; i++) {
  const level = LEVELS[i];
  const finest = level.finest ?? level.from;
  const tolerance = finest / 2;
  const maxZoom = zoomAt(finest);
  const kept = [];
  let points = 0;
  for (const line of lines) {
    if (line.zoom > maxZoom) continue;
    const ints = quantize(simplify(line.pts, tolerance), level.precision);
    if (ints.length < 2) continue;
    const [w, s, e, n] = bboxOf(ints, level.precision);
    // Shorter than the level can draw.
    if (Math.max(e - w, n - s) < tolerance) continue;
    const pieces = [];
    for (let start = 0; start < ints.length - 1; start += level.piece - 1) {
      const part = ints.slice(start, start + level.piece);
      pieces.push({
        kind: line.kind,
        zoom: line.zoom,
        ints: part,
        bbox: bboxOf(part, level.precision),
      });
      points += part.length;
    }
    kept.push({ order: zOrder(ints[0], level.precision), pieces });
  }
  kept.sort((a, b) => a.order - b.order);
  const pieces = kept.flatMap((k) => k.pieces);

  const entry = {
    from: level.from,
    precision: level.precision,
    maxZoom: Math.round(maxZoom * 100) / 100,
  };
  let bytes = 0;
  let gzip = 0;
  let note = "";
  if (!level.cell) {
    ({ bytes, gzip } = write(`l${i}`, level.precision, pieces));
    entry.file = `l${i}`;
  } else {
    const cells = new Map();
    for (const p of pieces) {
      const cx = (p.bbox[0] + p.bbox[2]) / 2;
      const cy = (p.bbox[1] + p.bbox[3]) / 2;
      const col = Math.min(
        360 / level.cell - 1,
        Math.floor((cx + 180) / level.cell),
      );
      const row = Math.min(
        180 / level.cell - 1,
        Math.floor((90 - cy) / level.cell),
      );
      const key = `${col}-${row}`;
      if (!cells.has(key)) cells.set(key, { col, row, pieces: [] });
      cells.get(key).pieces.push(p);
    }
    entry.cell = level.cell;
    entry.cells = [];
    const sizes = [];
    for (const { col, row, pieces: inCell } of [...cells.values()].sort(
      (a, b) => a.row - b.row || a.col - b.col,
    )) {
      const size = write(`l${i}-${col}-${row}`, level.precision, inCell);
      bytes += size.bytes;
      gzip += size.gzip;
      sizes.push(size.gzip);
      // Pieces can reach past their cell, so the map tests the lines' own box.
      const box = inCell.reduce(
        (b, p) => [
          Math.min(b[0], p.bbox[0]),
          Math.min(b[1], p.bbox[1]),
          Math.max(b[2], p.bbox[2]),
          Math.max(b[3], p.bbox[3]),
        ],
        [Infinity, Infinity, -Infinity, -Infinity],
      );
      entry.cells.push([
        col,
        row,
        ...box.map((v, j) =>
          j < 2 ? Math.floor(v * 100) / 100 : Math.ceil(v * 100) / 100,
        ),
      ]);
    }
    sizes.sort((a, b) => b - a);
    note = `, ${cells.size} cells (largest ${sizes.slice(0, 3).map(kb).join(", ")} gzipped)`;
  }
  index.levels.push(entry);
  console.log(
    `Level ${i}: within ${tolerance.toFixed(4)}°, zoom to ${maxZoom.toFixed(2)}, ` +
      `${pieces.length} pieces, ${points} points, ${kb(bytes)} (${kb(gzip)} gzipped)${note}`,
  );
}

// One cell per line, so the index stays readable.
const pretty = JSON.stringify(
  index,
  (key, value) =>
    key === "cells" ? value.map((c) => `@@${JSON.stringify(c)}@@`) : value,
  2,
).replace(/"@@(.*?)@@"/g, "$1");
writeFileSync(join(OUT, "index.json"), `${pretty}\n`);
for (const file of readdirSync(OUT)) {
  if (!written.has(file)) rmSync(join(OUT, file));
}
console.log(`Wrote ${OUT}`);
