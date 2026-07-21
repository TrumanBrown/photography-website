import {
  baseTerrainElevationAt,
  biomeById,
  calculateHikeStats,
  featureAdjustedElevationAt,
  terrainXPositions,
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
  activeFeatureId?: string | null;
  hoveredFeatureId?: string | null;
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

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const lerp = (start: number, end: number, amount: number): number =>
  start + (end - start) * amount;

function distanceProgress(state: HikeState): number {
  return clamp((state.distance - 3) / 15, 0, 1);
}

function worldObjectScale(state: HikeState): number {
  return lerp(1.18, 0.68, distanceProgress(state));
}

export function terrainReliefForDistance(distance: number): number {
  return lerp(0.72, 0.36, clamp((distance - 3) / 15, 0, 1));
}

function terrainRelief(state: HikeState): number {
  return terrainReliefForDistance(state.distance);
}

function terrainPositions(state: HikeState): number[] {
  return terrainXPositions(state.terrain.length, state.seed, state.biome);
}

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
  const positions = terrainPositions(state);
  const x = clamp(normalizedX, positions[0], positions[positions.length - 1]);
  const adjusted = featureAdjustedElevationAt(state, x);
  for (let index = 0; index < positions.length - 1; index += 1) {
    const left = positions[index];
    const right = positions[index + 1];
    if (x <= right) {
      const local = (x - left) / (right - left);
      const envelope = Math.sin(local * Math.PI);
      const phase = (state.seed % 997) * 0.013 + index * 1.7;
      const leftHeight = state.terrain[index];
      const rightHeight = state.terrain[index + 1];
      const rising = rightHeight > leftHeight;
      const variation =
        ((Math.imul(state.seed ^ (index * 2654435761), 1597334677) >>> 0) %
          1000) /
        1000;
      let curve = local;
      let shoulder = 0;

      if (state.biome === "fjord") {
        const broadTop = variation > 0.35;
        curve = rising
          ? Math.pow(local, broadTop ? 0.42 : 2.5)
          : Math.pow(local, broadTop ? 2.5 : 0.42);
        shoulder = envelope * (broadTop ? 0.025 : -0.012);
      } else if (state.biome === "karst") {
        curve = rising ? Math.pow(local, 2.7) : Math.pow(local, 0.36);
        shoulder = -envelope * 0.012;
      } else if (state.biome === "himalaya") {
        const smooth = local * local * (3 - 2 * local);
        curve = lerp(local, smooth, 0.72);
        shoulder = envelope * (0.028 + variation * 0.022);
      } else {
        const exponent = 0.62 + variation * 1.1;
        curve = Math.pow(local, rising ? exponent : 1 / exponent);
        shoulder =
          envelope *
          (Math.sin(local * Math.PI * 2 + phase) * 0.018 +
            (variation - 0.5) * 0.025);
      }

      const linear = leftHeight + (rightHeight - leftHeight) * local;
      const shaped = leftHeight + (rightHeight - leftHeight) * curve + shoulder;
      const crags =
        Math.sin(local * Math.PI * (5 + (index % 3)) + phase) * 0.012 +
        Math.sin(local * Math.PI * (11 + (index % 4)) + phase * 0.7) * 0.005;
      return clamp(adjusted + (shaped - linear) + crags * envelope, 0.06, 0.99);
    }
  }
  return adjusted;
}

export function terrainElevationFromCanvasY(
  state: HikeState,
  y: number,
  height: number,
): number {
  return clamp(
    (TERRAIN_BASELINE - y / height) / terrainRelief(state),
    0.08,
    0.96,
  );
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
    y: height * (TERRAIN_BASELINE - elevation * terrainRelief(state)),
  };
}

