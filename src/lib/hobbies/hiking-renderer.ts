import {
  TERRAIN_X,
  biomeById,
  calculateHikeStats,
  terrainElevationAt,
  type HikeState,
  type PlacedFeature,
} from "./hiking-model";

export interface HikeRenderOptions {
  width: number;
  height: number;
  mode: "builder" | "postcard";
  now?: number;
  hikerProgress?: number | null;
  activeAnchor?: number | null;
  hoveredAnchor?: number | null;
}

interface SceneColors {
  skyTop: string;
  skyBottom: string;
  far: string;
  middle: string;
  ground: string;
  groundLight: string;
  route: string;
  water: string;
  accent: string;
  tree: string;
  treeLight: string;
  snow: string;
}

interface Point {
  x: number;
  y: number;
}

const TERRAIN_BASELINE = 0.87;
const TERRAIN_RELIEF = 0.62;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) =>
      clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0"),
    )
    .join("")}`;
}

function mix(first: string, second: string, amount: number): string {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  return rgbToHex(
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  );
}

function shade(color: string, amount: number): string {
  return mix(color, amount >= 0 ? "#ffffff" : "#000000", Math.abs(amount));
}

function rgba(color: string, alpha: number): string {
  const [red, green, blue] = hexToRgb(color);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function makeRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function ridgeElevationAt(state: HikeState, normalizedX: number): number {
  const x = clamp(normalizedX, TERRAIN_X[0], TERRAIN_X[TERRAIN_X.length - 1]);
  const base = terrainElevationAt(state.terrain, x);
  for (let index = 0; index < TERRAIN_X.length - 1; index += 1) {
    const left = TERRAIN_X[index];
    const right = TERRAIN_X[index + 1];
    if (x <= right) {
      const local = (x - left) / (right - left);
      const envelope = Math.sin(local * Math.PI);
      const phase = (state.seed % 997) * 0.013 + index * 1.7;
      const crags =
        Math.sin(local * Math.PI * 5 + phase) * 0.014 +
        Math.sin(local * Math.PI * 11 + phase * 0.7) * 0.006;
      return clamp(base + crags * envelope, 0.06, 0.99);
    }
  }
  return base;
}

export function terrainElevationFromCanvasY(y: number, height: number): number {
  return clamp((TERRAIN_BASELINE - y / height) / TERRAIN_RELIEF, 0.08, 0.96);
}

function colorsFor(state: HikeState): SceneColors {
  const source = biomeById(state.biome).palette;
  let skyTop = source.skyTop;
  let skyBottom = source.skyBottom;
  let ground = source.ground;
  let groundLight = source.groundLight;
  let middle = source.middle;
  let tree = mix(source.ground, "#153828", 0.52);
  let treeLight = mix(source.groundLight, "#6b8b4d", 0.28);

  if (state.season === "spring") {
    groundLight = mix(groundLight, "#5e8b50", 0.38);
    treeLight = mix(treeLight, "#83a64a", 0.35);
  } else if (state.season === "autumn") {
    groundLight = mix(groundLight, "#a26738", 0.48);
    middle = mix(middle, "#76593e", 0.28);
    tree = mix(tree, "#6f492e", 0.44);
    treeLight = mix(treeLight, "#c78235", 0.58);
  } else if (state.season === "winter") {
    ground = mix(ground, "#627078", 0.38);
    groundLight = mix(groundLight, "#a9b5b7", 0.56);
    middle = mix(middle, "#86949c", 0.42);
    tree = mix(tree, "#32464a", 0.35);
    treeLight = mix(treeLight, "#7f9391", 0.42);
  }

  if (state.light === "dawn") {
    skyTop = mix(skyTop, "#6f668f", 0.48);
    skyBottom = mix(skyBottom, "#ef9f87", 0.58);
    ground = shade(ground, -0.2);
    middle = mix(middle, "#69647b", 0.32);
  } else if (state.light === "day") {
    skyTop = mix(skyTop, "#78b6d3", 0.4);
    skyBottom = mix(skyBottom, "#edf3e9", 0.45);
  } else {
    skyTop = mix(skyTop, "#5a7391", 0.25);
    skyBottom = mix(skyBottom, "#f1b36f", 0.66);
    groundLight = mix(groundLight, "#a56c3d", 0.25);
  }

  return {
    skyTop,
    skyBottom,
    far: source.far,
    middle,
    ground,
    groundLight,
    route: source.route,
    water: source.water,
    accent: source.accent,
    tree,
    treeLight,
    snow: state.light === "golden" ? "#fff2d8" : "#edf4f2",
  };
}

export function pointOnTrail(
  state: HikeState,
  normalizedX: number,
  width: number,
  height: number,
): Point {
  const x = clamp(normalizedX, 0.04, 0.96);
  const elevation = ridgeElevationAt(state, x);
  return {
    x: x * width,
    y: height * (TERRAIN_BASELINE - elevation * TERRAIN_RELIEF),
  };
}

export function terrainAnchorPoint(
  state: HikeState,
  index: number,
  width: number,
  height: number,
): Point {
  return pointOnTrail(state, TERRAIN_X[index], width, height);
}

function traceTerrain(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  width: number,
  height: number,
): void {
  const steps = 96;
  const first = pointOnTrail(state, 0.02, width, height);
  ctx.moveTo(0, first.y);
  for (let step = 0; step <= steps; step += 1) {
    const x = 0.02 + (step / steps) * 0.96;
    const point = pointOnTrail(state, x, width, height);
    ctx.lineTo(point.x, point.y);
  }
  const last = pointOnTrail(state, 0.98, width, height);
  ctx.lineTo(width, last.y);
}

function drawSky(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  colors: SceneColors,
  width: number,
  height: number,
): void {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, colors.skyTop);
  sky.addColorStop(0.7, colors.skyBottom);
  sky.addColorStop(1, shade(colors.skyBottom, -0.04));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const sunX =
    state.light === "dawn"
      ? width * 0.2
      : state.light === "golden"
        ? width * 0.78
        : width * 0.68;
  const sunY = state.light === "day" ? height * 0.14 : height * 0.25;
  const radius =
    Math.min(width, height) * (state.light === "day" ? 0.055 : 0.075);
  const glow = ctx.createRadialGradient(
    sunX,
    sunY,
    0,
    sunX,
    sunY,
    radius * 3.5,
  );
  glow.addColorStop(
    0,
    state.light === "day" ? "rgba(255,249,207,0.95)" : "rgba(255,216,147,0.92)",
  );
  glow.addColorStop(
    0.25,
    state.light === "day" ? "rgba(255,245,196,0.32)" : "rgba(255,180,105,0.28)",
  );
  glow.addColorStop(1, "rgba(255,200,130,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(sunX - radius * 4, sunY - radius * 4, radius * 8, radius * 8);
  ctx.fillStyle = state.light === "day" ? "#fff8ce" : "#ffd394";
  ctx.beginPath();
  ctx.arc(sunX, sunY, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawSunShafts(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  width: number,
  height: number,
): void {
  const sunX =
    state.light === "dawn"
      ? width * 0.2
      : state.light === "golden"
        ? width * 0.78
        : width * 0.68;
  const sunY = state.light === "day" ? height * 0.14 : height * 0.25;
  const random = makeRng(state.seed + 433);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let index = 0; index < 5; index += 1) {
    const endX = width * (0.08 + random() * 0.84);
    const endY = height * (0.62 + random() * 0.24);
    const halfWidth = width * (0.035 + random() * 0.045);
    const gradient = ctx.createLinearGradient(sunX, sunY, endX, endY);
    gradient.addColorStop(
      0,
      state.light === "dawn"
        ? "rgba(255,208,173,0.11)"
        : "rgba(255,236,187,0.1)",
    );
    gradient.addColorStop(0.55, "rgba(255,235,192,0.035)");
    gradient.addColorStop(1, "rgba(255,235,192,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(sunX, sunY);
    ctx.lineTo(endX - halfWidth, endY);
    ctx.lineTo(endX + halfWidth, endY);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawCloud(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  alpha: number,
): void {
  const height = width * 0.24;
  ctx.fillStyle = `rgba(248, 247, 235, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, width * 0.33, height * 0.5, 0, 0, Math.PI * 2);
  ctx.ellipse(
    x - width * 0.25,
    y + height * 0.08,
    width * 0.28,
    height * 0.42,
    0,
    0,
    Math.PI * 2,
  );
  ctx.ellipse(
    x + width * 0.26,
    y + height * 0.1,
    width * 0.31,
    height * 0.4,
    0,
    0,
    Math.PI * 2,
  );
  ctx.ellipse(
    x - width * 0.03,
    y - height * 0.22,
    width * 0.25,
    height * 0.48,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

function drawClouds(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  width: number,
  height: number,
  now: number,
  detailed: boolean,
): void {
  if (state.weather === "clear") return;
  const random = makeRng(state.seed + 311);
  const count =
    state.weather === "mist" ? (detailed ? 12 : 7) : detailed ? 9 : 5;
  for (let index = 0; index < count; index += 1) {
    const baseX = random() * 1.2 - 0.1;
    const speed = 0.0000015 + random() * 0.000002;
    const normalizedX = ((baseX + now * speed) % 1.22) - 0.11;
    const y =
      height * (0.1 + random() * (state.weather === "mist" ? 0.48 : 0.3));
    const cloudWidth =
      width * (0.08 + random() * (state.weather === "mist" ? 0.12 : 0.08));
    drawCloud(
      ctx,
      normalizedX * width,
      y,
      cloudWidth,
      state.weather === "mist" ? 0.2 : 0.34,
    );
  }
}

function drawRange(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  width: number,
  height: number,
  base: number,
  amplitude: number,
  color: string,
  seedOffset: number,
): void {
  const random = makeRng(state.seed + seedOffset);
  const points = 18;
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(0, height * base);
  for (let index = 0; index <= points; index += 1) {
    const x = index / points;
    const shifted = clamp(
      x * 0.86 + 0.07 + (seedOffset % 3) * 0.02,
      0.04,
      0.96,
    );
    const elevation = terrainElevationAt(state.terrain, shifted);
    const roughness = (random() - 0.5) * 0.045;
    ctx.lineTo(x * width, height * (base - elevation * amplitude + roughness));
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawKarstPillars(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  colors: SceneColors,
  width: number,
  height: number,
  detailed: boolean,
): void {
  const random = makeRng(state.seed + 772);
  const count = detailed ? 15 : 10;
  for (let index = 0; index < count; index += 1) {
    const center =
      ((index + 0.5) / count) * width + (random() - 0.5) * width * 0.04;
    const pillarWidth = width * (0.025 + random() * 0.025);
    const top = height * (0.19 + random() * 0.27);
    const bottom = height * 0.71;
    const gradient = ctx.createLinearGradient(
      center - pillarWidth,
      0,
      center + pillarWidth,
      0,
    );
    gradient.addColorStop(0, shade(colors.far, -0.16));
    gradient.addColorStop(0.7, colors.far);
    gradient.addColorStop(1, shade(colors.far, 0.09));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(center - pillarWidth * 0.6, bottom);
    ctx.bezierCurveTo(
      center - pillarWidth * 0.75,
      top + height * 0.1,
      center - pillarWidth * 0.55,
      top,
      center,
      top,
    );
    ctx.bezierCurveTo(
      center + pillarWidth * 0.7,
      top,
      center + pillarWidth * 0.8,
      top + height * 0.14,
      center + pillarWidth * 0.58,
      bottom,
    );
    ctx.closePath();
    ctx.fill();
  }
}

function drawBackgroundRanges(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  colors: SceneColors,
  width: number,
  height: number,
  detailed: boolean,
): void {
  if (state.biome === "karst") {
    drawKarstPillars(ctx, state, colors, width, height, detailed);
  } else {
    drawRange(
      ctx,
      state,
      width,
      height,
      0.64,
      0.23,
      rgba(colors.far, 0.72),
      19,
    );
  }
  drawRange(ctx, state, width, height, 0.73, 0.33, colors.middle, 47);

  if (state.biome === "fjord") {
    const water = ctx.createLinearGradient(0, height * 0.59, 0, height * 0.8);
    water.addColorStop(0, shade(colors.water, 0.22));
    water.addColorStop(1, colors.water);
    ctx.fillStyle = water;
    ctx.fillRect(0, height * 0.61, width, height * 0.2);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = detailed ? 2 : 1;
    for (let index = 0; index < 7; index += 1) {
      const y = height * (0.64 + index * 0.018);
      ctx.beginPath();
      ctx.moveTo(width * (0.1 + (index % 3) * 0.08), y);
      ctx.lineTo(width * (0.68 + (index % 2) * 0.14), y);
      ctx.stroke();
    }
  }
}

function drawDistantBirds(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  width: number,
  height: number,
): void {
  const random = makeRng(state.seed + 2081);
  const originX = width * (0.2 + random() * 0.42);
  const originY = height * (0.14 + random() * 0.12);
  ctx.save();
  ctx.strokeStyle = "rgba(38,47,44,0.58)";
  ctx.lineWidth = Math.max(1.5, width * 0.0011);
  ctx.lineCap = "round";
  for (let index = 0; index < 4; index += 1) {
    const x = originX + index * width * 0.021 + random() * width * 0.012;
    const y = originY + (index % 2) * height * 0.016 + random() * height * 0.01;
    const wing = width * (0.004 + random() * 0.0025);
    ctx.beginPath();
    ctx.moveTo(x - wing, y + wing * 0.25);
    ctx.quadraticCurveTo(x - wing * 0.42, y - wing * 0.5, x, y);
    ctx.quadraticCurveTo(
      x + wing * 0.42,
      y - wing * 0.5,
      x + wing,
      y + wing * 0.25,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function traceGroundFill(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  width: number,
  height: number,
): void {
  ctx.beginPath();
  traceTerrain(ctx, state, width, height);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
}

function drawTerrainTexture(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  colors: SceneColors,
  width: number,
  height: number,
  detailed: boolean,
): void {
  const random = makeRng(state.seed + 901);
  const count = detailed ? Math.round(width * 0.5) : Math.round(width * 0.16);
  ctx.save();
  traceGroundFill(ctx, state, width, height);
  ctx.clip();
  for (let index = 0; index < count; index += 1) {
    const x = random() * width;
    const top = pointOnTrail(state, x / width, width, height).y;
    const y = top + random() * Math.max(1, height - top);
    const length = (detailed ? 5 : 2) + random() * (detailed ? 20 : 8);
    ctx.strokeStyle =
      index % 3 === 0 ? rgba(colors.groundLight, 0.2) : "rgba(0,0,0,0.08)";
    ctx.lineWidth = detailed ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y - length * (0.08 + random() * 0.14));
    ctx.stroke();
  }
  ctx.restore();
}

function peakIndices(state: HikeState): number[] {
  const peaks: number[] = [];
  for (let index = 1; index < state.terrain.length - 1; index += 1) {
    if (
      state.terrain[index] > state.terrain[index - 1] + 0.06 &&
      state.terrain[index] > state.terrain[index + 1] + 0.06
    ) {
      peaks.push(index);
    }
  }
  if (peaks.length === 0) {
    let highest = 1;
    for (let index = 2; index < state.terrain.length - 1; index += 1) {
      if (state.terrain[index] > state.terrain[highest]) highest = index;
    }
    peaks.push(highest);
  }
  return peaks;
}

function drawMountainFacets(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  colors: SceneColors,
  width: number,
  height: number,
): void {
  const lightFromLeft = state.light === "dawn";
  ctx.save();
  traceGroundFill(ctx, state, width, height);
  ctx.clip();

  for (const index of peakIndices(state)) {
    const peak = terrainAnchorPoint(state, index, width, height);
    const leftShoulder = pointOnTrail(
      state,
      (TERRAIN_X[index - 1] + TERRAIN_X[index]) / 2,
      width,
      height,
    );
    const rightShoulder = pointOnTrail(
      state,
      (TERRAIN_X[index] + TERRAIN_X[index + 1]) / 2,
      width,
      height,
    );
    const faceDepth = Math.min(height * 0.34, height * 0.86 - peak.y);
    const faceBottom = peak.y + faceDepth;

    ctx.fillStyle = rgba(
      lightFromLeft
        ? shade(colors.groundLight, 0.13)
        : shade(colors.ground, -0.28),
      0.22,
    );
    ctx.beginPath();
    ctx.moveTo(peak.x, peak.y);
    ctx.lineTo(leftShoulder.x, leftShoulder.y);
    ctx.lineTo(peak.x - width * 0.045, faceBottom);
    ctx.lineTo(peak.x + width * 0.006, faceBottom - height * 0.035);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = rgba(
      lightFromLeft
        ? shade(colors.ground, -0.3)
        : shade(colors.groundLight, 0.14),
      0.27,
    );
    ctx.beginPath();
    ctx.moveTo(peak.x, peak.y);
    ctx.lineTo(rightShoulder.x, rightShoulder.y);
    ctx.lineTo(peak.x + width * 0.072, faceBottom - height * 0.02);
    ctx.lineTo(peak.x + width * 0.006, faceBottom - height * 0.035);
    ctx.closePath();
    ctx.fill();

    const snowAllowed =
      state.season === "winter" ||
      state.biome === "himalaya" ||
      (state.biome === "cascades" && state.terrain[index] > 0.8) ||
      (state.biome === "fjord" && state.terrain[index] > 0.88);
    if (snowAllowed) {
      const snowDepth = height * (0.065 + state.terrain[index] * 0.035);
      const snowWidth = width * 0.035;
      ctx.fillStyle = rgba(
        colors.snow,
        state.season === "winter" ? 0.94 : 0.84,
      );
      ctx.beginPath();
      ctx.moveTo(peak.x, peak.y);
      ctx.lineTo(peak.x - snowWidth, peak.y + snowDepth * 0.52);
      ctx.lineTo(peak.x - snowWidth * 0.46, peak.y + snowDepth * 0.44);
      ctx.lineTo(peak.x - snowWidth * 0.2, peak.y + snowDepth * 0.86);
      ctx.lineTo(peak.x + snowWidth * 0.02, peak.y + snowDepth * 0.55);
      ctx.lineTo(peak.x + snowWidth * 0.2, peak.y + snowDepth);
      ctx.lineTo(peak.x + snowWidth * 0.44, peak.y + snowDepth * 0.46);
      ctx.lineTo(peak.x + snowWidth, peak.y + snowDepth * 0.5);
      ctx.closePath();
      ctx.fill();
    }

    const random = makeRng(state.seed + index * 617);
    for (let line = 0; line < 13; line += 1) {
      const side = random() < 0.48 ? -1 : 1;
      const startX = peak.x + side * width * (0.003 + random() * 0.018);
      const startY = peak.y + height * (0.025 + random() * 0.07);
      const endX = startX + side * width * (0.025 + random() * 0.065);
      const endY = startY + height * (0.055 + random() * 0.13);
      ctx.strokeStyle =
        side === (lightFromLeft ? -1 : 1)
          ? rgba(shade(colors.groundLight, 0.38), 0.34)
          : "rgba(15,22,20,0.26)";
      ctx.lineWidth = Math.max(1, width * (0.0007 + random() * 0.0006));
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(
        startX + (endX - startX) * 0.45,
        startY + (endY - startY) * 0.38,
      );
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawSnowCaps(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  colors: SceneColors,
  width: number,
  height: number,
): void {
  if (state.season !== "winter" && state.biome !== "himalaya") return;
  ctx.save();
  traceGroundFill(ctx, state, width, height);
  ctx.clip();
  ctx.fillStyle = rgba(colors.snow, state.season === "winter" ? 0.9 : 0.82);
  for (let index = 0; index < TERRAIN_X.length; index += 1) {
    if (state.terrain[index] < (state.biome === "himalaya" ? 0.55 : 0.72))
      continue;
    const point = terrainAnchorPoint(state, index, width, height);
    const capWidth = width * (0.07 + state.terrain[index] * 0.04);
    const capHeight = height * 0.065;
    ctx.beginPath();
    ctx.moveTo(point.x - capWidth, point.y + capHeight);
    ctx.lineTo(point.x - capWidth * 0.45, point.y + capHeight * 0.2);
    ctx.lineTo(point.x - capWidth * 0.15, point.y + capHeight * 0.55);
    ctx.lineTo(point.x, point.y);
    ctx.lineTo(point.x + capWidth * 0.25, point.y + capHeight * 0.45);
    ctx.lineTo(point.x + capWidth * 0.58, point.y + capHeight * 0.18);
    ctx.lineTo(point.x + capWidth, point.y + capHeight);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colors: SceneColors,
  snow: boolean,
  deciduous: boolean,
): void {
  ctx.fillStyle = shade(colors.tree, -0.25);
  ctx.fillRect(x - size * 0.06, y - size * 0.44, size * 0.12, size * 0.46);
  if (deciduous) {
    ctx.fillStyle = colors.tree;
    ctx.beginPath();
    ctx.arc(x, y - size * 0.62, size * 0.29, 0, Math.PI * 2);
    ctx.arc(x - size * 0.2, y - size * 0.53, size * 0.23, 0, Math.PI * 2);
    ctx.arc(x + size * 0.2, y - size * 0.52, size * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(colors.treeLight, 0.78);
    ctx.beginPath();
    ctx.arc(x - size * 0.09, y - size * 0.7, size * 0.15, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const layers = 4;
  for (let layer = 0; layer < layers; layer += 1) {
    const fraction = layer / layers;
    const top = y - size * (0.92 - fraction * 0.18);
    const half = size * (0.16 + fraction * 0.08);
    ctx.fillStyle = layer % 2 ? colors.tree : colors.treeLight;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x - half, top + size * 0.38);
    ctx.lineTo(x + half, top + size * 0.38);
    ctx.closePath();
    ctx.fill();
    if (snow && layer < 3) {
      ctx.strokeStyle = rgba(colors.snow, 0.82);
      ctx.lineWidth = Math.max(1, size * 0.035);
      ctx.beginPath();
      ctx.moveTo(x - half * 0.7, top + size * 0.3);
      ctx.lineTo(x + half * 0.7, top + size * 0.3);
      ctx.stroke();
    }
  }
}

function drawRock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.5, y);
  ctx.lineTo(x - size * 0.3, y - size * 0.45);
  ctx.lineTo(x + size * 0.12, y - size * 0.62);
  ctx.lineTo(x + size * 0.52, y - size * 0.18);
  ctx.lineTo(x + size * 0.42, y);
  ctx.closePath();
  ctx.fill();
}

function drawVegetation(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  colors: SceneColors,
  width: number,
  height: number,
  detailed: boolean,
): void {
  const random = makeRng(state.seed + 1217);
  const density =
    state.biome === "karst"
      ? 1.35
      : state.biome === "himalaya"
        ? 0.32
        : state.biome === "fjord"
          ? 0.72
          : 1;
  const count = Math.round((detailed ? 105 : 42) * density);
  for (let index = 0; index < count; index += 1) {
    const normalizedX = 0.02 + random() * 0.96;
    const point = pointOnTrail(state, normalizedX, width, height);
    const baseSize = Math.min(width, height) * (detailed ? 0.026 : 0.034);
    const size = baseSize * (0.55 + random() * 0.75);
    if (state.biome === "himalaya" && random() > 0.28) {
      drawRock(
        ctx,
        point.x,
        point.y + size * 0.08,
        size * 0.72,
        shade(colors.groundLight, random() * 0.12),
      );
      continue;
    }
    drawTree(
      ctx,
      point.x,
      point.y + size * 0.05,
      size,
      colors,
      state.season === "winter",
      state.season === "autumn" && random() > 0.62,
    );
  }
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  colors: SceneColors,
  width: number,
  height: number,
  detailed: boolean,
): void {
  ctx.save();
  ctx.strokeStyle = detailed ? "rgba(46,38,25,0.42)" : colors.route;
  ctx.lineWidth = detailed
    ? Math.max(8, width * 0.0065)
    : Math.max(2, width * 0.003);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(detailed ? [] : [6, 6]);
  ctx.shadowColor = "rgba(28,24,16,0.22)";
  ctx.shadowBlur = detailed ? 5 : 2;
  ctx.beginPath();
  for (let index = 0; index <= 90; index += 1) {
    const x = 0.055 + (index / 90) * 0.89;
    const point = pointOnTrail(state, x, width, height);
    const routeY = point.y - height * 0.008;
    if (index === 0) ctx.moveTo(point.x, routeY);
    else ctx.lineTo(point.x, routeY);
  }
  ctx.stroke();
  if (detailed) {
    ctx.strokeStyle = rgba(colors.route, 0.68);
    ctx.lineWidth = Math.max(3, width * 0.0028);
    ctx.shadowBlur = 0;
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const x of [0.055, 0.945]) {
    const point = pointOnTrail(state, x, width, height);
    ctx.fillStyle = colors.route;
    ctx.beginPath();
    ctx.arc(
      point.x,
      point.y - height * 0.008,
      detailed ? 6 : 4,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawGrassTuft(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  color: string,
  lean: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, height * 0.055);
  ctx.lineCap = "round";
  for (let blade = -2; blade <= 2; blade += 1) {
    ctx.beginPath();
    ctx.moveTo(x + blade * height * 0.06, y);
    ctx.quadraticCurveTo(
      x + lean * height * 0.35 + blade * height * 0.05,
      y - height * 0.55,
      x + lean * height + blade * height * 0.14,
      y - height * (0.82 + Math.abs(blade) * 0.05),
    );
    ctx.stroke();
  }
}

function drawPostcardForeground(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  colors: SceneColors,
  width: number,
  height: number,
): void {
  const random = makeRng(state.seed + 7043);
  const rocky = state.biome === "himalaya";

  for (let index = 0; index < 34; index += 1) {
    const x = random() * width;
    const y = height * (0.88 + random() * 0.13);
    const size = width * (0.008 + random() * 0.022);
    drawRock(
      ctx,
      x,
      y,
      size,
      index % 3 === 0
        ? shade(colors.groundLight, 0.16)
        : shade(colors.ground, -0.08),
    );
    if (index % 4 === 0) {
      ctx.strokeStyle = rgba(shade(colors.groundLight, 0.45), 0.32);
      ctx.lineWidth = Math.max(1, width * 0.0008);
      ctx.beginPath();
      ctx.moveTo(x - size * 0.25, y - size * 0.28);
      ctx.lineTo(x + size * 0.08, y - size * 0.46);
      ctx.stroke();
    }
  }

  if (!rocky) {
    const grassCount = state.biome === "karst" ? 125 : 86;
    for (let index = 0; index < grassCount; index += 1) {
      const x = random() * width;
      const y = height * (0.86 + random() * 0.16);
      const bladeHeight = height * (0.012 + random() * 0.035);
      drawGrassTuft(
        ctx,
        x,
        y,
        bladeHeight,
        index % 3 === 0
          ? rgba(colors.treeLight, 0.82)
          : rgba(colors.tree, 0.76),
        random() - 0.5,
      );
    }
  }

  if (state.season !== "winter" && !rocky) {
    const flowerColors = ["#f5d66f", "#e98b7e", "#d9c6ed", "#f0eee0"];
    for (let index = 0; index < 45; index += 1) {
      const x = random() * width;
      const y = height * (0.88 + random() * 0.1);
      const radius = width * (0.0012 + random() * 0.0012);
      ctx.fillStyle = rgba(flowerColors[index % flowerColors.length], 0.86);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const closeTreeCount = rocky ? 2 : 5;
  for (let index = 0; index < closeTreeCount; index += 1) {
    if (rocky && index > 1) break;
    const leftSide = index % 2 === 0;
    const x = leftSide
      ? width * (-0.01 + random() * 0.08)
      : width * (0.93 + random() * 0.08);
    const size = height * (0.16 + random() * (rocky ? 0.08 : 0.16));
    if (rocky) {
      drawRock(ctx, x, height * 1.02, size * 0.72, shade(colors.ground, -0.26));
    } else {
      drawTree(
        ctx,
        x,
        height * 1.02,
        size,
        {
          ...colors,
          tree: shade(colors.tree, -0.3),
          treeLight: shade(colors.treeLight, -0.2),
        },
        state.season === "winter",
        false,
      );
    }
  }
}

function drawForestFeature(
  ctx: CanvasRenderingContext2D,
  point: Point,
  scale: number,
  colors: SceneColors,
  winter: boolean,
): void {
  for (const [offset, size] of [
    [-17, 34],
    [0, 46],
    [18, 31],
  ] as const) {
    drawTree(
      ctx,
      point.x + offset * scale,
      point.y + 4 * scale,
      size * scale,
      colors,
      winter,
      false,
    );
  }
}

function drawMeadowFeature(
  ctx: CanvasRenderingContext2D,
  point: Point,
  scale: number,
  colors: SceneColors,
): void {
  ctx.fillStyle = rgba(shade(colors.groundLight, 0.18), 0.82);
  ctx.beginPath();
  ctx.ellipse(
    point.x,
    point.y + 4 * scale,
    38 * scale,
    10 * scale,
    -0.08,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.strokeStyle = rgba(shade(colors.groundLight, 0.35), 0.85);
  ctx.lineWidth = Math.max(1, scale);
  for (let index = -4; index <= 4; index += 1) {
    const x = point.x + index * 7 * scale;
    ctx.beginPath();
    ctx.moveTo(x, point.y + 2 * scale);
    ctx.lineTo(x + 2 * scale, point.y - (7 + Math.abs(index % 3) * 2) * scale);
    ctx.stroke();
  }
}

function drawLakeFeature(
  ctx: CanvasRenderingContext2D,
  point: Point,
  scale: number,
  colors: SceneColors,
): void {
  const gradient = ctx.createLinearGradient(
    point.x,
    point.y - 4 * scale,
    point.x,
    point.y + 16 * scale,
  );
  gradient.addColorStop(0, shade(colors.water, 0.34));
  gradient.addColorStop(1, shade(colors.water, -0.14));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(
    point.x,
    point.y + 7 * scale,
    44 * scale,
    14 * scale,
    -0.04,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.56)";
  ctx.lineWidth = Math.max(1, scale * 1.2);
  for (let index = -1; index <= 1; index += 1) {
    ctx.beginPath();
    ctx.moveTo(
      point.x - (24 - Math.abs(index) * 5) * scale,
      point.y + (4 + index * 4) * scale,
    );
    ctx.lineTo(
      point.x + (22 - Math.abs(index) * 4) * scale,
      point.y + (4 + index * 4) * scale,
    );
    ctx.stroke();
  }
}

function drawWaterfallFeature(
  ctx: CanvasRenderingContext2D,
  point: Point,
  scale: number,
  colors: SceneColors,
): void {
  ctx.strokeStyle = shade(colors.water, 0.42);
  ctx.lineWidth = 5 * scale;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(point.x - 5 * scale, point.y - 43 * scale);
  ctx.bezierCurveTo(
    point.x + 4 * scale,
    point.y - 30 * scale,
    point.x - 4 * scale,
    point.y - 16 * scale,
    point.x + 2 * scale,
    point.y + 3 * scale,
  );
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = 1.5 * scale;
  ctx.stroke();
  ctx.fillStyle = rgba(colors.water, 0.65);
  ctx.beginPath();
  ctx.ellipse(
    point.x + 2 * scale,
    point.y + 7 * scale,
    16 * scale,
    5 * scale,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

function drawWildflowersFeature(
  ctx: CanvasRenderingContext2D,
  point: Point,
  scale: number,
  colors: SceneColors,
  seed: number,
): void {
  const random = makeRng(seed);
  const flowers = ["#f6d365", "#f08b78", "#d9c3ef", "#f5f0e0"];
  ctx.strokeStyle = shade(colors.groundLight, 0.12);
  ctx.lineWidth = Math.max(1, scale * 0.8);
  for (let index = 0; index < 18; index += 1) {
    const x = point.x + (random() - 0.5) * 62 * scale;
    const stem = (5 + random() * 8) * scale;
    const y = point.y + (random() - 0.3) * 8 * scale;
    ctx.beginPath();
    ctx.moveTo(x, y + 4 * scale);
    ctx.lineTo(x, y - stem);
    ctx.stroke();
    ctx.fillStyle = flowers[index % flowers.length];
    ctx.beginPath();
    ctx.arc(x, y - stem, 2.2 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSnowfieldFeature(
  ctx: CanvasRenderingContext2D,
  point: Point,
  scale: number,
  colors: SceneColors,
): void {
  ctx.fillStyle = rgba(colors.snow, 0.94);
  ctx.beginPath();
  ctx.moveTo(point.x - 40 * scale, point.y + 8 * scale);
  ctx.bezierCurveTo(
    point.x - 22 * scale,
    point.y - 10 * scale,
    point.x + 17 * scale,
    point.y - 8 * scale,
    point.x + 43 * scale,
    point.y + 6 * scale,
  );
  ctx.bezierCurveTo(
    point.x + 14 * scale,
    point.y + 13 * scale,
    point.x - 17 * scale,
    point.y + 15 * scale,
    point.x - 40 * scale,
    point.y + 8 * scale,
  );
  ctx.fill();
  ctx.strokeStyle = rgba("#8ba7b1", 0.38);
  ctx.lineWidth = Math.max(1, scale);
  ctx.beginPath();
  ctx.moveTo(point.x - 23 * scale, point.y + 7 * scale);
  ctx.quadraticCurveTo(
    point.x,
    point.y - 1 * scale,
    point.x + 24 * scale,
    point.y + 6 * scale,
  );
  ctx.stroke();
}

function drawCampFeature(
  ctx: CanvasRenderingContext2D,
  point: Point,
  scale: number,
  colors: SceneColors,
): void {
  ctx.fillStyle = shade(colors.accent, -0.08);
  ctx.beginPath();
  ctx.moveTo(point.x - 25 * scale, point.y + 4 * scale);
  ctx.lineTo(point.x, point.y - 30 * scale);
  ctx.lineTo(point.x + 27 * scale, point.y + 4 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(colors.accent, -0.36);
  ctx.beginPath();
  ctx.moveTo(point.x, point.y - 30 * scale);
  ctx.lineTo(point.x + 27 * scale, point.y + 4 * scale);
  ctx.lineTo(point.x + 4 * scale, point.y + 4 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffd78a";
  ctx.beginPath();
  ctx.moveTo(point.x - 3 * scale, point.y + 3 * scale);
  ctx.lineTo(point.x + 1 * scale, point.y - 11 * scale);
  ctx.lineTo(point.x + 7 * scale, point.y + 3 * scale);
  ctx.closePath();
  ctx.fill();
}

function drawLookoutFeature(
  ctx: CanvasRenderingContext2D,
  point: Point,
  scale: number,
  colors: SceneColors,
): void {
  ctx.strokeStyle = shade(colors.ground, -0.15);
  ctx.lineWidth = 3 * scale;
  ctx.beginPath();
  ctx.moveTo(point.x - 15 * scale, point.y + 6 * scale);
  ctx.lineTo(point.x - 10 * scale, point.y - 23 * scale);
  ctx.moveTo(point.x + 15 * scale, point.y + 6 * scale);
  ctx.lineTo(point.x + 10 * scale, point.y - 23 * scale);
  ctx.stroke();
  ctx.fillStyle = shade(colors.accent, -0.22);
  ctx.fillRect(
    point.x - 22 * scale,
    point.y - 45 * scale,
    44 * scale,
    24 * scale,
  );
  ctx.fillStyle = "#f2c978";
  ctx.fillRect(
    point.x - 15 * scale,
    point.y - 39 * scale,
    12 * scale,
    8 * scale,
  );
  ctx.fillRect(
    point.x + 4 * scale,
    point.y - 39 * scale,
    12 * scale,
    8 * scale,
  );
  ctx.fillStyle = shade(colors.ground, -0.3);
  ctx.beginPath();
  ctx.moveTo(point.x - 28 * scale, point.y - 45 * scale);
  ctx.lineTo(point.x, point.y - 58 * scale);
  ctx.lineTo(point.x + 28 * scale, point.y - 45 * scale);
  ctx.closePath();
  ctx.fill();
}

function drawFeature(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  feature: PlacedFeature,
  colors: SceneColors,
  width: number,
  height: number,
  detailed: boolean,
): void {
  const point = pointOnTrail(state, feature.x, width, height);
  const scale = Math.min(width / 900, height / 600) * (detailed ? 1.1 : 0.9);
  if (feature.type === "forest")
    drawForestFeature(ctx, point, scale, colors, state.season === "winter");
  else if (feature.type === "meadow")
    drawMeadowFeature(ctx, point, scale, colors);
  else if (feature.type === "lake") drawLakeFeature(ctx, point, scale, colors);
  else if (feature.type === "waterfall")
    drawWaterfallFeature(ctx, point, scale, colors);
  else if (feature.type === "wildflowers")
    drawWildflowersFeature(
      ctx,
      point,
      scale,
      colors,
      state.seed + feature.id.length * 31,
    );
  else if (feature.type === "snowfield")
    drawSnowfieldFeature(ctx, point, scale, colors);
  else if (feature.type === "camp") drawCampFeature(ctx, point, scale, colors);
  else drawLookoutFeature(ctx, point, scale, colors);
}

function drawHiker(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  width: number,
  height: number,
  progress: number,
  now: number,
  detailed: boolean,
): void {
  const x = 0.06 + clamp(progress, 0, 1) * 0.88;
  const point = pointOnTrail(state, x, width, height);
  const scale = Math.min(width / 900, height / 600) * (detailed ? 1.3 : 1);
  const bob = Math.sin(now / 95) * 1.5 * scale;
  const leg = Math.sin(now / 90) * 5 * scale;
  ctx.save();
  ctx.translate(point.x, point.y - 9 * scale + bob);
  ctx.lineCap = "round";
  ctx.strokeStyle = "#25231e";
  ctx.lineWidth = 3 * scale;
  ctx.beginPath();
  ctx.moveTo(0, -9 * scale);
  ctx.lineTo(-leg, 4 * scale);
  ctx.moveTo(0, -9 * scale);
  ctx.lineTo(leg, 4 * scale);
  ctx.stroke();
  ctx.fillStyle = state.hikerColor;
  ctx.beginPath();
  ctx.roundRect(-7 * scale, -28 * scale, 14 * scale, 20 * scale, 5 * scale);
  ctx.fill();
  ctx.fillStyle = shade(state.hikerColor, -0.28);
  ctx.beginPath();
  ctx.roundRect(-11 * scale, -25 * scale, 7 * scale, 14 * scale, 3 * scale);
  ctx.fill();
  ctx.strokeStyle = "#25231e";
  ctx.lineWidth = 2.4 * scale;
  ctx.beginPath();
  ctx.moveTo(-4 * scale, -23 * scale);
  ctx.lineTo(-8 * scale - leg * 0.55, -11 * scale);
  ctx.moveTo(4 * scale, -23 * scale);
  ctx.lineTo(8 * scale + leg * 0.55, -12 * scale);
  ctx.stroke();
  ctx.fillStyle = "#d8ad86";
  ctx.beginPath();
  ctx.arc(0, -34 * scale, 6 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#343128";
  ctx.beginPath();
  ctx.arc(0, -36 * scale, 6.4 * scale, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMist(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  width: number,
  height: number,
): void {
  if (state.weather !== "mist") return;
  for (let index = 0; index < 4; index += 1) {
    const y = height * (0.37 + index * 0.095);
    const gradient = ctx.createLinearGradient(0, y, width, y);
    gradient.addColorStop(0, "rgba(245,247,240,0)");
    gradient.addColorStop(0.2, "rgba(245,247,240,0.2)");
    gradient.addColorStop(0.55, "rgba(245,247,240,0.36)");
    gradient.addColorStop(1, "rgba(245,247,240,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y, width, height * 0.075);
  }
}

function drawTerrainHandles(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  width: number,
  height: number,
  activeAnchor: number | null,
  hoveredAnchor: number | null,
): void {
  for (let index = 0; index < TERRAIN_X.length; index += 1) {
    const point = terrainAnchorPoint(state, index, width, height);
    const active = index === activeAnchor;
    const hovered = index === hoveredAnchor;
    const radius = active ? 8 : hovered ? 7 : 6;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = active || hovered ? 9 : 5;
    ctx.fillStyle = active ? "#f5cb72" : "#fffaf0";
    ctx.strokeStyle = active ? "#3e4d35" : "#405445";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  options: HikeRenderOptions,
): void {
  const { width, height, mode } = options;
  const detailed = mode === "postcard";
  const now = options.now ?? 0;
  const colors = colorsFor(state);

  drawSky(ctx, state, colors, width, height);
  if (detailed) drawSunShafts(ctx, state, width, height);
  drawClouds(ctx, state, width, height, now, detailed);
  drawBackgroundRanges(ctx, state, colors, width, height, detailed);
  if (detailed) drawDistantBirds(ctx, state, width, height);
  drawMist(ctx, state, width, height);

  traceGroundFill(ctx, state, width, height);
  const ground = ctx.createLinearGradient(0, height * 0.35, 0, height);
  ground.addColorStop(0, colors.groundLight);
  ground.addColorStop(0.45, colors.ground);
  ground.addColorStop(1, shade(colors.ground, -0.28));
  ctx.fillStyle = ground;
  ctx.fill();
  if (detailed) drawMountainFacets(ctx, state, colors, width, height);
  drawTerrainTexture(ctx, state, colors, width, height, detailed);
  drawSnowCaps(ctx, state, colors, width, height);
  drawVegetation(ctx, state, colors, width, height, detailed);
  drawTrail(ctx, state, colors, width, height, detailed);
  for (const feature of state.features)
    drawFeature(ctx, state, feature, colors, width, height, detailed);

  const hikerProgress = options.hikerProgress ?? (detailed ? 0.68 : null);
  if (detailed) drawPostcardForeground(ctx, state, colors, width, height);
  if (hikerProgress != null)
    drawHiker(ctx, state, width, height, hikerProgress, now, detailed);
  if (!detailed) {
    drawTerrainHandles(
      ctx,
      state,
      width,
      height,
      options.activeAnchor ?? null,
      options.hoveredAnchor ?? null,
    );
  }
}

export function renderHikeScene(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  options: HikeRenderOptions,
): void {
  ctx.clearRect(0, 0, options.width, options.height);
  drawScene(ctx, state, options);
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  initialSize: number,
  weight = 700,
): number {
  let size = initialSize;
  do {
    ctx.font = `${weight} ${size}px Georgia, serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  } while (size > 36);
  return size;
}

function drawPostcardType(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  width: number,
  height: number,
): void {
  const biome = biomeById(state.biome);
  const stats = calculateHikeStats(state);
  const overlay = ctx.createLinearGradient(0, height * 0.54, 0, height);
  overlay.addColorStop(0, "rgba(10,18,14,0)");
  overlay.addColorStop(0.55, "rgba(10,18,14,0.34)");
  overlay.addColorStop(1, "rgba(10,18,14,0.82)");
  ctx.fillStyle = overlay;
  ctx.fillRect(0, height * 0.52, width, height * 0.48);

  const left = width * 0.048;
  const bottom = height * 0.91;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,250,239,0.9)";
  ctx.font = `600 ${Math.round(width * 0.016)}px Arial, sans-serif`;
  ctx.fillText(
    `AN IMAGINED TRAIL / ${biome.postcardLabel}`,
    left,
    bottom - height * 0.14,
  );

  const titleSize = fitText(ctx, state.routeName, width * 0.76, width * 0.047);
  ctx.fillStyle = "#fffaf0";
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = 10;
  ctx.font = `700 ${titleSize}px Georgia, serif`;
  ctx.fillText(state.routeName, left, bottom - height * 0.058);
  ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(255,250,239,0.88)";
  ctx.font = `600 ${Math.round(width * 0.014)}px Arial, sans-serif`;
  ctx.fillText(
    `${stats.distanceMiles.toFixed(1)} MILES / ${stats.elevationFeet.toLocaleString("en-US")} FT UP / ${stats.effort.toUpperCase()}`,
    left,
    bottom,
  );

  const stampX = width * 0.91;
  const stampY = height * 0.82;
  const radius = width * 0.037;
  ctx.strokeStyle = "rgba(255,250,239,0.82)";
  ctx.lineWidth = Math.max(2, width * 0.0018);
  ctx.beginPath();
  ctx.arc(stampX, stampY, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(stampX - radius * 0.58, stampY + radius * 0.2);
  ctx.lineTo(stampX - radius * 0.12, stampY - radius * 0.4);
  ctx.lineTo(stampX + radius * 0.12, stampY - radius * 0.06);
  ctx.lineTo(stampX + radius * 0.34, stampY - radius * 0.3);
  ctx.lineTo(stampX + radius * 0.62, stampY + radius * 0.2);
  ctx.stroke();
}

function drawGrain(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  width: number,
  height: number,
): void {
  const random = makeRng(state.seed + 9929);
  ctx.fillStyle = "rgba(255,255,255,0.055)";
  for (let index = 0; index < 1800; index += 1) {
    const size = random() > 0.9 ? 2 : 1;
    ctx.fillRect(
      Math.floor(random() * width),
      Math.floor(random() * height),
      size,
      size,
    );
  }
}

export function renderHikePostcard(
  canvas: HTMLCanvasElement,
  state: HikeState,
): void {
  const width = 1800;
  const height = 1200;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#f4efe4";
  ctx.fillRect(0, 0, width, height);

  const border = 38;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(border, border, width - border * 2, height - border * 2, 10);
  ctx.clip();
  ctx.translate(border, border);
  const sceneWidth = width - border * 2;
  const sceneHeight = height - border * 2;
  drawScene(ctx, state, {
    width: sceneWidth,
    height: sceneHeight,
    mode: "postcard",
    now: state.seed * 17,
    hikerProgress: 0.68,
  });
  drawPostcardType(ctx, state, sceneWidth, sceneHeight);
  drawGrain(ctx, state, sceneWidth, sceneHeight);
  ctx.restore();

  ctx.strokeStyle = "rgba(65,55,42,0.28)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(border, border, width - border * 2, height - border * 2, 10);
  ctx.stroke();
}
