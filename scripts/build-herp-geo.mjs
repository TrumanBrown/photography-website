#!/usr/bin/env node
/**
 * Build committed boundary geometry for the Herping iNaturalist map.
 *
 * Downloads two public-domain GeoJSON sources once:
 *   - US states (for the US drill-down: overview + per-state zoom), and
 *   - world countries (Natural Earth 110m admin_0, for the world overview +
 *     per-country zoom).
 * It simplifies each outline (Douglas–Peucker) to keep the file small, and
 * writes lon/lat polygon rings + a bounding box per state and per country to
 * src/lib/hobbies/herp-geo.json. The runtime
 * ([src/lib/hobbies/inat-herp-map.ts]) projects those rings to screen space and
 * plots real iNaturalist observation coordinates on top (heatmap + pins). No map
 * tiles and no runtime geo fetch — same "bake and commit" approach as the
 * fishing island, so nothing changes in the CSP.
 *
 * Run: node scripts/build-herp-geo.mjs   (downloads a few MB to .cache once)
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";

const SOURCE =
  "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json";
const WORLD_SOURCE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
const CACHE = ".cache/us-states.json";
const WORLD_CACHE = ".cache/ne-110m-countries.json";
const OUT = "src/lib/hobbies/herp-geo.json";
const TOLERANCE = 0.035; // degrees (~3-4km) — smooth US states
const WORLD_TOLERANCE = 0.25; // coarser — countries only need to read at world scale

const ABBR = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  "District of Columbia": "DC",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
  "Puerto Rico": "PR",
};

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Perpendicular distance from point p to segment a-b (in lon/lat units). */
function segDist(p, a, b) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas–Peucker line simplification. */
function simplify(points, tol) {
  if (points.length < 3) return points;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segDist(points[i], points[0], points[points.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > tol) {
    const left = simplify(points.slice(0, idx + 1), tol);
    const right = simplify(points.slice(idx), tol);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}

/** Round to 3 decimals (~100m) to shrink the JSON. */
function round(pt) {
  return [Math.round(pt[0] * 1000) / 1000, Math.round(pt[1] * 1000) / 1000];
}

function ringsFromGeometry(geom, tol = TOLERANCE, minRingLen = 0) {
  const polys =
    geom.type === "Polygon"
      ? [geom.coordinates]
      : geom.type === "MultiPolygon"
        ? geom.coordinates
        : [];
  const out = [];
  for (const poly of polys) {
    // outer ring only (index 0); holes aren't needed for these fills/hit-tests
    const ring = poly[0];
    if (!ring || ring.length < 4) continue;
    const simplified = simplify(ring, tol).map(round);
    if (simplified.length >= 3 && simplified.length >= minRingLen)
      out.push(simplified);
  }
  return out;
}

function bboxOf(rings) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLon, minLat, maxLon, maxLat].map(
    (v) => Math.round(v * 1000) / 1000,
  );
}

async function cachedJson(cachePath, url, label) {
  if (await exists(cachePath))
    return JSON.parse(await readFile(cachePath, "utf8"));
  process.stdout.write(`Fetching ${label} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  await writeFile(cachePath, JSON.stringify(json));
  console.log("done.");
  return json;
}

async function main() {
  await mkdir(".cache", { recursive: true });
  const raw = await cachedJson(CACHE, SOURCE, "US states GeoJSON");

  const states = {};
  let totalPts = 0;
  for (const f of raw.features ?? []) {
    const name = f.properties?.name || f.properties?.NAME;
    const abbr = ABBR[name];
    if (!abbr) continue;
    const rings = ringsFromGeometry(f.geometry);
    if (rings.length === 0) continue;
    totalPts += rings.reduce((n, r) => n + r.length, 0);
    states[abbr] = { name, bbox: bboxOf(rings), rings };
  }

  // World countries (Natural Earth 110m admin_0) for the world overview.
  const world = await cachedJson(
    WORLD_CACHE,
    WORLD_SOURCE,
    "world countries GeoJSON",
  );
  const countries = {};
  let countryPts = 0;
  for (const f of world.features ?? []) {
    const p = f.properties ?? {};
    const name = p.ADMIN || p.NAME || p.NAME_LONG;
    // ISO_A2_EH resolves cases Natural Earth marks "-99" in ISO_A2 (France, etc.).
    let iso = p.ISO_A2_EH && p.ISO_A2_EH !== "-99" ? p.ISO_A2_EH : p.ISO_A2;
    if (!iso || iso === "-99") iso = (name || "").slice(0, 2).toUpperCase();
    if (!name || name === "Antarctica") continue;
    // Drop tiny slivers of huge multipolygons at world scale to save space.
    const rings = ringsFromGeometry(f.geometry, WORLD_TOLERANCE, 4);
    if (rings.length === 0) continue;
    countryPts += rings.reduce((n, r) => n + r.length, 0);
    countries[iso] = { name, bbox: bboxOf(rings), rings };
  }

  const payload = {
    $comment:
      "Committed boundary geometry (lon/lat rings + bbox) for the herping iNaturalist map: `states` = US states (from public-domain us-states.json), `countries` = world countries keyed by ISO A2 (from Natural Earth 110m admin_0). Simplified/committed by scripts/build-herp-geo.mjs. The runtime draws a real map and plots real observation coordinates on top. No runtime geo fetch.",
    generated: new Date().toISOString(),
    tolerance: TOLERANCE,
    worldTolerance: WORLD_TOLERANCE,
    states,
    countries,
  };
  await writeFile(OUT, JSON.stringify(payload) + "\n");
  const kb = ((await readFile(OUT)).length / 1024).toFixed(0);
  console.log(
    `Wrote ${OUT}: ${Object.keys(states).length} states (${totalPts} pts), ${Object.keys(countries).length} countries (${countryPts} pts), ${kb}KB.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