export function terrainAnchorPoint(
  state: HikeState,
  index: number,
  width: number,
  height: number,
): Point {
  const x = terrainPositions(state)[index];
  return {
    x: x * width,
    y:
      height * (TERRAIN_BASELINE - state.terrain[index] * terrainRelief(state)),
  };
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
  const distanceClouds = Math.round(distanceProgress(state) * 4);
  const count =
    (state.weather === "mist" ? (detailed ? 12 : 7) : detailed ? 9 : 5) +
    distanceClouds;
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
  const points = 16 + Math.round(distanceProgress(state) * 18);
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
    const baseElevation = baseTerrainElevationAt(state, shifted);
    const independentRidge =
      Math.sin(x * Math.PI * (3 + (seedOffset % 4)) + seedOffset) * 0.08 +
      Math.sin(x * Math.PI * (9 + (seedOffset % 5))) * 0.035;
    const elevation = clamp(
      baseElevation * 0.62 + 0.2 + independentRidge,
      0.08,
      0.96,
    );
    const roughness = (random() - 0.5) * 0.055;
    const cameraScale = lerp(1.15, 0.62, distanceProgress(state));
    ctx.lineTo(
      x * width,
      height * (base - elevation * amplitude * cameraScale + roughness),
    );
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
  const count =
    (detailed ? 15 : 10) +
    Math.round(distanceProgress(state) * (detailed ? 10 : 6));
  for (let index = 0; index < count; index += 1) {
    const center =
      ((index + 0.5) / count) * width + (random() - 0.5) * width * 0.04;
    const pillarWidth = width * (0.025 + random() * 0.025);
    const bottom = height * 0.71;
    const rawTop = height * (0.19 + random() * 0.27);
    const top = bottom - (bottom - rawTop) * worldObjectScale(state);
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
  const density = 0.75 + distanceProgress(state) * 0.65;
  const count = Math.round((detailed ? width * 0.5 : width * 0.16) * density);
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

interface TerrainSurfaceSample extends Point {
  normalizedX: number;
  elevation: number;
  steepness: number;
  noise: number;
}

interface TerrainMaterials {
  alpineLine: number;
  rockLine: number;
  alpineTop: string;
  alpineBottom: string;
  soil: string;
}

function terrainMaterialsForBiome(
  state: HikeState,
  colors: SceneColors,
): TerrainMaterials {
  if (state.biome === "fjord") {
    return {
      alpineLine: 0.24,
      rockLine: 0.43,
      alpineTop: mix("#6d8067", colors.groundLight, 0.24),
      alpineBottom: mix("#425b4f", colors.ground, 0.2),
      soil: "#3e4238",
    };
  }
  if (state.biome === "karst") {
    return {
      alpineLine: 0.2,
      rockLine: 0.5,
      alpineTop: mix("#607c50", colors.groundLight, 0.34),
      alpineBottom: mix("#365b42", colors.ground, 0.16),
      soil: "#474638",
    };
  }
  if (state.biome === "himalaya") {
    return {
      alpineLine: 0.16,
      rockLine: 0.32,
      alpineTop: mix("#878064", colors.groundLight, 0.18),
      alpineBottom: mix("#5f5b4e", colors.ground, 0.16),
      soil: "#514941",
    };
  }
  return {
    alpineLine: 0.27,
    rockLine: 0.49,
    alpineTop: mix("#7d874f", colors.groundLight, 0.2),
    alpineBottom: mix("#4d6242", colors.ground, 0.14),
    soil: "#51483b",
  };
}

function traceSurfaceRun(
  ctx: CanvasRenderingContext2D,
  samples: readonly TerrainSurfaceSample[],
  depth: (sample: TerrainSurfaceSample, index: number) => number,
): void {
  ctx.beginPath();
  ctx.moveTo(samples[0].x, samples[0].y);
  for (let index = 1; index < samples.length; index += 1) {
    ctx.lineTo(samples[index].x, samples[index].y);
  }
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    ctx.lineTo(
      samples[index].x,
      samples[index].y + depth(samples[index], index),
    );
  }
  ctx.closePath();
}

function drawSurfaceRuns(
  samples: readonly TerrainSurfaceSample[],
  visible: (sample: TerrainSurfaceSample) => boolean,
  draw: (run: readonly TerrainSurfaceSample[]) => void,
): void {
  let run: TerrainSurfaceSample[] = [];
  const flush = (): void => {
    if (run.length >= 2) draw(run);
    run = [];
  };
  for (const sample of samples) {
    if (visible(sample)) run.push(sample);
    else flush();
  }
  flush();
}

function drawTerrainMaterialZones(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  colors: SceneColors,
  width: number,
  height: number,
  detailed: boolean,
): void {
  const material = terrainMaterialsForBiome(state, colors);
  const geology = geologyForBiome(state, colors);
  const sampleCount = detailed ? 220 : 110;
  const objectScale = worldObjectScale(state);
  const samples = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const normalizedX = 0.02 + (index / sampleCount) * 0.96;
    const point = pointOnTrail(state, normalizedX, width, height);
    const before = ridgeElevationAt(state, Math.max(0.02, normalizedX - 0.004));
    const after = ridgeElevationAt(state, Math.min(0.98, normalizedX + 0.004));
    const steepness = clamp(Math.abs(after - before) / 0.08, 0, 1);
    const noise =
      Math.sin(normalizedX * Math.PI * 13 + state.seed * 0.013) * 0.55 +
      Math.sin(normalizedX * Math.PI * 31 + state.seed * 0.007) * 0.3 +
      Math.sin(normalizedX * Math.PI * 67 + state.seed * 0.003) * 0.15;
    return {
      normalizedX,
      ...point,
      elevation: ridgeElevationAt(state, normalizedX),
      steepness,
      noise,
    };
  });

  ctx.save();
  traceGroundFill(ctx, state, width, height);
  ctx.clip();

  drawSurfaceRuns(
    samples,
    (sample) => sample.elevation + sample.noise * 0.055 > material.alpineLine,
    (run) => {
      const minY = Math.min(...run.map((sample) => sample.y));
      const maxY = Math.max(...run.map((sample) => sample.y));
      const gradient = ctx.createLinearGradient(
        0,
        minY,
        0,
        maxY + height * 0.18,
      );
      gradient.addColorStop(0, rgba(material.alpineTop, 0.92));
      gradient.addColorStop(0.58, rgba(material.alpineBottom, 0.78));
      gradient.addColorStop(1, rgba(colors.ground, 0.08));
      ctx.fillStyle = gradient;
      traceSurfaceRun(ctx, run, (sample) => {
        const altitude = clamp(
          (sample.elevation - material.alpineLine) /
            Math.max(0.1, 1 - material.alpineLine),
          0,
          1,
        );
        return (
          height *
          (0.055 + altitude * 0.12 + sample.steepness * 0.025) *
          objectScale
        );
      });
      ctx.fill();
    },
  );

  drawSurfaceRuns(
    samples,
    (sample) =>
      sample.elevation + sample.steepness * 0.2 + sample.noise * 0.085 >
      material.rockLine,
    (run) => {
      const minY = Math.min(...run.map((sample) => sample.y));
      const maxY = Math.max(...run.map((sample) => sample.y));
      const gradient = ctx.createLinearGradient(
        0,
        minY,
        0,
        maxY + height * 0.24,
      );
      gradient.addColorStop(0, rgba(geology.sun, detailed ? 0.96 : 0.88));
      gradient.addColorStop(0.38, rgba(geology.mid, detailed ? 0.94 : 0.82));
      gradient.addColorStop(1, rgba(geology.shade, detailed ? 0.74 : 0.62));
      ctx.fillStyle = gradient;
      traceSurfaceRun(ctx, run, (sample) => {
        const exposure = clamp(
          (sample.elevation - material.rockLine) * 1.8 +
            sample.steepness * 0.8 +
            sample.noise * 0.1,
          0,
          1,
        );
        return height * (0.115 + exposure * 0.265) * objectScale;
      });
      ctx.fill();

      ctx.strokeStyle = rgba(geology.seam, detailed ? 0.24 : 0.14);
      ctx.lineWidth = detailed ? 1.35 : 0.8;
      ctx.beginPath();
      ctx.moveTo(run[0].x, run[0].y + height * 0.025);
      for (let index = 1; index < run.length; index += 1) {
        const sample = run[index];
        ctx.lineTo(
          sample.x,
          sample.y +
            height *
              (0.022 + Math.sin(sample.normalizedX * Math.PI * 29) * 0.004),
        );
      }
      ctx.stroke();
    },
  );

  const random = makeRng(state.seed + 5431);
  const screeCount = detailed ? 380 : 105;
  for (let index = 0; index < screeCount; index += 1) {
    const sample = samples[Math.floor(random() * samples.length)];
    const rockExposure =
      sample.elevation + sample.steepness * 0.2 + sample.noise * 0.085;
    if (rockExposure < material.rockLine - 0.08) continue;
    const depth = height * (0.035 + random() * 0.18) * objectScale;
    const x = sample.x + (random() - 0.5) * width * 0.012;
    const y = sample.y + depth;
    const size = (detailed ? 0.8 : 0.55) + random() * (detailed ? 3.4 : 2.1);
    ctx.fillStyle =
      index % 5 === 0
        ? rgba(geology.sun, detailed ? 0.42 : 0.3)
        : rgba(geology.shade, detailed ? 0.6 : 0.4);
    ctx.beginPath();
    ctx.moveTo(x - size, y + size * 0.4);
    ctx.lineTo(x + size * 0.15, y - size);
    ctx.lineTo(x + size, y + size * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  const ledgeCount = detailed ? 115 : 38;
  for (let index = 0; index < ledgeCount; index += 1) {
    const sample = samples[Math.floor(random() * samples.length)];
    if (
      sample.elevation < material.alpineLine - 0.02 ||
      sample.elevation > material.rockLine + 0.3 ||
      sample.steepness > 0.82
    ) {
      continue;
    }
    const depth =
      height *
      (0.018 + random() * (0.07 + sample.steepness * 0.04)) *
      objectScale;
    const ledgeWidth = width * (0.0025 + random() * (detailed ? 0.009 : 0.006));
    const ledgeHeight =
      height * (0.0012 + random() * (detailed ? 0.003 : 0.002));
    ctx.fillStyle = rgba(
      index % 3 === 0 ? material.alpineTop : material.alpineBottom,
      detailed ? 0.52 : 0.38,
    );
    ctx.beginPath();
    ctx.ellipse(
      sample.x + (random() - 0.5) * width * 0.012,
      sample.y + depth,
      ledgeWidth,
      ledgeHeight,
      slopeAt(state, sample.normalizedX, width, height),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.fillStyle = rgba(material.soil, detailed ? 0.2 : 0.12);
  const soilPatches = detailed ? 80 : 26;
  for (let index = 0; index < soilPatches; index += 1) {
    const sample = samples[Math.floor(random() * samples.length)];
    if (sample.elevation < material.alpineLine - 0.08) continue;
    ctx.beginPath();
    ctx.ellipse(
      sample.x + (random() - 0.5) * width * 0.016,
      sample.y + height * (0.018 + random() * 0.12),
      width * (0.002 + random() * 0.008),
      height * (0.0015 + random() * 0.004),
      random() * 0.5 - 0.25,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawPostcardTerrainDetail(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  colors: SceneColors,
  width: number,
  height: number,
): void {
  const random = makeRng(state.seed + 3571);
  ctx.save();
  traceGroundFill(ctx, state, width, height);
  ctx.clip();

  const shadowCount = 5 + Math.round(distanceProgress(state) * 4);
  for (let index = 0; index < shadowCount; index += 1) {
    const x = random() * width;
    const y = height * (0.42 + random() * 0.34);
    const radiusX = width * (0.07 + random() * 0.12);
    const radiusY = height * (0.025 + random() * 0.055);
    ctx.fillStyle = `rgba(16,25,22,${0.025 + random() * 0.05})`;
    ctx.beginPath();
    ctx.ellipse(x, y, radiusX, radiusY, random() * 0.3 - 0.15, 0, Math.PI * 2);
    ctx.fill();
  }

  const contourCount = 17 + Math.round(distanceProgress(state) * 8);
  for (let contour = 1; contour <= contourCount; contour += 1) {
    const offset = height * (0.012 + contour * 0.018);
    ctx.strokeStyle =
      contour % 4 === 0
        ? rgba(shade(colors.groundLight, 0.26), 0.15)
        : "rgba(5,15,12,0.095)";
    ctx.lineWidth = contour % 4 === 0 ? 1.7 : 1;
    ctx.beginPath();
    for (let step = 0; step <= 150; step += 1) {
      const normalizedX = 0.025 + (step / 150) * 0.95;
      const point = pointOnTrail(state, normalizedX, width, height);
      const y =
        point.y +
        offset +
        Math.sin(step * 0.23 + contour * 0.8) * height * 0.0025;
      if (step === 0) ctx.moveTo(point.x, y);
      else ctx.lineTo(point.x, y);
    }
    ctx.stroke();
  }

  const gullyCount = 20 + Math.round(distanceProgress(state) * 24);
  for (let index = 0; index < gullyCount; index += 1) {
    const normalizedX = 0.05 + random() * 0.9;
    const top = pointOnTrail(state, normalizedX, width, height);
    const length = height * (0.07 + random() * 0.2);
    const direction = random() < 0.5 ? -1 : 1;
    ctx.strokeStyle =
      index % 3 === 0
        ? rgba(shade(colors.groundLight, 0.38), 0.18)
        : "rgba(6,14,12,0.2)";
    ctx.lineWidth = 1.2 + random() * 2.4;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y + 4);
    for (let segment = 1; segment <= 5; segment += 1) {
      const progress = segment / 5;
      ctx.lineTo(
        top.x +
          direction * length * (0.08 + progress * 0.28) +
          Math.sin(segment * 1.8 + index) * width * 0.002,
        top.y + length * progress,
      );
    }
    ctx.stroke();
  }

  const screeCount = Math.round(
    (width * 0.55 + height * 0.35) * (0.8 + distanceProgress(state) * 0.65),
  );
  for (let index = 0; index < screeCount; index += 1) {
    const normalizedX = random();
    const top = pointOnTrail(state, normalizedX, width, height).y;
    const y = top + random() * Math.min(height * 0.42, height - top);
    const x = normalizedX * width + (random() - 0.5) * width * 0.012;
    const size = 0.8 + random() * 3.4;
    ctx.fillStyle =
      index % 5 === 0
        ? rgba(shade(colors.groundLight, 0.34), 0.28)
        : "rgba(8,16,14,0.24)";
    ctx.beginPath();
    ctx.moveTo(x - size, y + size * 0.45);
    ctx.lineTo(x + size * 0.2, y - size);
    ctx.lineTo(x + size, y + size * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  if (state.biome === "fjord") {
    for (let index = 0; index < 9; index += 1) {
      const x = 0.08 + random() * 0.84;
      const top = pointOnTrail(state, x, width, height);
      if (ridgeElevationAt(state, x) < 0.56) continue;
      ctx.strokeStyle = rgba(shade(colors.water, 0.58), 0.44);
      ctx.lineWidth = 1.5 + random() * 2.5;
      ctx.beginPath();
      ctx.moveTo(top.x, top.y + 8);
      ctx.bezierCurveTo(
        top.x + width * 0.008,
        top.y + height * 0.07,
        top.x - width * 0.006,
        top.y + height * 0.14,
        top.x + width * 0.004,
        top.y + height * (0.18 + random() * 0.1),
      );
      ctx.stroke();
    }
  } else if (state.biome === "karst") {
    ctx.strokeStyle = rgba(colors.treeLight, 0.3);
    ctx.lineWidth = 1.3;
    for (let index = 0; index < 70; index += 1) {
      const x = random() * width;
      const top = pointOnTrail(state, x / width, width, height);
      const length = height * (0.025 + random() * 0.09);
      ctx.beginPath();
      ctx.moveTo(x, top.y + 3);
      ctx.quadraticCurveTo(
        x + (random() - 0.5) * width * 0.015,
        top.y + length * 0.55,
        x + (random() - 0.5) * width * 0.02,
        top.y + length,
      );
      ctx.stroke();
    }
  } else if (state.biome === "himalaya") {
    ctx.strokeStyle = rgba(colors.snow, 0.34);
    ctx.lineWidth = 2;
    for (let index = 0; index < 95; index += 1) {
      const x = random() * width;
      if (ridgeElevationAt(state, x / width) < 0.58) continue;
      const top = pointOnTrail(state, x / width, width, height);
      const length = width * (0.008 + random() * 0.028);
      ctx.beginPath();
      ctx.moveTo(x, top.y + random() * height * 0.09);
      ctx.lineTo(x + length, top.y + height * (0.01 + random() * 0.06));
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = rgba(shade(colors.groundLight, 0.4), 0.2);
    ctx.lineWidth = 2;
    for (let index = 0; index < 55; index += 1) {
      const x = random() * width;
      const top = pointOnTrail(state, x / width, width, height);
      const length = width * (0.008 + random() * 0.024);
      ctx.beginPath();
      ctx.moveTo(x - length, top.y + height * (0.025 + random() * 0.1));
      ctx.lineTo(x + length, top.y + height * (0.02 + random() * 0.09));
      ctx.stroke();
    }
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

interface GeologyPalette {
  sun: string;
  mid: string;
  shade: string;
  seam: string;
}

function geologyForBiome(
  state: HikeState,
  colors: SceneColors,
): GeologyPalette {
  if (state.biome === "fjord") {
    return {
      sun: mix("#9ca7a4", colors.groundLight, 0.24),
      mid: mix("#596a68", colors.ground, 0.18),
      shade: mix("#2d4142", colors.ground, 0.16),
      seam: "#c0c6bc",
    };
  }
  if (state.biome === "karst") {
    return {
      sun: mix("#8b927d", colors.groundLight, 0.28),
      mid: mix("#526354", colors.ground, 0.16),
      shade: mix("#263c35", colors.ground, 0.18),
      seam: "#c1bda2",
    };
  }
  if (state.biome === "himalaya") {
    return {
      sun: mix("#aaa298", colors.groundLight, 0.2),
      mid: mix("#716b68", colors.ground, 0.14),
      shade: mix("#353a40", colors.ground, 0.12),
      seam: "#d0c3ad",
    };
  }
  return {
    sun: mix("#9b9488", colors.groundLight, 0.1),
    mid: mix("#686a64", colors.ground, 0.08),
    shade: mix("#3d4544", colors.ground, 0.08),
    seam: "#c7baa5",
  };
}

function drawMountainFacets(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  colors: SceneColors,
  width: number,
  height: number,
  detailed: boolean,
): void {
  const lightFromLeft = state.light === "dawn";
  ctx.save();
  traceGroundFill(ctx, state, width, height);
  ctx.clip();
  const positions = terrainPositions(state);
  const geology = geologyForBiome(state, colors);

  for (const index of peakIndices(state)) {
    const peak = terrainAnchorPoint(state, index, width, height);
    const leftShoulder = pointOnTrail(
      state,
      (positions[index - 1] + positions[index]) / 2,
      width,
      height,
    );
    const rightShoulder = pointOnTrail(
      state,
      (positions[index] + positions[index + 1]) / 2,
      width,
      height,
    );
    const faceDepth = Math.min(height * 0.34, height * 0.86 - peak.y);
    const faceBottom = peak.y + faceDepth;

    const leftFace = ctx.createLinearGradient(
      peak.x,
      peak.y,
      leftShoulder.x,
      faceBottom,
    );
    leftFace.addColorStop(
      0,
      rgba(lightFromLeft ? geology.sun : geology.shade, detailed ? 0.4 : 0.18),
    );
    leftFace.addColorStop(
      1,
      rgba(lightFromLeft ? geology.mid : geology.shade, detailed ? 0.3 : 0.13),
    );
    ctx.fillStyle = leftFace;
    ctx.beginPath();
    ctx.moveTo(peak.x, peak.y);
    ctx.lineTo(leftShoulder.x, leftShoulder.y);
    ctx.lineTo(peak.x - width * 0.045, faceBottom);
    ctx.lineTo(peak.x + width * 0.006, faceBottom - height * 0.035);
    ctx.closePath();
    ctx.fill();

    const rightFace = ctx.createLinearGradient(
      peak.x,
      peak.y,
      rightShoulder.x,
      faceBottom,
    );
    rightFace.addColorStop(
      0,
      rgba(lightFromLeft ? geology.shade : geology.sun, detailed ? 0.42 : 0.19),
    );
    rightFace.addColorStop(
      1,
      rgba(lightFromLeft ? geology.shade : geology.mid, detailed ? 0.31 : 0.14),
    );
    ctx.fillStyle = rightFace;
    ctx.beginPath();
    ctx.moveTo(peak.x, peak.y);
    ctx.lineTo(rightShoulder.x, rightShoulder.y);
    ctx.lineTo(peak.x + width * 0.072, faceBottom - height * 0.02);
    ctx.lineTo(peak.x + width * 0.006, faceBottom - height * 0.035);
    ctx.closePath();
    ctx.fill();

    const random = makeRng(state.seed + index * 617);
    const lineCount = detailed ? 22 : 8;
    for (let line = 0; line < lineCount; line += 1) {
      const side = random() < 0.48 ? -1 : 1;
      const startX = peak.x + side * width * (0.003 + random() * 0.018);
      const startY = peak.y + height * (0.025 + random() * 0.07);
      const geologyLean =
        state.biome === "fjord" || state.biome === "karst"
          ? 0.32
          : state.biome === "himalaya"
            ? 0.72
            : 1;
      const endX =
        startX + side * width * (0.018 + random() * 0.062) * geologyLean;
      const endY = startY + height * (0.055 + random() * 0.13);
      ctx.strokeStyle =
        side === (lightFromLeft ? -1 : 1)
          ? rgba(geology.seam, detailed ? 0.28 : 0.14)
          : rgba(geology.shade, detailed ? 0.42 : 0.2);
      ctx.lineWidth = Math.max(
        detailed ? 1 : 0.7,
        width * (0.00055 + random() * 0.00055),
      );
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

function drawSummerSnowCouloirs(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  colors: SceneColors,
  geology: GeologyPalette,
  width: number,
  height: number,
  detailed: boolean,
  peakIndex: number,
  peakX: number,
  radius: number,
): void {
  const random = makeRng(state.seed + peakIndex * 2017 + 313);
  const objectScale = worldObjectScale(state);
  const count =
    state.biome === "himalaya" ? (detailed ? 3 : 2) : detailed ? 2 : 1;
  const depthBase =
    height *
    (state.biome === "himalaya"
      ? 0.075
      : state.biome === "cascades"
        ? 0.045
        : 0.038) *
    objectScale;

  for (let tongue = 0; tongue < count; tongue += 1) {
    const distribution = count === 1 ? 0 : tongue / (count - 1) - 0.5;
    const centerX =
      peakX + distribution * radius * 0.88 + (random() - 0.5) * radius * 0.28;
    const halfWidth = radius * (0.11 + random() * 0.08);
    const leftX = centerX - halfWidth;
    const rightX = centerX + halfWidth;
    const left = pointOnTrail(state, leftX, width, height);
    const center = pointOnTrail(state, centerX, width, height);
    const right = pointOnTrail(state, rightX, width, height);
    const depth = depthBase * (0.62 + random() * 0.46);
    const drift = (random() - 0.5) * halfWidth * width * 1.5;
    const waist = halfWidth * width * (0.58 + random() * 0.42);
    const tip = {
      x: center.x + drift,
      y: center.y + depth,
    };

    const traceTongue = (): void => {
      ctx.beginPath();
      ctx.moveTo(left.x, left.y + 1.5 * objectScale);
      ctx.quadraticCurveTo(
        center.x,
        center.y - 1.5 * objectScale,
        right.x,
        right.y + 1.5 * objectScale,
      );
      ctx.bezierCurveTo(
        tip.x + waist,
        lerp(center.y, tip.y, 0.5),
        tip.x + waist * 0.45,
        lerp(center.y, tip.y, 0.82),
        tip.x,
        tip.y,
      );
      ctx.bezierCurveTo(
        tip.x - waist * 0.42,
        lerp(center.y, tip.y, 0.8),
        tip.x - waist,
        lerp(center.y, tip.y, 0.5),
        left.x,
        left.y + 1.5 * objectScale,
      );
      ctx.closePath();
    };

    ctx.save();
    ctx.translate(0, (detailed ? 3 : 2) * objectScale);
    traceTongue();
    ctx.fillStyle = "rgba(19,29,33,0.34)";
    ctx.fill();
    ctx.translate(0, -(detailed ? 3 : 2) * objectScale);

    traceTongue();
    const snow = ctx.createLinearGradient(0, center.y, 0, tip.y);
    snow.addColorStop(0, shade(colors.snow, 0.04));
    snow.addColorStop(0.48, colors.snow);
    snow.addColorStop(1, mix(colors.snow, "#8299a3", 0.48));
    ctx.fillStyle = snow;
    ctx.fill();

    ctx.save();
    traceTongue();
    ctx.clip();
    ctx.strokeStyle = "rgba(74,101,114,0.38)";
    ctx.lineWidth = detailed ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y + 2 * objectScale);
    ctx.bezierCurveTo(
      center.x + (random() - 0.5) * 7 * objectScale,
      lerp(center.y, tip.y, 0.38),
      tip.x + (random() - 0.5) * 8 * objectScale,
      lerp(center.y, tip.y, 0.74),
      tip.x,
      tip.y,
    );
    ctx.stroke();

    const rockCount = detailed ? 5 : 2;
    ctx.fillStyle = rgba(geology.shade, 0.82);
    for (let rock = 0; rock < rockCount; rock += 1) {
      const progress = 0.2 + random() * 0.65;
      const x =
        lerp(center.x, tip.x, progress) + (random() - 0.5) * waist * 1.35;
      const y = lerp(center.y, tip.y, progress);
      const size = (1.2 + random() * 3) * objectScale;
      ctx.beginPath();
      ctx.moveTo(x - size, y + size * 0.5);
      ctx.lineTo(x, y - size);
      ctx.lineTo(x + size, y + size * 0.45);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.42)";
    ctx.lineWidth = detailed ? 1.2 : 0.8;
    ctx.beginPath();
    ctx.moveTo(left.x, left.y + 1.5 * objectScale);
    ctx.quadraticCurveTo(
      center.x,
      center.y,
      right.x,
      right.y + 1.5 * objectScale,
    );
    ctx.stroke();
    ctx.restore();
  }
}

function drawSnowCaps(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  colors: SceneColors,
  width: number,
  height: number,
  detailed: boolean,
): void {
  const hasSeasonalSnow =
    state.season === "winter" ||
    state.biome === "himalaya" ||
    state.biome === "cascades" ||
    state.biome === "fjord";
  if (!hasSeasonalSnow) return;

  const positions = terrainPositions(state);
  const geology = geologyForBiome(state, colors);
  const objectScale = worldObjectScale(state);
  const threshold =
    state.season === "winter"
      ? 0.48
      : state.biome === "himalaya"
        ? 0.54
        : state.biome === "cascades"
          ? 0.8
          : 0.86;
  const coverage = 0.9;

  for (const index of peakIndices(state)) {
    if (state.terrain[index] < threshold) continue;
    const random = makeRng(state.seed + index * 1229 + 811);
    if (
      state.season !== "winter" &&
      (state.biome === "cascades" || state.biome === "fjord") &&
      random() < 0.42
    ) {
      continue;
    }
    const peakX = positions[index];
    const leftSpan = peakX - positions[index - 1];
    const rightSpan = positions[index + 1] - peakX;
    if (state.season !== "winter") {
      drawSummerSnowCouloirs(
        ctx,
        state,
        colors,
        geology,
        width,
        height,
        detailed,
        index,
        peakX,
        Math.min(leftSpan, rightSpan) *
          (state.biome === "himalaya" ? 0.72 : 0.48),
      );
      continue;
    }
    const radius = Math.min(leftSpan, rightSpan) * coverage;
    const sampleCount = detailed ? 27 : 15;
    const top = Array.from({ length: sampleCount }, (_, sampleIndex) => {
      const progress = sampleIndex / (sampleCount - 1);
      const normalizedX = peakX - radius + progress * radius * 2;
      return pointOnTrail(state, normalizedX, width, height);
    });
    const baseDepth = height * 0.12 * objectScale;
    const bottom = top.map((point, sampleIndex) => {
      const progress = sampleIndex / (sampleCount - 1);
      const envelope = Math.pow(Math.sin(progress * Math.PI), 0.64);
      const rib =
        0.62 +
        Math.sin(progress * Math.PI * (4 + (index % 3)) + state.seed * 0.01) *
          0.16 +
        random() * 0.22;
      return {
        x:
          point.x +
          Math.sin(progress * Math.PI * 5 + index) *
            (detailed ? 4 : 2) *
            objectScale,
        y: point.y + baseDepth * envelope * rib,
      };
    });

    ctx.save();
    ctx.translate(0, (detailed ? 4 : 2) * objectScale);
    traceSnowPatch(ctx, top, bottom);
    ctx.fillStyle = "rgba(20,29,32,0.34)";
    ctx.fill();
    ctx.translate(0, -(detailed ? 4 : 2) * objectScale);

    traceSnowPatch(ctx, top, bottom);
    const snow = ctx.createLinearGradient(
      0,
      Math.min(...top.map((point) => point.y)),
      0,
      Math.max(...bottom.map((point) => point.y)),
    );
    snow.addColorStop(0, shade(colors.snow, 0.05));
    snow.addColorStop(0.38, colors.snow);
    snow.addColorStop(
      0.78,
      mix(
        colors.snow,
        state.biome === "himalaya" ? "#8ca1aa" : "#8da4aa",
        0.34,
      ),
    );
    snow.addColorStop(1, mix(colors.snow, geology.shade, 0.48));
    ctx.fillStyle = snow;
    ctx.fill();

    ctx.save();
    traceSnowPatch(ctx, top, bottom);
    ctx.clip();

    const ribCount = detailed ? 3 : 1;
    for (let rib = 0; rib < ribCount; rib += 1) {
      const progress = 0.16 + (rib / Math.max(1, ribCount - 1)) * 0.68;
      const sampleIndex = Math.min(
        sampleCount - 2,
        Math.max(1, Math.round(progress * (sampleCount - 1))),
      );
      const start = top[sampleIndex];
      const end = bottom[sampleIndex];
      const topWidth = (1.4 + random() * 2.8) * objectScale;
      const bottomWidth =
        (state.biome === "himalaya" ? 8 + random() * 13 : 4 + random() * 7) *
        objectScale;
      ctx.fillStyle = rgba(
        rib % 2 === 0 ? geology.mid : geology.shade,
        state.season === "winter" ? 0.72 : 0.94,
      );
      ctx.beginPath();
      ctx.moveTo(start.x - topWidth, start.y - 1 * objectScale);
      ctx.bezierCurveTo(
        start.x - bottomWidth * 0.45,
        lerp(start.y, end.y, 0.42),
        end.x - bottomWidth,
        lerp(start.y, end.y, 0.78),
        end.x - bottomWidth * 0.55,
        end.y + 2 * objectScale,
      );
      ctx.lineTo(end.x + bottomWidth * 0.55, end.y + 2 * objectScale);
      ctx.bezierCurveTo(
        end.x + bottomWidth,
        lerp(start.y, end.y, 0.76),
        start.x + bottomWidth * 0.4,
        lerp(start.y, end.y, 0.4),
        start.x + topWidth,
        start.y - 1 * objectScale,
      );
      ctx.closePath();
      ctx.fill();
    }

    const gullyCount = detailed ? 13 : 5;
    ctx.strokeStyle = "rgba(77,103,117,0.38)";
    ctx.lineWidth = detailed ? 1.7 : 1;
    for (let gully = 0; gully < gullyCount; gully += 1) {
      const progress = 0.08 + random() * 0.84;
      const sampleIndex = Math.min(
        sampleCount - 1,
        Math.round(progress * (sampleCount - 1)),
      );
      const start = top[sampleIndex];
      const end = bottom[sampleIndex];
      ctx.beginPath();
      ctx.moveTo(start.x, start.y + 2 * objectScale);
      ctx.bezierCurveTo(
        start.x + (random() - 0.5) * 12 * objectScale,
        lerp(start.y, end.y, 0.38),
        end.x + (random() - 0.5) * 15 * objectScale,
        lerp(start.y, end.y, 0.72),
        end.x,
        end.y,
      );
      ctx.stroke();
    }

    const rockCount = detailed ? 22 : 7;
    ctx.fillStyle = rgba(geology.shade, 0.88);
    for (let rock = 0; rock < rockCount; rock += 1) {
      const progress = 0.08 + random() * 0.84;
      const sampleIndex = Math.min(
        sampleCount - 1,
        Math.round(progress * (sampleCount - 1)),
      );
      const start = top[sampleIndex];
      const end = bottom[sampleIndex];
      const x = lerp(start.x, end.x, random() * 0.92);
      const y = lerp(start.y, end.y, 0.22 + random() * 0.7);
      const rockWidth = (1.5 + random() * (detailed ? 6 : 3.5)) * objectScale;
      const rockHeight = (1.2 + random() * (detailed ? 5 : 3)) * objectScale;
      ctx.beginPath();
      ctx.moveTo(x - rockWidth, y + rockHeight);
      ctx.lineTo(x - rockWidth * 0.2, y - rockHeight);
      ctx.lineTo(x + rockWidth, y + rockHeight * 0.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.48)";
    ctx.lineWidth = detailed ? 1.5 : 1;
    ctx.beginPath();
    for (let sampleIndex = 1; sampleIndex < top.length - 1; sampleIndex += 1) {
      const point = top[sampleIndex];
      if (sampleIndex === 1) ctx.moveTo(point.x, point.y + 1);
      else ctx.lineTo(point.x, point.y + 1);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function slopeAt(
  state: HikeState,
  normalizedX: number,
  width: number,
  height: number,
): number {
  const delta = 0.003;
  const before = pointOnTrail(
    state,
    Math.max(0.03, normalizedX - delta),
    width,
    height,
  );
  const after = pointOnTrail(
    state,
    Math.min(0.97, normalizedX + delta),
    width,
    height,
  );
  return Math.atan2(after.y - before.y, after.x - before.x);
}

function drawDetailedConifer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colors: SceneColors,
  snow: boolean,
  slope: number,
  seed: number,
  tiers = 10,
): void {
  const random = makeRng(seed);
  ctx.save();

  ctx.fillStyle = "rgba(7,17,13,0.28)";
  ctx.beginPath();
  ctx.ellipse(
    x,
    y + size * 0.015,
    size * 0.3,
    size * 0.055,
    slope,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  const trunk = ctx.createLinearGradient(
    x - size * 0.05,
    0,
    x + size * 0.07,
    0,
  );
  trunk.addColorStop(0, "#251d15");
  trunk.addColorStop(0.55, "#5a4030");
  trunk.addColorStop(1, "#1b1712");
  ctx.fillStyle = trunk;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.035, y);
  ctx.lineTo(x - size * 0.018, y - size * 0.82);
  ctx.lineTo(x + size * 0.025, y - size * 0.82);
  ctx.lineTo(x + size * 0.055, y);
  ctx.closePath();
  ctx.fill();

  for (let tier = tiers - 1; tier >= 0; tier -= 1) {
    const progress = tier / (tiers - 1);
    const branchY = y - size * (0.84 - progress * 0.67);
    const half = size * (0.055 + progress * 0.235);
    const irregularLeft = 0.78 + random() * 0.34;
    const irregularRight = 0.78 + random() * 0.34;
    const drop = size * (0.1 + progress * 0.035);
    const branchColor =
      tier % 3 === 0
        ? shade(colors.tree, -0.16)
        : tier % 3 === 1
          ? colors.tree
          : shade(colors.treeLight, -0.12);
    ctx.fillStyle = branchColor;
    ctx.beginPath();
    ctx.moveTo(x, branchY - size * 0.075);
    ctx.bezierCurveTo(
      x - half * 0.32,
      branchY - size * 0.025,
      x - half * 0.72,
      branchY + drop * 0.55,
      x - half * irregularLeft,
      branchY + drop,
    );
    ctx.lineTo(x - half * 0.18, branchY + drop * 0.77);
    ctx.lineTo(x, branchY + drop * 1.1);
    ctx.lineTo(x + half * 0.2, branchY + drop * 0.76);
    ctx.lineTo(x + half * irregularRight, branchY + drop);
    ctx.bezierCurveTo(
      x + half * 0.7,
      branchY + drop * 0.5,
      x + half * 0.3,
      branchY - size * 0.025,
      x,
      branchY - size * 0.075,
    );
    ctx.fill();

    ctx.strokeStyle = rgba(shade(colors.treeLight, 0.42), 0.2);
    ctx.lineWidth = Math.max(0.7, size * 0.009);
    ctx.beginPath();
    ctx.moveTo(x, branchY + drop * 0.25);
    ctx.lineTo(x - half * 0.72, branchY + drop * 0.78);
    ctx.moveTo(x + size * 0.01, branchY + drop * 0.22);
    ctx.lineTo(x + half * 0.68, branchY + drop * 0.76);
    ctx.stroke();

    if (snow && tier % 2 === 0) {
      ctx.strokeStyle = rgba(colors.snow, 0.74);
      ctx.lineWidth = Math.max(1, size * 0.018);
      ctx.beginPath();
      ctx.moveTo(x - half * 0.62, branchY + drop * 0.66);
      ctx.quadraticCurveTo(
        x,
        branchY + drop * 0.48,
        x + half * 0.58,
        branchY + drop * 0.65,
      );
      ctx.stroke();
    }
  }

  ctx.fillStyle = colors.tree;
  ctx.beginPath();
  ctx.moveTo(x, y - size * 0.98);
  ctx.lineTo(x - size * 0.075, y - size * 0.76);
  ctx.lineTo(x + size * 0.07, y - size * 0.77);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTerrainBand(
  ctx: CanvasRenderingContext2D,
  samples: readonly Point[],
  depth: number,
): void {
  ctx.beginPath();
  ctx.moveTo(samples[0].x, samples[0].y);
  for (let index = 1; index < samples.length; index += 1) {
    ctx.lineTo(samples[index].x, samples[index].y);
  }
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const progress = index / Math.max(1, samples.length - 1);
    ctx.lineTo(
      samples[index].x,
      samples[index].y + depth * (0.72 + Math.sin(progress * Math.PI) * 0.28),
    );
  }
  ctx.closePath();
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
  const distanceDensity = 0.72 + distanceProgress(state) * 0.9;
  const count = Math.round((detailed ? 105 : 42) * density * distanceDensity);
  const objectScale = worldObjectScale(state);
  for (let index = 0; index < count; index += 1) {
    const normalizedX = 0.02 + random() * 0.96;
    const inClearing = state.features.some((feature) => {
      const radius =
        feature.type === "lake"
          ? 0.085
          : feature.type === "meadow" || feature.type === "wildflowers"
            ? 0.075
            : feature.type === "camp" || feature.type === "snowfield"
              ? 0.05
              : 0;
      return radius > 0 && Math.abs(feature.x - normalizedX) < radius;
    });
    if (inClearing) continue;
    const point = pointOnTrail(state, normalizedX, width, height);
    const elevation = ridgeElevationAt(state, normalizedX);
    const treeLine =
      state.biome === "himalaya"
        ? 0.48
        : state.biome === "fjord"
          ? 0.72
          : state.biome === "karst"
            ? 0.91
            : 0.7;
    if (elevation > treeLine && random() > (detailed ? 0.08 : 0.2)) continue;
    const baseSize =
      Math.min(width, height) * (detailed ? 0.026 : 0.034) * objectScale;
    const altitudeScale = clamp(1.2 - elevation * 0.58, 0.52, 1.05);
    const size = baseSize * (0.55 + random() * 0.75) * altitudeScale;
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
    const haze = clamp(elevation * (detailed ? 0.28 : 0.18), 0, 0.24);
    drawDetailedConifer(
      ctx,
      point.x,
      point.y + size * 0.035,
      size,
      {
        ...colors,
        tree: mix(colors.tree, colors.far, haze),
        treeLight: mix(colors.treeLight, colors.far, haze),
      },
      state.season === "winter",
      slopeAt(state, normalizedX, width, height),
      state.seed + index * 1877,
      detailed ? 10 : 6,
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
  const objectScale = worldObjectScale(state);
  ctx.strokeStyle = detailed ? "rgba(46,38,25,0.42)" : colors.route;
  ctx.lineWidth = detailed
    ? Math.max(5, width * 0.0065 * objectScale)
    : Math.max(1.5, width * 0.003 * objectScale);
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
    ctx.lineWidth = Math.max(2, width * 0.0028 * objectScale);
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

function drawPostcardTrailDetail(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  colors: SceneColors,
  width: number,
  height: number,
): void {
  const random = makeRng(state.seed + 6211);
  const count = 72 + Math.round(distanceProgress(state) * 48);
  for (let index = 0; index < count; index += 1) {
    const x = 0.058 + (index / Math.max(1, count - 1)) * 0.884;
    const point = pointOnTrail(state, x, width, height);
    const next = pointOnTrail(state, Math.min(0.95, x + 0.004), width, height);
    const angle = Math.atan2(next.y - point.y, next.x - point.x);
    const side = index % 2 === 0 ? -1 : 1;
    const offset = (4 + random() * 7) * worldObjectScale(state);
    const stoneX = point.x + Math.cos(angle + Math.PI / 2) * offset * side;
    const stoneY = point.y + Math.sin(angle + Math.PI / 2) * offset * side;
    const size = 1.5 + random() * 3.2;
    ctx.fillStyle =
      index % 4 === 0
        ? rgba(shade(colors.route, 0.34), 0.75)
        : "rgba(45,39,28,0.62)";
    ctx.beginPath();
    ctx.ellipse(stoneX, stoneY, size * 1.5, size, angle, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(55,44,30,0.42)";
  for (let index = 0; index < 34; index += 1) {
    const x = 0.075 + (index / 33) * 0.85;
    const point = pointOnTrail(state, x, width, height);
    const size = 1.6 + (index % 3) * 0.45;
    ctx.beginPath();
    ctx.ellipse(
      point.x + (index % 2 ? 3 : -3),
      point.y - 2,
      size,
      size * 2.1,
      0.35,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
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
  const detailScale = 0.78 + distanceProgress(state) * 0.72;
  const objectScale = worldObjectScale(state);

  for (let index = 0; index < Math.round(34 * detailScale); index += 1) {
    const x = random() * width;
    const y = height * (0.88 + random() * 0.13);
    const size = width * (0.008 + random() * 0.022) * objectScale;
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
    const grassCount = Math.round(
      (state.biome === "karst" ? 125 : 86) * detailScale,
    );
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
    for (let index = 0; index < Math.round(45 * detailScale); index += 1) {
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
    const size =
      height * (0.16 + random() * (rocky ? 0.08 : 0.16)) * objectScale;
    if (rocky) {
      drawRock(ctx, x, height * 1.02, size * 0.72, shade(colors.ground, -0.26));
    } else {
      drawDetailedConifer(
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
        leftSide ? -0.08 : 0.08,
        state.seed + index * 2089 + 71,
      );
    }
  }
}

function drawForestFeature(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  feature: PlacedFeature,
  colors: SceneColors,
  width: number,
  height: number,
  scale: number,
): void {
  drawDetailedForestFeature(
    ctx,
    state,
    feature,
    colors,
    width,
    height,
    scale,
    0.46,
  );
}

function drawDetailedForestFeature(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  feature: PlacedFeature,
  colors: SceneColors,
  width: number,
  height: number,
  scale: number,
  quality = 1,
): void {
  const random = makeRng(state.seed + feature.id.length * 173 + 911);
  const radius = 0.06 * Math.max(0.72, worldObjectScale(state));
  const surface = Array.from({ length: 29 }, (_, index) => {
    const normalizedX = feature.x - radius + (index / 28) * radius * 2;
    return pointOnTrail(state, normalizedX, width, height);
  });

  ctx.save();
  drawTerrainBand(ctx, surface, 18 * scale);
  const ground = ctx.createLinearGradient(
    0,
    Math.min(...surface.map((point) => point.y)),
    0,
    Math.max(...surface.map((point) => point.y)) + 22 * scale,
  );
  ground.addColorStop(0, rgba(shade(colors.tree, -0.08), 0.62));
  ground.addColorStop(1, rgba(shade(colors.ground, -0.28), 0.12));
  ctx.fillStyle = ground;
  ctx.fill();

  const trees = Math.max(12, Math.round(27 * quality));
  const placements = Array.from({ length: trees }, (_, index) => {
    const row = Math.floor(random() * 3);
    const edgeProgress = (index + 0.5) / trees;
    const edgeEnvelope = Math.pow(Math.sin(edgeProgress * Math.PI), 0.42);
    const normalizedX =
      feature.x -
      radius * 0.9 +
      ((index + 0.18 + random() * 0.74) / trees) * radius * 1.8;
    const point = pointOnTrail(state, normalizedX, width, height);
    return {
      normalizedX,
      row,
      point,
      size:
        Math.min(width, height) *
        (0.026 + edgeEnvelope * 0.03 + row * 0.006 + random() * 0.022) *
        Math.max(0.72, worldObjectScale(state)),
    };
  }).sort(
    (first, second) =>
      first.point.y +
      first.row * 5 * scale -
      (second.point.y + second.row * 5 * scale),
  );

  for (let index = 0; index < placements.length; index += 1) {
    const tree = placements[index];
    const rowOffset = tree.row * (3 + random() * 3) * scale;
    drawDetailedConifer(
      ctx,
      tree.point.x,
      tree.point.y + rowOffset,
      tree.size,
      {
        ...colors,
        tree:
          tree.row === 0
            ? mix(colors.tree, colors.far, 0.22)
            : shade(colors.tree, tree.row === 2 ? -0.12 : 0),
        treeLight:
          tree.row === 0
            ? mix(colors.treeLight, colors.far, 0.28)
            : colors.treeLight,
      },
      state.season === "winter",
      slopeAt(state, tree.normalizedX, width, height),
      state.seed + index * 977 + feature.id.length,
      quality >= 0.8 ? 10 : 6,
    );
  }

  ctx.fillStyle = rgba(shade(colors.tree, -0.2), 0.34);
  const shrubCount = Math.max(16, Math.round(42 * quality));
  for (let index = 0; index < shrubCount; index += 1) {
    const normalizedX = feature.x - radius * 0.94 + random() * radius * 1.88;
    const point = pointOnTrail(state, normalizedX, width, height);
    const shrub = (1.5 + random() * 4) * scale;
    ctx.beginPath();
    ctx.arc(
      point.x + (random() - 0.5) * 3 * scale,
      point.y - shrub * 0.35,
      shrub,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.strokeStyle = rgba(shade(colors.treeLight, 0.16), 0.62);
  ctx.lineWidth = Math.max(1, 1.1 * scale);
  for (let index = 1; index < surface.length - 1; index += 2) {
    const point = surface[index];
    const blade = (3 + random() * 8) * scale;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y + 2 * scale);
    ctx.lineTo(point.x + (random() - 0.5) * 4 * scale, point.y - blade);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMeadowFeature(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  feature: PlacedFeature,
  colors: SceneColors,
  width: number,
  height: number,
  scale: number,
): void {
  drawDetailedMeadowFeature(
    ctx,
    state,
    feature,
    colors,
    width,
    height,
    scale,
    0.42,
  );
}

function drawDetailedMeadowFeature(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  feature: PlacedFeature,
  colors: SceneColors,
  width: number,
  height: number,
  scale: number,
  quality = 1,
): void {
  const random = makeRng(state.seed + feature.id.length * 193 + 1427);
  const radius = 0.068 * Math.max(0.72, worldObjectScale(state));
  const surface = Array.from({ length: 35 }, (_, index) => {
    const normalizedX = feature.x - radius + (index / 34) * radius * 2;
    return pointOnTrail(state, normalizedX, width, height);
  });

  ctx.save();
  const meadowDepth = 31 * scale;
  drawTerrainBand(ctx, surface, meadowDepth);
  const meadow = ctx.createLinearGradient(
    0,
    Math.min(...surface.map((point) => point.y)),
    0,
    Math.max(...surface.map((point) => point.y)) + meadowDepth,
  );
  meadow.addColorStop(0, rgba(shade(colors.groundLight, 0.24), 0.82));
  meadow.addColorStop(0.38, rgba(colors.groundLight, 0.66));
  meadow.addColorStop(
    0.76,
    rgba(mix(colors.groundLight, colors.tree, 0.3), 0.4),
  );
  meadow.addColorStop(1, rgba(colors.ground, 0.04));
  ctx.fillStyle = meadow;
  ctx.fill();

  ctx.save();
  drawTerrainBand(ctx, surface, meadowDepth);
  ctx.clip();

  const patchCount = Math.max(14, Math.round(34 * quality));
  for (let index = 0; index < patchCount; index += 1) {
    const normalizedX = feature.x - radius * 0.92 + random() * radius * 1.84;
    const point = pointOnTrail(state, normalizedX, width, height);
    const patchWidth = (5 + random() * 15) * scale;
    const patchHeight = (2 + random() * 5) * scale;
    ctx.fillStyle =
      index % 3 === 0
        ? rgba(shade(colors.groundLight, 0.34), 0.17)
        : index % 3 === 1
          ? rgba(mix(colors.groundLight, "#88724f", 0.28), 0.16)
          : rgba(colors.treeLight, 0.13);
    ctx.beginPath();
    ctx.ellipse(
      point.x + (random() - 0.5) * 8 * scale,
      point.y + random() * meadowDepth * 0.72,
      patchWidth,
      patchHeight,
      slopeAt(state, normalizedX, width, height),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.strokeStyle = rgba(shade(colors.groundLight, 0.34), 0.68);
  ctx.lineWidth = Math.max(0.8, scale * 0.72);
  const grassCount = Math.max(58, Math.round(148 * quality));
  for (let index = 0; index < grassCount; index += 1) {
    const normalizedX = feature.x - radius * 0.94 + random() * radius * 1.88;
    const point = pointOnTrail(state, normalizedX, width, height);
    const blade = (3 + random() * 8) * scale;
    const downSlope = random() * meadowDepth * 0.78;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y + downSlope + 2 * scale);
    ctx.quadraticCurveTo(
      point.x + (random() - 0.5) * 3 * scale,
      point.y + downSlope - blade * 0.55,
      point.x + (random() - 0.5) * 7 * scale,
      point.y + downSlope - blade,
    );
    ctx.stroke();
  }

  const flowerColors = ["#e9ca69", "#df7c78", "#cec2e7", "#ece7d7"];
  const clusterCount = quality >= 0.8 ? 5 : 3;
  const flowerCenters = Array.from({ length: clusterCount }, () => ({
    x: feature.x - radius * 0.72 + random() * radius * 1.44,
    depth: random() * meadowDepth * 0.55,
  }));
  for (let cluster = 0; cluster < flowerCenters.length; cluster += 1) {
    const center = flowerCenters[cluster];
    const flowersPerCluster = quality >= 0.8 ? 10 : 6;
    for (let index = 0; index < flowersPerCluster; index += 1) {
      const normalizedX = center.x + (random() - 0.5) * radius * 0.22;
      const point = pointOnTrail(state, normalizedX, width, height);
      const downSlope = center.depth + (random() - 0.5) * 6 * scale;
      const stem = (3 + random() * 6) * scale;
      ctx.strokeStyle = rgba(shade(colors.treeLight, -0.08), 0.72);
      ctx.lineWidth = Math.max(0.7, scale * 0.6);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y + downSlope + 1.5 * scale);
      ctx.lineTo(
        point.x + (random() - 0.5) * 2 * scale,
        point.y + downSlope - stem,
      );
      ctx.stroke();
      ctx.fillStyle = rgba(
        flowerColors[(cluster + index) % flowerColors.length],
        0.82,
      );
      ctx.beginPath();
      ctx.arc(
        point.x + (random() - 0.5) * 2 * scale,
        point.y + downSlope - stem,
        (0.8 + random() * 1.1) * scale,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.restore();

  for (const side of [-1, 1] as const) {
    const normalizedX = feature.x + side * radius * 0.95;
    const point = pointOnTrail(state, normalizedX, width, height);
    drawRock(
      ctx,
      point.x,
      point.y + 3 * scale,
      (7 + random() * 6) * scale,
      shade(colors.groundLight, -0.12),
    );
  }
  ctx.restore();
}

function drawLakeFeature(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  feature: PlacedFeature,
  colors: SceneColors,
  width: number,
  height: number,
  scale: number,
): void {
  drawDetailedLakeFeature(
    ctx,
    state,
    feature,
    colors,
    width,
    height,
    scale,
    0.48,
  );
}

function drawDetailedLakeFeature(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  feature: PlacedFeature,
  colors: SceneColors,
  width: number,
  height: number,
  scale: number,
  quality = 1,
): void {
  const random = makeRng(state.seed + feature.id.length * 101 + 1889);
  const radius = 0.045 * Math.max(0.72, worldObjectScale(state));
  const samples = Array.from({ length: 41 }, (_, index) => {
    const x = feature.x - radius + (index / 40) * radius * 2;
    return { normalizedX: x, ...pointOnTrail(state, x, width, height) };
  });
  const centerIndex = 20;
  const center = samples[centerIndex];
  const lowerRimY = Math.max(samples[2].y, samples[samples.length - 3].y);
  const basinFloorY = Math.max(...samples.map((sample) => sample.y));
  const availableDepth = Math.max(8 * scale, basinFloorY - lowerRimY);
  const waterY = Math.min(
    basinFloorY - 3 * scale,
    lowerRimY + availableDepth * 0.28,
  );

  let leftIndex = centerIndex;
  let rightIndex = centerIndex;
  while (leftIndex > 1 && samples[leftIndex - 1].y >= waterY) leftIndex -= 1;
  while (
    rightIndex < samples.length - 2 &&
    samples[rightIndex + 1].y >= waterY
  ) {
    rightIndex += 1;
  }
  if (rightIndex - leftIndex < 8) {
    leftIndex = Math.max(2, centerIndex - 6);
    rightIndex = Math.min(samples.length - 3, centerIndex + 6);
  }

  const left = samples[leftIndex];
  const right = samples[rightIndex];
  const basin = samples.slice(leftIndex, rightIndex + 1);
  const waterDepth = Math.max(4 * scale, basinFloorY - waterY);

  function traceWater(): void {
    ctx.beginPath();
    ctx.moveTo(left.x, waterY);
    ctx.bezierCurveTo(
      center.x - (right.x - left.x) * 0.22,
      waterY - 0.7 * scale,
      center.x + (right.x - left.x) * 0.2,
      waterY + 0.55 * scale,
      right.x,
      waterY,
    );
    for (let index = basin.length - 1; index >= 0; index -= 1) {
      ctx.lineTo(basin[index].x, Math.max(waterY, basin[index].y));
    }
    ctx.closePath();
  }

  ctx.save();
  const basinShadow = ctx.createRadialGradient(
    center.x,
    waterY,
    0,
    center.x,
    waterY,
    Math.max(20, right.x - left.x),
  );
  basinShadow.addColorStop(0, "rgba(7,18,17,0.42)");
  basinShadow.addColorStop(0.62, "rgba(10,24,20,0.18)");
  basinShadow.addColorStop(1, "rgba(10,24,20,0)");
  ctx.fillStyle = basinShadow;
  ctx.beginPath();
  ctx.ellipse(
    center.x,
    waterY + waterDepth * 0.5,
    (right.x - left.x) * 0.65,
    waterDepth * 2.4,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  const water = ctx.createLinearGradient(0, waterY, 0, waterY + waterDepth);
  water.addColorStop(0, shade(colors.water, 0.42));
  water.addColorStop(0.36, colors.water);
  water.addColorStop(0.72, mix(colors.water, colors.ground, 0.2));
  water.addColorStop(1, shade(colors.water, -0.32));
  ctx.fillStyle = water;
  traceWater();
  ctx.fill();

  ctx.save();
  traceWater();
  ctx.clip();
  ctx.strokeStyle = "rgba(240,246,231,0.42)";
  ctx.lineWidth = Math.max(1, 0.8 * scale);
  const rippleCount = Math.max(3, Math.round(7 * quality));
  for (let index = 0; index < rippleCount; index += 1) {
    const y = waterY + (index / rippleCount) * waterDepth;
    const inset = (index % 3) * (right.x - left.x) * 0.07;
    ctx.beginPath();
    ctx.moveTo(left.x + inset + random() * 6 * scale, y);
    ctx.lineTo(right.x - inset - random() * 8 * scale, y + random() * scale);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(225,237,221,0.16)";
  const reflectionWidth = (right.x - left.x) * 0.16;
  ctx.beginPath();
  ctx.moveTo(center.x - reflectionWidth * 0.35, waterY);
  ctx.lineTo(center.x + reflectionWidth, waterY + waterDepth);
  ctx.lineTo(center.x - reflectionWidth, waterY + waterDepth);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(8,19,19,0.13)";
  const submergedCount = Math.max(4, Math.round(9 * quality));
  for (let index = 0; index < submergedCount; index += 1) {
    const progress = 0.08 + (index / 9) * 0.84;
    const sample =
      basin[
        Math.min(basin.length - 1, Math.round(progress * (basin.length - 1)))
      ];
    ctx.beginPath();
    ctx.ellipse(
      sample.x,
      lerp(waterY, sample.y, 0.68),
      (2 + random() * 5) * scale,
      (0.8 + random() * 1.8) * scale,
      random() * 0.4 - 0.2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = rgba(shade(colors.ground, -0.32), 0.94);
  ctx.lineWidth = Math.max(2, 2.6 * scale);
  ctx.beginPath();
  ctx.moveTo(left.x - 5 * scale, waterY + 1 * scale);
  ctx.quadraticCurveTo(
    center.x,
    waterY - 1.2 * scale,
    right.x + 5 * scale,
    waterY,
  );
  ctx.stroke();

  ctx.strokeStyle = rgba(shade(colors.groundLight, -0.18), 0.38);
  ctx.lineWidth = Math.max(1, 1.5 * scale);
  ctx.beginPath();
  ctx.moveTo(basin[0].x, basin[0].y);
  for (let index = 1; index < basin.length; index += 1) {
    ctx.lineTo(basin[index].x, basin[index].y);
  }
  ctx.stroke();

  const bankCount = Math.max(7, Math.round(13 * quality));
  for (let index = 0; index < bankCount; index += 1) {
    const progress = index / (bankCount - 1);
    const sampleIndex = Math.min(
      basin.length - 1,
      Math.round(progress * (basin.length - 1)),
    );
    const sample = basin[sampleIndex];
    const edgeStone = index < 3 || index > bankCount - 4;
    const x = sample.x + (random() - 0.5) * 3 * scale;
    const y = edgeStone
      ? waterY + (random() - 0.5) * 2 * scale
      : sample.y + random() * 1.5 * scale;
    const size =
      (edgeStone ? 3.8 + random() * 5.2 : 2 + random() * 3.2) * scale;
    drawRock(
      ctx,
      x,
      y,
      size,
      index % 3 === 0
        ? shade(colors.groundLight, 0.08)
        : shade(colors.ground, -0.16),
    );
  }

  ctx.strokeStyle = rgba(shade(colors.treeLight, 0.12), 0.6);
  ctx.lineWidth = Math.max(0.8, scale * 0.7);
  for (const shore of [left, right]) {
    const reedCount = quality >= 0.8 ? 6 : 3;
    for (let index = 0; index < reedCount; index += 1) {
      const x = shore.x + (random() - 0.5) * 12 * scale;
      const blade = (3 + random() * 7) * scale;
      ctx.beginPath();
      ctx.moveTo(x, waterY + 2 * scale);
      ctx.lineTo(x + (random() - 0.5) * 4 * scale, waterY - blade);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawWaterfallFeature(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  feature: PlacedFeature,
  colors: SceneColors,
  width: number,
  height: number,
  scale: number,
  detailed: boolean,
): void {
  const random = makeRng(state.seed + feature.id.length * 211 + 3001);
  const delta = 0.012;
  const before = pointOnTrail(
    state,
    Math.max(0.04, feature.x - delta),
    width,
    height,
  );
  const after = pointOnTrail(
    state,
    Math.min(0.96, feature.x + delta),
    width,
    height,
  );
  const center = pointOnTrail(state, feature.x, width, height);
  const slopeY = after.y - before.y;
  const downhill = slopeY >= 0 ? 1 : -1;
  const grade = clamp(Math.abs(slopeY) / Math.max(1, after.x - before.x), 0, 2);
  const quality = detailed ? 1 : 0.55;
  const length =
    Math.min(width, height) *
    (0.075 + grade * 0.045) *
    Math.max(0.72, worldObjectScale(state));
  const horizontal = length * lerp(0.62, 0.18, clamp(grade, 0, 1));
  const segments = detailed ? 9 : 6;
  const path: Point[] = [];

  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    const step = progress * progress;
    path.push({
      x:
        center.x +
        downhill * horizontal * progress +
        Math.sin(progress * Math.PI * 4 + state.seed * 0.01) * 2.5 * scale,
      y:
        center.y +
        length * step +
        Math.sin(progress * Math.PI * 3 + feature.id.length) * 1.5 * scale,
    });
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const rockWidth = (detailed ? 15 : 11) * scale;
  ctx.strokeStyle = rgba(shade(colors.ground, -0.28), 0.9);
  ctx.lineWidth = rockWidth;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let index = 1; index < path.length; index += 1) {
    ctx.lineTo(path[index].x, path[index].y);
  }
  ctx.stroke();

  const ledgeCount = detailed ? 7 : 4;
  for (let index = 1; index <= ledgeCount; index += 1) {
    const progress = index / (ledgeCount + 1);
    const sampleIndex = Math.min(
      path.length - 2,
      Math.round(progress * (path.length - 1)),
    );
    const point = path[sampleIndex];
    const ledgeWidth = (8 + random() * 13) * scale;
    ctx.fillStyle =
      index % 2
        ? shade(colors.groundLight, -0.18)
        : shade(colors.ground, -0.08);
    ctx.beginPath();
    ctx.moveTo(point.x - ledgeWidth, point.y + 2 * scale);
    ctx.lineTo(point.x - ledgeWidth * 0.2, point.y - 4 * scale);
    ctx.lineTo(point.x + ledgeWidth, point.y + 1 * scale);
    ctx.lineTo(point.x + ledgeWidth * 0.65, point.y + 6 * scale);
    ctx.lineTo(point.x - ledgeWidth * 0.55, point.y + 7 * scale);
    ctx.closePath();
    ctx.fill();
  }

  const waterGradient = ctx.createLinearGradient(
    path[0].x,
    path[0].y,
    path[path.length - 1].x,
    path[path.length - 1].y,
  );
  waterGradient.addColorStop(0, shade(colors.water, 0.48));
  waterGradient.addColorStop(0.58, colors.water);
  waterGradient.addColorStop(1, shade(colors.water, -0.12));
  ctx.strokeStyle = waterGradient;
  ctx.lineWidth = (detailed ? 6.5 : 4.5) * scale;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const point = path[index];
    ctx.quadraticCurveTo(
      previous.x + (point.x - previous.x) * 0.65,
      previous.y + (point.y - previous.y) * 0.38,
      point.x,
      point.y,
    );
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(244,249,238,0.7)";
  ctx.lineWidth = (detailed ? 1.8 : 1.25) * scale;
  ctx.stroke();

  const pool = path[path.length - 1];
  const poolWidth = (16 + grade * 9) * scale;
  const poolDepth = (4.5 + grade * 2.5) * scale;
  const poolGradient = ctx.createLinearGradient(
    0,
    pool.y - poolDepth,
    0,
    pool.y + poolDepth,
  );
  poolGradient.addColorStop(0, shade(colors.water, 0.38));
  poolGradient.addColorStop(1, shade(colors.water, -0.26));
  ctx.fillStyle = poolGradient;
  ctx.beginPath();
  ctx.ellipse(
    pool.x + downhill * 2 * scale,
    pool.y + 2 * scale,
    poolWidth,
    poolDepth,
    downhill * 0.08,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  const foamCount = Math.max(5, Math.round(13 * quality));
  ctx.fillStyle = "rgba(244,249,240,0.62)";
  for (let index = 0; index < foamCount; index += 1) {
    ctx.beginPath();
    ctx.arc(
      pool.x + (random() - 0.5) * poolWidth * 1.45,
      pool.y + (random() - 0.35) * poolDepth,
      (0.7 + random() * 1.6) * scale,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  if (detailed) {
    ctx.fillStyle = "rgba(239,247,239,0.25)";
    for (let index = 0; index < 18; index += 1) {
      const progress = random();
      const sampleIndex = Math.min(
        path.length - 1,
        Math.round(progress * (path.length - 1)),
      );
      const point = path[sampleIndex];
      ctx.beginPath();
      ctx.arc(
        point.x + (random() - 0.5) * 12 * scale,
        point.y + (random() - 0.5) * 9 * scale,
        (0.5 + random() * 1.4) * scale,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawWildflowersFeature(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  feature: PlacedFeature,
  colors: SceneColors,
  width: number,
  height: number,
  scale: number,
  detailed: boolean,
): void {
  const random = makeRng(state.seed + feature.id.length * 227 + 1613);
  const quality = detailed ? 1 : 0.48;
  const radius = 0.066 * Math.max(0.72, worldObjectScale(state));
  const surface = Array.from({ length: 33 }, (_, index) => {
    const normalizedX = feature.x - radius + (index / 32) * radius * 2;
    return pointOnTrail(state, normalizedX, width, height);
  });
  const depth = 24 * scale;

  ctx.save();
  drawTerrainBand(ctx, surface, depth);
  const ground = ctx.createLinearGradient(
    0,
    Math.min(...surface.map((sample) => sample.y)),
    0,
    Math.max(...surface.map((sample) => sample.y)) + depth,
  );
  ground.addColorStop(0, rgba(shade(colors.groundLight, 0.28), 0.78));
  ground.addColorStop(
    0.52,
    rgba(mix(colors.groundLight, "#718950", 0.38), 0.58),
  );
  ground.addColorStop(1, rgba(colors.ground, 0.08));
  ctx.fillStyle = ground;
  ctx.fill();

  ctx.save();
  drawTerrainBand(ctx, surface, depth);
  ctx.clip();
  const palette = [
    "#f4ce52",
    "#ea7a78",
    "#9eacd9",
    "#d8b2df",
    "#f0eee0",
    "#e79c4a",
    "#80b5cb",
  ];
  const clusterCount = detailed ? 9 : 5;
  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const centerX = feature.x - radius * 0.82 + random() * radius * 1.64;
    const centerDepth = random() * depth * 0.68;
    const flowers = detailed ? 13 : 7;
    for (let index = 0; index < flowers; index += 1) {
      const normalizedX = centerX + (random() - 0.5) * radius * 0.18;
      const point = pointOnTrail(state, normalizedX, width, height);
      const downSlope = centerDepth + (random() - 0.5) * 7 * scale;
      const stem = (3.5 + random() * 8) * scale;
      ctx.strokeStyle = rgba(mix(colors.treeLight, "#4c6b3d", 0.42), 0.8);
      ctx.lineWidth = Math.max(0.7, 0.65 * scale);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y + downSlope + 1.5 * scale);
      ctx.quadraticCurveTo(
        point.x + (random() - 0.5) * 2 * scale,
        point.y + downSlope - stem * 0.55,
        point.x + (random() - 0.5) * 4 * scale,
        point.y + downSlope - stem,
      );
      ctx.stroke();
      const color = palette[(cluster * 2 + index) % palette.length];
      ctx.fillStyle = rgba(color, 0.88);
      const petal = (0.9 + random() * 1.35) * scale;
      const flowerX = point.x + (random() - 0.5) * 4 * scale;
      const flowerY = point.y + downSlope - stem;
      for (let petalIndex = 0; petalIndex < 4; petalIndex += 1) {
        const angle = (petalIndex / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(
          flowerX + Math.cos(angle) * petal,
          flowerY + Math.sin(angle) * petal,
          petal,
          petal * 0.62,
          angle,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.fillStyle = "rgba(76,58,28,0.76)";
      ctx.beginPath();
      ctx.arc(flowerX, flowerY, petal * 0.48, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = rgba(shade(colors.groundLight, -0.1), 0.2);
  const heatherCount = Math.max(18, Math.round(42 * quality));
  for (let index = 0; index < heatherCount; index += 1) {
    const normalizedX = feature.x - radius * 0.93 + random() * radius * 1.86;
    const point = pointOnTrail(state, normalizedX, width, height);
    ctx.beginPath();
    ctx.ellipse(
      point.x,
      point.y + random() * depth * 0.74,
      (2 + random() * 5) * scale,
      (1 + random() * 2.8) * scale,
      slopeAt(state, normalizedX, width, height),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

function drawSnowfieldFeature(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  feature: PlacedFeature,
  colors: SceneColors,
  width: number,
  height: number,
  scale: number,
): void {
  drawDetailedSnowfieldFeature(
    ctx,
    state,
    feature,
    colors,
    width,
    height,
    scale,
    0.46,
  );
}

function traceSnowPatch(
  ctx: CanvasRenderingContext2D,
  top: readonly Point[],
  bottom: readonly Point[],
): void {
  ctx.beginPath();
  ctx.moveTo(top[0].x, top[0].y);
  for (let index = 1; index < top.length; index += 1) {
    ctx.lineTo(top[index].x, top[index].y);
  }
  for (let index = bottom.length - 1; index >= 0; index -= 1) {
    ctx.lineTo(bottom[index].x, bottom[index].y);
  }
  ctx.closePath();
}

function drawDetailedSnowfieldFeature(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  feature: PlacedFeature,
  colors: SceneColors,
  width: number,
  height: number,
  scale: number,
  quality = 1,
): void {
  const random = makeRng(state.seed + feature.id.length * 137 + 4217);
  const radius = 0.052 * Math.max(0.7, worldObjectScale(state));
  const count = 17;
  const top = Array.from({ length: count }, (_, index) => {
    const progress = index / (count - 1);
    const normalizedX = feature.x - radius + progress * radius * 2;
    const point = pointOnTrail(state, normalizedX, width, height);
    return {
      x: point.x,
      y: point.y + (2 + Math.sin(progress * Math.PI * 3) * 1.3) * scale,
    };
  });
  const bottom = top.map((point, index) => {
    const progress = index / (count - 1);
    const envelope = Math.pow(Math.sin(progress * Math.PI), 0.72);
    const depth =
      envelope *
      height *
      (0.045 + random() * 0.035) *
      Math.max(0.72, worldObjectScale(state));
    return {
      x:
        point.x +
        Math.sin(progress * Math.PI * 4 + state.seed * 0.01) * 3 * scale,
      y: point.y + depth,
    };
  });

  ctx.save();
  ctx.translate(0, 3 * scale);
  traceSnowPatch(ctx, top, bottom);
  ctx.fillStyle = "rgba(19,31,31,0.34)";
  ctx.fill();
  ctx.translate(0, -3 * scale);

  traceSnowPatch(ctx, top, bottom);
  const snow = ctx.createLinearGradient(
    0,
    Math.min(...top.map((point) => point.y)),
    0,
    Math.max(...bottom.map((point) => point.y)),
  );
  snow.addColorStop(0, shade(colors.snow, 0.04));
  snow.addColorStop(0.46, colors.snow);
  snow.addColorStop(1, mix(colors.snow, "#7895a0", 0.42));
  ctx.fillStyle = snow;
  ctx.fill();

  ctx.save();
  traceSnowPatch(ctx, top, bottom);
  ctx.clip();

  ctx.strokeStyle = "rgba(84,114,126,0.42)";
  ctx.lineWidth = Math.max(1.2, 1.3 * scale);
  const gullyCount = Math.max(4, Math.round(9 * quality));
  for (let index = 0; index < gullyCount; index += 1) {
    const progress = 0.1 + (index / Math.max(1, gullyCount + 1)) * 0.8;
    const sampleIndex = Math.min(count - 2, Math.round(progress * (count - 1)));
    const start = top[sampleIndex];
    const end = bottom[sampleIndex];
    const midX = lerp(start.x, end.x, 0.5) + (random() - 0.5) * 12 * scale;
    ctx.beginPath();
    ctx.moveTo(start.x + (random() - 0.5) * 5 * scale, start.y + 2 * scale);
    ctx.quadraticCurveTo(
      midX,
      lerp(start.y, end.y, 0.55),
      end.x + (random() - 0.5) * 7 * scale,
      end.y - 2 * scale,
    );
    ctx.stroke();
  }

  ctx.fillStyle = rgba(shade(colors.ground, -0.18), 0.88);
  const exposedRockCount = Math.max(5, Math.round(12 * quality));
  for (let index = 0; index < exposedRockCount; index += 1) {
    const progress = 0.08 + random() * 0.84;
    const sampleIndex = Math.min(count - 1, Math.round(progress * (count - 1)));
    const start = top[sampleIndex];
    const end = bottom[sampleIndex];
    const x = lerp(start.x, end.x, random() * 0.9);
    const y = lerp(start.y, end.y, 0.2 + random() * 0.68);
    const rockWidth = (2 + random() * 5) * scale;
    const rockHeight = (1.5 + random() * 4) * scale;
    ctx.beginPath();
    ctx.moveTo(x - rockWidth, y + rockHeight);
    ctx.lineTo(x - rockWidth * 0.2, y - rockHeight);
    ctx.lineTo(x + rockWidth, y + rockHeight * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.46)";
  ctx.lineWidth = Math.max(1, scale);
  ctx.beginPath();
  for (let index = 1; index < top.length - 1; index += 1) {
    const point = top[index];
    if (index === 1) ctx.moveTo(point.x, point.y + 1 * scale);
    else ctx.lineTo(point.x, point.y + 1 * scale);
  }
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(57,52,44,0.68)";
  const trackCount = Math.max(5, Math.round(8 * quality));
  for (let index = 0; index < trackCount; index += 1) {
    const progress = 0.2 + (index / trackCount) * 0.58;
    const sampleIndex = Math.round(progress * (count - 1));
    const start = top[sampleIndex];
    const end = bottom[sampleIndex];
    ctx.beginPath();
    ctx.ellipse(
      lerp(start.x, end.x, 0.38 + index * 0.035),
      lerp(start.y, end.y, 0.35 + index * 0.045),
      1.7 * scale,
      3.4 * scale,
      0.35,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawCampFeature(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  feature: PlacedFeature,
  colors: SceneColors,
  width: number,
  height: number,
  scale: number,
): void {
  const point = pointOnTrail(state, feature.x, width, height);
  const slope = slopeAt(state, feature.x, width, height);
  const radius = 0.035 * Math.max(0.72, worldObjectScale(state));
  const surface = Array.from({ length: 19 }, (_, index) => {
    const normalizedX = feature.x - radius + (index / 18) * radius * 2;
    return pointOnTrail(state, normalizedX, width, height);
  });
  ctx.save();
  drawTerrainBand(ctx, surface, 12 * scale);
  ctx.fillStyle = rgba(mix(colors.groundLight, "#665944", 0.34), 0.56);
  ctx.fill();
  ctx.fillStyle = "rgba(8,15,12,0.3)";
  ctx.beginPath();
  ctx.ellipse(
    point.x,
    point.y + 3 * scale,
    32 * scale,
    6 * scale,
    slope,
    0,
    Math.PI * 2,
  );
  ctx.fill();
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
  ctx.fillStyle = "#f5b84e";
  ctx.beginPath();
  ctx.arc(point.x + 27 * scale, point.y + 2 * scale, 4 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(75,70,65,0.45)";
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(point.x + 27 * scale, point.y - 3 * scale);
  ctx.bezierCurveTo(
    point.x + 19 * scale,
    point.y - 18 * scale,
    point.x + 37 * scale,
    point.y - 27 * scale,
    point.x + 29 * scale,
    point.y - 41 * scale,
  );
  ctx.stroke();
  drawRock(
    ctx,
    point.x - 35 * scale,
    point.y + 5 * scale,
    13 * scale,
    shade(colors.groundLight, -0.18),
  );
  ctx.restore();
}

function drawLookoutFeature(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  feature: PlacedFeature,
  colors: SceneColors,
  width: number,
  height: number,
  scale: number,
): void {
  const point = pointOnTrail(state, feature.x, width, height);
  const footOffset = 0.012 * Math.max(0.72, worldObjectScale(state));
  const leftFoot = pointOnTrail(
    state,
    Math.max(0.04, feature.x - footOffset),
    width,
    height,
  );
  const rightFoot = pointOnTrail(
    state,
    Math.min(0.96, feature.x + footOffset),
    width,
    height,
  );
  const platformY = Math.min(leftFoot.y, rightFoot.y) - 20 * scale;
  ctx.save();
  ctx.fillStyle = "rgba(7,15,12,0.28)";
  ctx.beginPath();
  ctx.ellipse(
    point.x,
    Math.max(leftFoot.y, rightFoot.y) + 3 * scale,
    34 * scale,
    5 * scale,
    slopeAt(state, feature.x, width, height),
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.strokeStyle = shade(colors.ground, -0.15);
  ctx.lineWidth = 3 * scale;
  ctx.beginPath();
  ctx.moveTo(leftFoot.x, leftFoot.y + 4 * scale);
  ctx.lineTo(point.x - 10 * scale, platformY);
  ctx.moveTo(rightFoot.x, rightFoot.y + 4 * scale);
  ctx.lineTo(point.x + 10 * scale, platformY);
  ctx.moveTo(leftFoot.x, leftFoot.y + 4 * scale);
  ctx.lineTo(point.x + 10 * scale, platformY);
  ctx.moveTo(rightFoot.x, rightFoot.y + 4 * scale);
  ctx.lineTo(point.x - 10 * scale, platformY);
  ctx.stroke();
  ctx.fillStyle = shade(colors.accent, -0.22);
  ctx.fillRect(
    point.x - 22 * scale,
    platformY - 24 * scale,
    44 * scale,
    24 * scale,
  );
  ctx.fillStyle = "#f2c978";
  ctx.fillRect(
    point.x - 15 * scale,
    platformY - 18 * scale,
    12 * scale,
    8 * scale,
  );
  ctx.fillRect(
    point.x + 4 * scale,
    platformY - 18 * scale,
    12 * scale,
    8 * scale,
  );
  ctx.fillStyle = shade(colors.ground, -0.3);
  ctx.beginPath();
  ctx.moveTo(point.x - 28 * scale, platformY - 24 * scale);
  ctx.lineTo(point.x, platformY - 37 * scale);
  ctx.lineTo(point.x + 28 * scale, platformY - 24 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = shade(colors.ground, -0.34);
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(point.x - 36 * scale, platformY);
  ctx.lineTo(point.x + 36 * scale, platformY);
  for (let index = -3; index <= 3; index += 2) {
    ctx.moveTo(point.x + index * 10 * scale, platformY);
    ctx.lineTo(
      point.x + index * 10 * scale,
      lerp(leftFoot.y, rightFoot.y, (index + 3) / 6),
    );
  }
  ctx.stroke();
  ctx.restore();
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
  const scale =
    Math.min(width / 900, height / 600) *
    (detailed ? 1.1 : 0.9) *
    Math.max(0.72, worldObjectScale(state));
  if (feature.type === "forest") {
    if (detailed) {
      drawDetailedForestFeature(
        ctx,
        state,
        feature,
        colors,
        width,
        height,
        scale,
      );
    } else {
      drawForestFeature(ctx, state, feature, colors, width, height, scale);
    }
  } else if (feature.type === "meadow") {
    if (detailed) {
      drawDetailedMeadowFeature(
        ctx,
        state,
        feature,
        colors,
        width,
        height,
        scale,
      );
    } else {
      drawMeadowFeature(ctx, state, feature, colors, width, height, scale);
    }
  } else if (feature.type === "lake") {
    if (detailed) {
      drawDetailedLakeFeature(
        ctx,
        state,
        feature,
        colors,
        width,
        height,
        scale,
      );
    } else {
      drawLakeFeature(ctx, state, feature, colors, width, height, scale);
    }
  } else if (feature.type === "waterfall")
    drawWaterfallFeature(
      ctx,
      state,
      feature,
      colors,
      width,
      height,
      scale,
      detailed,
    );
  else if (feature.type === "wildflowers")
    drawWildflowersFeature(
      ctx,
      state,
      feature,
      colors,
      width,
      height,
      scale,
      detailed,
    );
  else if (feature.type === "snowfield") {
    if (detailed) {
      drawDetailedSnowfieldFeature(
        ctx,
        state,
        feature,
        colors,
        width,
        height,
        scale,
      );
    } else {
      drawSnowfieldFeature(ctx, state, feature, colors, width, height, scale);
    }
  } else if (feature.type === "camp")
    drawCampFeature(ctx, state, feature, colors, width, height, scale);
  else drawLookoutFeature(ctx, state, feature, colors, width, height, scale);
}

function drawFeatureHandle(
  ctx: CanvasRenderingContext2D,
  state: HikeState,
  feature: PlacedFeature,
  width: number,
  height: number,
  active: boolean,
  hovered: boolean,
): void {
  const point = pointOnTrail(state, feature.x, width, height);
  const radius = active ? 8 : hovered ? 7 : 5;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.34)";
  ctx.shadowBlur = active || hovered ? 9 : 4;
  ctx.fillStyle = active ? "#f4ca6d" : "rgba(255,250,240,0.94)";
  ctx.strokeStyle = "#244f3b";
  ctx.lineWidth = active || hovered ? 2.5 : 1.5;
  ctx.beginPath();
  ctx.arc(point.x, point.y - height * 0.008, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (active || hovered) {
    const label =
      feature.type === "lake"
        ? "Alpine lake"
        : feature.type[0].toUpperCase() + feature.type.slice(1);
    ctx.font = "600 12px sans-serif";
    const labelWidth = ctx.measureText(label).width + 16;
    const x = clamp(point.x - labelWidth / 2, 4, width - labelWidth - 4);
    const y = point.y - 32;
    ctx.shadowBlur = 5;
    ctx.fillStyle = "rgba(20,35,28,0.9)";
    ctx.beginPath();
    ctx.roundRect(x, y, labelWidth, 22, 4);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fffaf0";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 8, y + 11);
  }
  ctx.restore();
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
  const scale =
    Math.min(width / 900, height / 600) *
    (detailed ? 1.3 : 1) *
    Math.max(0.76, worldObjectScale(state));
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
  for (let index = 0; index < state.terrain.length; index += 1) {
    const active = index === activeAnchor;
    const hovered = index === hoveredAnchor;
    const endpoint = index === 0 || index === state.terrain.length - 1;
    const extremum =
      !endpoint &&
      ((state.terrain[index] > state.terrain[index - 1] &&
        state.terrain[index] > state.terrain[index + 1]) ||
        (state.terrain[index] < state.terrain[index - 1] &&
          state.terrain[index] < state.terrain[index + 1]));
    const point = terrainAnchorPoint(state, index, width, height);
    const structural = endpoint || extremum;
    const radius = active ? 8 : hovered ? 7 : structural ? 4.5 : 2.75;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = active || hovered ? 9 : 5;
    ctx.fillStyle = active
      ? "#f5cb72"
      : structural
        ? "rgba(255,250,240,0.96)"
        : "rgba(235,225,198,0.72)";
    ctx.strokeStyle = active ? "#3e4d35" : "rgba(40,73,55,0.86)";
    ctx.lineWidth = active || hovered ? 2 : structural ? 1.5 : 1;
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
  drawTerrainMaterialZones(ctx, state, colors, width, height, detailed);
  drawMountainFacets(ctx, state, colors, width, height, detailed);
  if (detailed) drawPostcardTerrainDetail(ctx, state, colors, width, height);
  drawTerrainTexture(ctx, state, colors, width, height, detailed);
  drawSnowCaps(ctx, state, colors, width, height, detailed);
  drawVegetation(ctx, state, colors, width, height, detailed);
  drawTrail(ctx, state, colors, width, height, detailed);
  if (detailed) drawPostcardTrailDetail(ctx, state, colors, width, height);
  for (const feature of state.features) {
    drawFeature(ctx, state, feature, colors, width, height, detailed);
    if (!detailed) {
      drawFeatureHandle(
        ctx,
        state,
        feature,
        width,
        height,
        feature.id === options.activeFeatureId,
        feature.id === options.hoveredFeatureId,
      );
    }
  }

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
  const count = Math.round((width * height) / 760);
  for (let index = 0; index < count; index += 1) {
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
  const width = 2400;
  const height = 1600;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#f4efe4";
  ctx.fillRect(0, 0, width, height);

  const border = 50;
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
