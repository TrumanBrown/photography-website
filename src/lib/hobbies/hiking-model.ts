const LEGACY_TERRAIN_X = [0.04, 0.27, 0.5, 0.73, 0.96] as const;

export type BiomeId = "cascades" | "fjord" | "karst" | "himalaya";
export type SeasonId = "spring" | "summer" | "autumn" | "winter";
export type WeatherId = "clear" | "clouds" | "mist";
export type LightId = "dawn" | "day" | "golden";
export type FeatureId =
  | "forest"
  | "meadow"
  | "lake"
  | "waterfall"
  | "wildflowers"
  | "snowfield"
  | "camp"
  | "lookout";

export interface Biome {
  id: BiomeId;
  label: string;
  postcardLabel: string;
  defaultTitle: string;
  profile: {
    peak: readonly [number, number];
    saddle: readonly [number, number];
    shoulder: readonly [number, number];
  };
  palette: {
    skyTop: string;
    skyBottom: string;
    far: string;
    middle: string;
    ground: string;
    groundLight: string;
    route: string;
    water: string;
    accent: string;
  };
}

export interface TrailFeature {
  id: FeatureId;
  label: string;
  effect: string;
}

export interface PlacedFeature {
  id: string;
  type: FeatureId;
  x: number;
}

export interface HikeState {
  version: 2;
  biome: BiomeId;
  season: SeasonId;
  weather: WeatherId;
  light: LightId;
  distance: number;
  terrain: number[];
  features: PlacedFeature[];
  hikerColor: string;
  routeName: string;
  seed: number;
}

export interface HikeStats {
  distanceMiles: number;
  elevationFeet: number;
  durationHours: number;
  effort: "Easygoing" | "Steady" | "Big day" | "Epic";
}

export const BIOMES: readonly Biome[] = [
  {
    id: "cascades",
    label: "Cascades",
    postcardLabel: "THE CASCADES",
    defaultTitle: "A Trail Above the Trees",
    profile: {
      peak: [0.68, 0.96],
      saddle: [0.24, 0.56],
      shoulder: [0.2, 0.48],
    },
    palette: {
      skyTop: "#6b9ba5",
      skyBottom: "#d7d9b7",
      far: "#789185",
      middle: "#496b59",
      ground: "#203f32",
      groundLight: "#3f6f52",
      route: "#f1c56c",
      water: "#5da1aa",
      accent: "#f3b45d",
    },
  },
  {
    id: "fjord",
    label: "Fjord country",
    postcardLabel: "FJORD COUNTRY",
    defaultTitle: "Long Light over the Fjord",
    profile: {
      peak: [0.78, 0.96],
      saddle: [0.12, 0.38],
      shoulder: [0.15, 0.4],
    },
    palette: {
      skyTop: "#668ca0",
      skyBottom: "#d7d6c8",
      far: "#84979a",
      middle: "#506d68",
      ground: "#263f3c",
      groundLight: "#527267",
      route: "#f0c274",
      water: "#3d7d91",
      accent: "#e4a85e",
    },
  },
  {
    id: "karst",
    label: "Karst forest",
    postcardLabel: "KARST FOREST",
    defaultTitle: "Through the Stone Forest",
    profile: {
      peak: [0.74, 0.94],
      saddle: [0.1, 0.32],
      shoulder: [0.16, 0.38],
    },
    palette: {
      skyTop: "#709b96",
      skyBottom: "#d8d8b7",
      far: "#759281",
      middle: "#3e6c55",
      ground: "#183d2e",
      groundLight: "#3f7254",
      route: "#ecc776",
      water: "#579891",
      accent: "#df9d50",
    },
  },
  {
    id: "himalaya",
    label: "High Himalaya",
    postcardLabel: "HIGH HIMALAYA",
    defaultTitle: "Where the Air Turns Thin",
    profile: {
      peak: [0.82, 0.96],
      saddle: [0.34, 0.66],
      shoulder: [0.28, 0.54],
    },
    palette: {
      skyTop: "#688dad",
      skyBottom: "#d9d7c5",
      far: "#8993a0",
      middle: "#5f6770",
      ground: "#363b3d",
      groundLight: "#77715f",
      route: "#efbd61",
      water: "#6b9eae",
      accent: "#db7748",
    },
  },
] as const;

