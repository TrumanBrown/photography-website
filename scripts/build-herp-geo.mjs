#!/usr/bin/env node
/**
 * Build committed US state boundary geometry for the Herping iNaturalist map.
 *
 * Downloads a public-domain US states GeoJSON once, simplifies each state's
 * outline (Douglas–Peucker) to keep the file small, and writes lon/lat polygon
 * rings + a bounding box per state to src/lib/hobbies/herp-geo.json. The runtime
 * ([src/lib/hobbies/inat-herp-map.ts]) projects those rings to screen space and
 * plots real iNaturalist observation coordinates on top (heatmap + pins). No map
 * tiles and no runtime geo fetch — same "bake and commit" approach as the
 * fishing island, so nothing changes in the CSP.
 *
 * Run: node scripts/build-herp-geo.mjs   (downloads ~2MB to .cache once)
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";

const SOURCE =
  "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json";
const CACHE = ".cache/us-states.json";
const OUT = "src/lib/hobbies/herp-geo.json";
const TOLERANCE = 0.035; // degrees (~3-4km) — smooth but compact

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

function ringsFromGeometry(geom) {
  const polys =
    geom.type === "Polygon"
      ? [geom.coordinates]
      : geom.type === "MultiPolygon"
        ? geom.coordinates
        : [];
  const out = [];
  for (const poly of polys) {
    // outer ring only (index 0); holes are rare for states and not needed here
    const ring = poly[0];
    if (!ring || ring.length < 4) continue;
    const simplified = simplify(ring, TOLERANCE).map(round);
    if (simplified.length >= 3) out.push(simplified);
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

async function main() {
  await mkdir(".cache", { recursive: true });
  let raw;
  if (await exists(CACHE)) {
    raw = JSON.parse(await readFile(CACHE, "utf8"));
  } else {
    process.stdout.write("Fetching US states GeoJSON … ");
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
    await writeFile(CACHE, JSON.stringify(raw));
    console.log("done.");
  }

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

  const payload = {
    $comment:
      "Committed US state outlines (lon/lat rings + bbox), simplified from public-domain us-states.json by scripts/build-herp-geo.mjs. Used by the herping iNaturalist map to draw a real map and plot true observation coordinates. No runtime geo fetch.",
    generated: new Date().toISOString(),
    tolerance: TOLERANCE,
    states,
  };
  await writeFile(OUT, JSON.stringify(payload) + "\n");
  const kb = ((await readFile(OUT)).length / 1024).toFixed(0);
  console.log(
    `Wrote ${OUT}: ${Object.keys(states).length} states, ${totalPts} points, ${kb}KB.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
