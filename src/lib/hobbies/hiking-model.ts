export const TERRAIN_X = [0.04, 0.27, 0.5, 0.73, 0.96] as const;

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
  terrain: readonly number[];
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
}

export interface PlacedFeature {
  id: string;
  type: FeatureId;
  x: number;
}

export interface HikeState {
  version: 1;
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
    terrain: [0.1, 0.82, 0.4, 0.96, 0.13],
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
    terrain: [0.1, 0.91, 0.36, 0.94, 0.12],
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
    terrain: [0.1, 0.86, 0.28, 0.91, 0.12],
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
    terrain: [0.08, 0.78, 0.38, 0.96, 0.12],
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
  { id: "forest", label: "Forest" },
  { id: "meadow", label: "Meadow" },
  { id: "lake", label: "Alpine lake" },
  { id: "waterfall", label: "Waterfall" },
  { id: "wildflowers", label: "Wildflowers" },
  { id: "snowfield", label: "Snowfield" },
  { id: "camp", label: "Camp" },
  { id: "lookout", label: "Lookout" },
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
  return {
    version: 1,
    biome: biome.id,
    season: "summer",
    weather: "clouds",
    light: "golden",
    distance: 9.2,
    terrain: [...biome.terrain],
    features: DEFAULT_FEATURES.map((feature) => ({ ...feature })),
    hikerColor: HIKER_COLORS[0],
    routeName: biome.defaultTitle,
    seed: 4817,
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
  const input = value as Partial<HikeState>;
  const biomeIds = BIOMES.map((biome) => biome.id);
  const featureIds = TRAIL_FEATURES.map((feature) => feature.id);
  const biome = isChoice(input.biome, biomeIds) ? input.biome : fallback.biome;
  const terrain =
    Array.isArray(input.terrain) && input.terrain.length === TERRAIN_X.length
      ? input.terrain.map((height) => clamp(Number(height) || 0.1, 0.08, 0.96))
      : [...biomeById(biome).terrain];
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
    version: 1,
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
    distance: clamp(Number(input.distance) || fallback.distance, 3, 18),
    terrain,
    features,
    hikerColor: isChoice(input.hikerColor, HIKER_COLORS)
      ? input.hikerColor
      : fallback.hikerColor,
    routeName,
    seed: Number.isInteger(input.seed)
      ? Number(input.seed) >>> 0
      : fallback.seed,
  };
}

export function terrainElevationAt(
  terrain: readonly number[],
  x: number,
): number {
  const safeX = clamp(x, TERRAIN_X[0], TERRAIN_X[TERRAIN_X.length - 1]);
  for (let index = 0; index < TERRAIN_X.length - 1; index += 1) {
    const left = TERRAIN_X[index];
    const right = TERRAIN_X[index + 1];
    if (safeX <= right) {
      const raw = (safeX - left) / (right - left);
      return terrain[index] + (terrain[index + 1] - terrain[index]) * raw;
    }
  }
  return terrain[terrain.length - 1];
}

export function calculateHikeStats(state: HikeState): HikeStats {
  let climbing = 0;
  let totalRelief = 0;
  for (let index = 1; index < state.terrain.length; index += 1) {
    const change = state.terrain[index] - state.terrain[index - 1];
    if (change > 0) climbing += change;
    totalRelief += Math.abs(change);
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
    Math.round((500 + climbing * 3300 + totalRelief * 500) / 50) * 50;
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
  const firstPeak = 0.74 + random() * 0.22;
  const saddle = 0.28 + random() * 0.28;
  const secondPeak = 0.78 + random() * 0.18;
  const terrain = [
    0.08 + random() * 0.12,
    firstPeak,
    saddle,
    secondPeak,
    0.08 + random() * 0.12,
  ];
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
    terrain,
    features,
    distance: Math.round((5 + random() * 10) * 10) / 10,
    seed: seed >>> 0,
  };
}