export const TRAIL_FEATURES: readonly TrailFeature[] = [
  { id: "forest", label: "Forest", effect: "Grows a dense trail corridor" },
  { id: "meadow", label: "Meadow", effect: "Opens and softens the ridgeline" },
  { id: "lake", label: "Alpine lake", effect: "Carves a basin into the route" },
  {
    id: "waterfall",
    label: "Waterfall",
    effect: "Cuts a cliff and stream crossing",
  },
  {
    id: "wildflowers",
    label: "Wildflowers",
    effect: "Creates a broad flowering bench",
  },
  { id: "snowfield", label: "Snowfield", effect: "Adds a high snow crossing" },
  { id: "camp", label: "Camp", effect: "Flattens a sheltered campsite" },
  { id: "lookout", label: "Lookout", effect: "Raises a panoramic spur" },
] as const;

export const HIKER_COLORS = [
  "#d5523f",
  "#e1a13a",
  "#247d72",
  "#355f9b",
  "#7d4f8f",
] as const;

const DEFAULT_FEATURES: readonly PlacedFeature[] = [
  { id: "forest-1", type: "forest", x: 0.17 },
  { id: "lake-1", type: "lake", x: 0.38 },
  { id: "lookout-1", type: "lookout", x: 0.76 },
];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const lerp = (start: number, end: number, amount: number): number =>
  start + (end - start) * amount;

function rangeValue(range: readonly [number, number], amount: number): number {
  return lerp(range[0], range[1], amount);
}

function biomeSeed(biome: BiomeId): number {
  return biome === "cascades"
    ? 0x1439
    : biome === "fjord"
      ? 0x2f17
      : biome === "karst"
        ? 0x4a31
        : 0x6c53;
}

export function mountainCountForDistance(distance: number): number {
  return Math.max(
    1,
    Math.min(7, 1 + Math.floor((clamp(distance, 3, 18) - 3) / 2.5)),
  );
}

export function terrainPointCountForDistance(
  distance: number,
  biome: BiomeId = "cascades",
  seed = 4817,
): number {
  return generateTerrainProfile(biome, distance, seed).length;
}

export function terrainXPositions(
  terrainLength: number,
  seed: number,
  biome: BiomeId,
): number[] {
  const count = Math.max(3, terrainLength);
  const random = makeRng(
    (seed ^ biomeSeed(biome) ^ Math.imul(count, 7919)) >>> 0,
  );
  const start = 0.035;
  const end = 0.965;
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return start;
    if (index === count - 1) return end;
    return start + index * step + (random() - 0.5) * step * 0.42;
  });
}

export function countTerrainPeaks(terrain: readonly number[]): number {
  let peaks = 0;
  for (let index = 1; index < terrain.length - 1; index += 1) {
    if (
      terrain[index] > terrain[index - 1] &&
      terrain[index] > terrain[index + 1]
    ) {
      peaks += 1;
    }
  }
  return peaks;
}

export function generateTerrainProfile(
  biomeId: BiomeId,
  distance: number,
  seed: number,
): number[] {
  const biome = biomeById(biomeId);
  const mountains = mountainCountForDistance(distance);
  const random = makeRng(
    (seed ^ biomeSeed(biomeId) ^ Math.imul(mountains, 104729)) >>> 0,
  );
  const style = Math.floor(random() * 6);
  const terrain: number[] = [0.08 + random() * 0.12];
  terrain.push(rangeValue(biome.profile.shoulder, random()));

  for (let mountain = 0; mountain < mountains; mountain += 1) {
    const progress = mountains === 1 ? 0.5 : mountain / (mountains - 1);
    let emphasis = random();
    if (mountains === 1) emphasis = 0.85 + random() * 0.15;
    else if (style === 0) emphasis = 0.22 + progress * 0.78;
    else if (style === 1) emphasis = 1 - progress * 0.72;
    else if (style === 2) emphasis = 1 - Math.abs(progress - 0.5) * 1.4;
    else if (style === 3) emphasis = mountain % 2 === 0 ? 0.92 : 0.36;
    else if (style === 4) emphasis = 0.58 + random() * 0.3;
    const peak = rangeValue(
      biome.profile.peak,
      clamp(emphasis + (random() - 0.5) * 0.2, 0, 1),
    );
    const safePeak = clamp(peak, 0.52, 0.96);
    const formRoll = random();
    const form =
      mountains === 1
        ? "massif"
        : biomeId === "himalaya"
          ? formRoll < 0.65
            ? "massif"
            : "shoulder"
          : biomeId === "fjord"
            ? formRoll < 0.5
              ? "massif"
              : formRoll < 0.8
                ? "one-sided"
                : "spire"
            : biomeId === "karst"
              ? formRoll < 0.72
                ? "spire"
                : "one-sided"
              : formRoll < 0.35
                ? "massif"
                : formRoll < 0.72
                  ? "one-sided"
                  : "spire";
    const shoulderDrop =
      form === "massif" ? 0.08 + random() * 0.1 : 0.16 + random() * 0.12;
    const leftShoulder = clamp(
      safePeak - shoulderDrop * (0.72 + random() * 0.48),
      biome.profile.shoulder[0],
      safePeak - 0.045,
    );
    const rightShoulder = clamp(
      safePeak - shoulderDrop * (0.72 + random() * 0.48),
      biome.profile.shoulder[0],
      safePeak - 0.045,
    );
    const oneSidedLeft = form === "one-sided" && random() < 0.5;

    if (form === "massif" || oneSidedLeft) {
      terrain.push(leftShoulder);
    }
    terrain.push(safePeak);
    if (form === "massif" || (form === "one-sided" && !oneSidedLeft)) {
      terrain.push(rightShoulder);
    }

    if (mountain < mountains - 1) {
      let saddle = rangeValue(biome.profile.saddle, random());
      if (style === 4) {
        saddle = Math.max(saddle, safePeak - (0.16 + random() * 0.12));
      }
      terrain.push(Math.min(saddle, safePeak - 0.1));
    }
  }

  if (terrain[terrain.length - 1] > biome.profile.shoulder[1]) {
    terrain.push(rangeValue(biome.profile.shoulder, random()));
  }
  terrain.push(0.08 + random() * 0.12);
  return terrain.map((height) => clamp(height, 0.08, 0.96));
}

function isChoice<T extends string>(
  value: unknown,
  choices: readonly T[],
): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

export function biomeById(id: BiomeId): Biome {
  return BIOMES.find((biome) => biome.id === id) ?? BIOMES[0];
}

export function trailFeatureById(id: FeatureId): TrailFeature {
  return (
    TRAIL_FEATURES.find((feature) => feature.id === id) ?? TRAIL_FEATURES[0]
  );
}

export function createDefaultHike(): HikeState {
  const biome = BIOMES[0];
  const distance = 9.2;
  const seed = 4817;
  return {
    version: 2,
    biome: biome.id,
    season: "summer",
    weather: "clouds",
    light: "golden",
    distance,
    terrain: generateTerrainProfile(biome.id, distance, seed),
    features: DEFAULT_FEATURES.map((feature) => ({ ...feature })),
    hikerColor: HIKER_COLORS[0],
    routeName: biome.defaultTitle,
    seed,
  };
}

export function cloneHike(state: HikeState): HikeState {
  return {
    ...state,
    terrain: [...state.terrain],
    features: state.features.map((feature) => ({ ...feature })),
  };
}

export function normalizeHikeState(value: unknown): HikeState {
  const fallback = createDefaultHike();
  if (!value || typeof value !== "object") return fallback;
  const input = value as Omit<Partial<HikeState>, "version"> & {
    version?: number;
  };
  const biomeIds = BIOMES.map((biome) => biome.id);
  const featureIds = TRAIL_FEATURES.map((feature) => feature.id);
  const biome = isChoice(input.biome, biomeIds) ? input.biome : fallback.biome;
  const distance = clamp(Number(input.distance) || fallback.distance, 3, 18);
  const seed = Number.isInteger(input.seed)
    ? Number(input.seed) >>> 0
    : fallback.seed;
  const targetCount = terrainPointCountForDistance(distance, biome, seed);
  const rawTerrain = Array.isArray(input.terrain)
    ? input.terrain
        .slice(0, 21)
        .map((height) => clamp(Number(height) || 0.1, 0.08, 0.96))
    : [];
  let terrain = generateTerrainProfile(biome, distance, seed);
  if (rawTerrain.length >= 3) {
    if (input.version === 2 && rawTerrain.length === targetCount) {
      terrain = rawTerrain;
    } else {
      const sourceX =
        input.version === 1 && rawTerrain.length === LEGACY_TERRAIN_X.length
          ? [...LEGACY_TERRAIN_X]
          : terrainXPositions(rawTerrain.length, seed, biome);
      const targetX = terrainXPositions(targetCount, seed, biome);
      terrain = targetX.map((x, index) =>
        clamp(
          lerp(
            terrainElevationAt(rawTerrain, x, sourceX),
            terrain[index],
            0.62,
          ),
          0.08,
          0.96,
        ),
      );
    }
  }
  const features = Array.isArray(input.features)
    ? input.features.slice(0, 10).flatMap((feature, index): PlacedFeature[] => {
        if (!feature || typeof feature !== "object") return [];
        const item = feature as Partial<PlacedFeature>;
        if (!isChoice(item.type, featureIds)) return [];
        return [
          {
            id:
              typeof item.id === "string" && item.id
                ? item.id.slice(0, 60)
                : `${item.type}-${index}`,
            type: item.type,
            x: clamp(Number(item.x) || 0.5, 0.07, 0.93),
          },
        ];
      })
    : fallback.features;
  const routeName =
    typeof input.routeName === "string" && input.routeName.trim()
      ? input.routeName.trim().slice(0, 48)
      : biomeById(biome).defaultTitle;

  return {
    version: 2,
    biome,
    season: isChoice(input.season, ["spring", "summer", "autumn", "winter"])
      ? input.season
      : fallback.season,
    weather: isChoice(input.weather, ["clear", "clouds", "mist"])
      ? input.weather
      : fallback.weather,
    light: isChoice(input.light, ["dawn", "day", "golden"])
      ? input.light
      : fallback.light,
    distance,
    terrain,
    features,
    hikerColor: isChoice(input.hikerColor, HIKER_COLORS)
      ? input.hikerColor
      : fallback.hikerColor,
    routeName,
    seed,
  };
}

export function terrainElevationAt(
  terrain: readonly number[],
  x: number,
  positions = terrainXPositions(terrain.length, 0, "cascades"),
): number {
  const safeX = clamp(x, positions[0], positions[positions.length - 1]);
  for (let index = 0; index < positions.length - 1; index += 1) {
    const left = positions[index];
    const right = positions[index + 1];
    if (safeX <= right) {
      const raw = (safeX - left) / (right - left);
      return terrain[index] + (terrain[index + 1] - terrain[index]) * raw;
    }
  }
  return terrain[terrain.length - 1];
}

export function baseTerrainElevationAt(state: HikeState, x: number): number {
  return terrainElevationAt(
    state.terrain,
    x,
    terrainXPositions(state.terrain.length, state.seed, state.biome),
  );
}

function influence(distance: number, radius: number): number {
  if (distance >= radius) return 0;
  const normalized = 1 - distance / radius;
  return normalized * normalized * (3 - 2 * normalized);
}

export function featureAdjustedElevationAt(
  state: HikeState,
  x: number,
): number {
  let elevation = baseTerrainElevationAt(state, x);
  for (const feature of state.features) {
    const offset = x - feature.x;
    const distance = Math.abs(offset);
    if (feature.type === "lake") {
      elevation -= influence(distance, 0.075) * 0.13;
    } else if (feature.type === "lookout") {
      elevation += influence(distance, 0.055) * 0.11;
    } else if (feature.type === "waterfall") {
      const strength = influence(distance, 0.052);
      elevation += strength * (offset < 0 ? 0.045 : -0.085);
    } else if (
      feature.type === "camp" ||
      feature.type === "meadow" ||
      feature.type === "wildflowers"
    ) {
      const radius = feature.type === "camp" ? 0.045 : 0.085;
      const flatten =
        feature.type === "camp" ? 0.9 : feature.type === "meadow" ? 0.6 : 0.38;
      const center = baseTerrainElevationAt(state, feature.x);
      elevation = lerp(
        elevation,
        center,
        influence(distance, radius) * flatten,
      );
    } else if (feature.type === "snowfield") {
      elevation -= influence(distance, 0.07) * 0.018;
    }
  }
  return clamp(elevation, 0.06, 0.99);
}

export function resizeTerrainForDistance(
  state: HikeState,
  distance: number,
): HikeState {
  const nextDistance = clamp(distance, 3, 18);
  const targetCount = terrainPointCountForDistance(
    nextDistance,
    state.biome,
    state.seed,
  );
  if (targetCount === state.terrain.length) {
    return { ...cloneHike(state), distance: nextDistance };
  }

  const generated = generateTerrainProfile(
    state.biome,
    nextDistance,
    state.seed,
  );
  const sourceX = terrainXPositions(
    state.terrain.length,
    state.seed,
    state.biome,
  );
  const targetX = terrainXPositions(targetCount, state.seed, state.biome);
  const terrain = targetX.map((x, index) => {
    const preserved = terrainElevationAt(state.terrain, x, sourceX);
    return clamp(lerp(preserved, generated[index], 0.68), 0.08, 0.96);
  });
  return { ...cloneHike(state), distance: nextDistance, terrain };
}

export function suggestFeaturePosition(
  state: HikeState,
  type: FeatureId,
): number {
  const existing = state.features.map((feature) => feature.x);
  let bestX = 0.5;
  let bestScore = -Infinity;
  for (let index = 0; index <= 60; index += 1) {
    const x = 0.08 + (index / 60) * 0.84;
    const elevation = baseTerrainElevationAt(state, x);
    const before = baseTerrainElevationAt(state, x - 0.018);
    const after = baseTerrainElevationAt(state, x + 0.018);
    const slope = Math.abs(after - before);
    const crown = elevation - (before + after) / 2;
    const spacing = existing.length
      ? Math.min(...existing.map((placedX) => Math.abs(placedX - x)))
      : 0.3;
    let score = Math.min(spacing, 0.2) * 3;
    if (type === "lake") {
      score += (1 - elevation) * 1.5 - slope * 8 - crown * 4;
    } else if (type === "lookout") {
      score += elevation * 1.4 + crown * 8;
    } else if (type === "waterfall") {
      score += slope * 9 + elevation * 0.5;
    } else if (type === "snowfield") {
      score += elevation * 1.5 + slope * 2;
    } else if (type === "camp") {
      score += 1 - slope * 10 + (1 - elevation) * 0.3;
    } else if (type === "forest") {
      score += (1 - elevation) * 0.8 - slope * 2;
    } else {
      score += 1 - slope * 7 + (1 - Math.abs(elevation - 0.48));
    }
    if (score > bestScore) {
      bestScore = score;
      bestX = x;
    }
  }
  return bestX;
}

export function calculateHikeStats(state: HikeState): HikeStats {
  let climbing = 0;
  let totalRelief = 0;
  let previous = featureAdjustedElevationAt(state, 0.04);
  for (let index = 1; index <= 120; index += 1) {
    const current = featureAdjustedElevationAt(
      state,
      0.04 + (index / 120) * 0.92,
    );
    const change = current - previous;
    if (change > 0) climbing += change;
    totalRelief += Math.abs(change);
    previous = current;
  }
  const featureEffort = state.features.reduce(
    (total, feature) =>
      total +
      (feature.type === "snowfield"
        ? 0.5
        : feature.type === "waterfall"
          ? 0.2
          : 0),
    0,
  );
  const elevationFeet =
    Math.round((300 + climbing * 1900 + totalRelief * 180) / 50) * 50;
  const durationHours =
    Math.round(
      (state.distance / 2.25 + elevationFeet / 1900 + featureEffort) * 10,
    ) / 10;
  const score = durationHours + elevationFeet / 2400;
  const effort =
    score < 4.5
      ? "Easygoing"
      : score < 6.5
        ? "Steady"
        : score < 8.5
          ? "Big day"
          : "Epic";
  return {
    distanceMiles: Math.round(state.distance * 10) / 10,
    elevationFeet,
    durationHours,
    effort,
  };
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

export function randomizeHike(current: HikeState, seed: number): HikeState {
  const random = makeRng(seed);
  const distance = Math.round((3 + random() * 15) * 10) / 10;
  const terrain = generateTerrainProfile(current.biome, distance, seed);
  const count = 3 + Math.floor(random() * 3);
  const features: PlacedFeature[] = [];
  for (let index = 0; index < count; index += 1) {
    const feature =
      TRAIL_FEATURES[Math.floor(random() * TRAIL_FEATURES.length)];
    features.push({
      id: `${feature.id}-${seed}-${index}`,
      type: feature.id,
      x: 0.12 + random() * 0.76,
    });
  }
  return {
    ...cloneHike(current),
    version: 2,
    terrain,
    features,
    distance,
    seed: seed >>> 0,
  };
}
