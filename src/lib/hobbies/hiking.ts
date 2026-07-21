import {
  BIOMES,
  TERRAIN_X,
  calculateHikeStats,
  cloneHike,
  createDefaultHike,
  normalizeHikeState,
  randomizeHike,
  trailFeatureById,
  type BiomeId,
  type FeatureId,
  type HikeState,
  type LightId,
  type SeasonId,
  type WeatherId,
} from "./hiking-model";
import {
  renderHikePostcard,
  renderHikeScene,
  terrainElevationFromCanvasY,
  terrainAnchorPoint,
} from "./hiking-renderer";

const STORAGE_KEY = "trail-studio-v1";
const MAX_HISTORY = 32;

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing hike builder element: ${selector}`);
  return element;
}

function loadState(): HikeState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeHikeState(JSON.parse(saved)) : createDefaultHike();
  } catch {
    return createDefaultHike();
  }
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "my-imagined-trail";
}

function statesMatch(first: HikeState, second: HikeState): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

export function initHikeBuilder(root: HTMLElement): void {
  const canvas = required<HTMLCanvasElement>(root, "[data-hike-canvas]");
  const regionLabel = required<HTMLElement>(root, "[data-hike-region-label]");
  const stageStat = required<HTMLElement>(root, "[data-hike-stage-stat]");
  const saveState = required<HTMLElement>(root, "[data-hike-save-state]");
  const itinerary = required<HTMLElement>(root, "[data-hike-itinerary]");
  const featureCount = required<HTMLElement>(root, "[data-hike-feature-count]");
  const nameInput = required<HTMLInputElement>(root, "[data-hike-name]");
  const distanceInput = required<HTMLInputElement>(
    root,
    "[data-hike-distance]",
  );
  const distanceLabel = required<HTMLElement>(
    root,
    "[data-hike-distance-label]",
  );
  const distanceStat = required<HTMLElement>(root, "[data-hike-distance-stat]");
  const gainStat = required<HTMLElement>(root, "[data-hike-gain-stat]");
  const effortStat = required<HTMLElement>(root, "[data-hike-effort-stat]");
  const seasonSelect = required<HTMLSelectElement>(root, "[data-hike-season]");
  const weatherSelect = required<HTMLSelectElement>(
    root,
    "[data-hike-weather]",
  );
  const undoButton = required<HTMLButtonElement>(root, "[data-hike-undo]");
  const shuffleButton = required<HTMLButtonElement>(
    root,
    "[data-hike-shuffle]",
  );
  const resetButton = required<HTMLButtonElement>(root, "[data-hike-reset]");
  const walkButton = required<HTMLButtonElement>(root, "[data-hike-walk]");
  const walkLabel = required<HTMLElement>(walkButton, "span");
  const developButton = required<HTMLButtonElement>(
    root,
    "[data-hike-develop]",
  );
  const dialog = required<HTMLDialogElement>(root, "[data-hike-dialog]");
  const dialogTitle = required<HTMLElement>(root, "[data-hike-dialog-title]");
  const closeButton = required<HTMLButtonElement>(root, "[data-hike-close]");
  const postcard = required<HTMLCanvasElement>(root, "[data-hike-postcard]");
  const shareButton = required<HTMLButtonElement>(root, "[data-hike-share]");
  const downloadButton = required<HTMLButtonElement>(
    root,
    "[data-hike-download]",
  );
  const exportStatus = required<HTMLElement>(root, "[data-hike-export-status]");

  const context = canvas.getContext("2d");
  if (!context) return;
  const ctx: CanvasRenderingContext2D = context;

  const biomeButtons =
    root.querySelectorAll<HTMLButtonElement>("[data-hike-biome]");
  const featureButtons = root.querySelectorAll<HTMLButtonElement>(
    "[data-hike-feature]",
  );
  const terrainInputs = root.querySelectorAll<HTMLInputElement>(
    "[data-hike-terrain]",
  );
  const lightButtons =
    root.querySelectorAll<HTMLButtonElement>("[data-hike-light]");
  const colorButtons =
    root.querySelectorAll<HTMLButtonElement>("[data-hike-color]");
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  let state = loadState();
  let activeFeature: FeatureId | null = null;
  let activeAnchor: number | null = null;
  let hoveredAnchor: number | null = null;
  let dragSnapshot: HikeState | null = null;
  let continuousSnapshot: HikeState | null = null;
  let hikerProgress: number | null = null;
  let walkingSince: number | null = null;
  let cssWidth = 0;
  let cssHeight = 0;
  let dpr = 1;
  let saveTimer = 0;
  let raf = 0;
  let lastFrame = 0;
  let onscreen = true;
  const undoStack: HikeState[] = [];

  function remember(snapshot: HikeState): void {
    if (statesMatch(snapshot, state)) return;
    undoStack.push(snapshot);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    undoButton.disabled = undoStack.length === 0;
  }

  function scheduleSave(): void {
    saveState.textContent = "Saving locally...";
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        saveState.textContent = "Saved on this device";
      } catch {
        saveState.textContent = "Local save unavailable";
      }
    }, 180);
  }

  function resetWalk(): void {
    walkingSince = null;
    hikerProgress = null;
    walkButton.disabled = false;
    walkLabel.textContent = "Walk the trail";
  }

  function render(now = performance.now()): void {
    if (!cssWidth || !cssHeight) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    renderHikeScene(ctx, state, {
      width: cssWidth,
      height: cssHeight,
      mode: "builder",
      now,
      hikerProgress,
      activeAnchor,
      hoveredAnchor,
    });
  }

  function syncComputed(): void {
    const biome = BIOMES.find((item) => item.id === state.biome) ?? BIOMES[0];
    const stats = calculateHikeStats(state);
    regionLabel.textContent = biome.label;
    stageStat.textContent = `${stats.distanceMiles.toFixed(1)} mi · ${stats.elevationFeet.toLocaleString("en-US")} ft`;
    distanceLabel.textContent = `${stats.distanceMiles.toFixed(1)} mi`;
    distanceStat.textContent = stats.distanceMiles.toFixed(1);
    gainStat.textContent = stats.elevationFeet.toLocaleString("en-US");
    effortStat.textContent = stats.effort;
    dialogTitle.textContent = state.routeName;
    canvas.setAttribute(
      "aria-label",
      `${state.routeName}, an editable ${biome.label} landscape with ${state.features.length} trail moments`,
    );
  }

  function syncItinerary(): void {
    itinerary.replaceChildren();
    const sorted = [...state.features].sort(
      (first, second) => first.x - second.x,
    );
    for (const feature of sorted) {
      const details = trailFeatureById(feature.type);
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:border-red-300 hover:text-red-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-red-700 dark:hover:text-red-300";
      button.setAttribute("aria-label", `Remove ${details.label}`);
      const label = document.createElement("span");
      label.textContent = details.label;
      const remove = document.createElement("span");
      remove.setAttribute("aria-hidden", "true");
      remove.textContent = "×";
      button.append(label, remove);
      button.addEventListener("click", () => {
        const next = cloneHike(state);
        next.features = next.features.filter((item) => item.id !== feature.id);
        applyState(next);
      });
      itinerary.append(button);
    }
    if (sorted.length === 0) {
      const empty = document.createElement("span");
      empty.className = "py-1 text-xs text-neutral-500";
      empty.textContent = "An open trail";
      itinerary.append(empty);
    }
    featureCount.textContent = `${state.features.length} / 10 moments`;
  }

  function syncUI(): void {
    biomeButtons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.hikeBiome === state.biome),
      );
    });
    featureButtons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.hikeFeature === activeFeature),
      );
    });
    lightButtons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.hikeLight === state.light),
      );
    });
    colorButtons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.hikeColor === state.hikerColor),
      );
    });
    terrainInputs.forEach((input) => {
      const index = Number(input.dataset.hikeTerrain);
      input.value = String(Math.round(state.terrain[index] * 100));
    });
    if (document.activeElement !== nameInput) nameInput.value = state.routeName;
    distanceInput.value = String(state.distance);
    seasonSelect.value = state.season;
    weatherSelect.value = state.weather;
    canvas.dataset.placement = activeFeature ? "true" : "false";
    undoButton.disabled = undoStack.length === 0;
    syncComputed();
    syncItinerary();
  }

  function applyState(next: HikeState, snapshot = cloneHike(state)): void {
    state = normalizeHikeState(next);
    remember(snapshot);
    resetWalk();
    syncUI();
    scheduleSave();
    render();
  }

  function beginContinuous(): void {
    if (!continuousSnapshot) continuousSnapshot = cloneHike(state);
  }

  function finishContinuous(): void {
    if (continuousSnapshot) remember(continuousSnapshot);
    continuousSnapshot = null;
    syncUI();
  }

  function fit(): void {
    const width =
      canvas.clientWidth || canvas.parentElement?.clientWidth || 720;
    const height =
      canvas.clientHeight ||
      Math.max(288, Math.min(608, Math.round(width * 0.58)));
    cssWidth = width;
    cssHeight = height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    render();
  }

  function nearestAnchor(x: number, y: number): number | null {
    let nearest: number | null = null;
    let distance = 30;
    for (let index = 0; index < TERRAIN_X.length; index += 1) {
      const point = terrainAnchorPoint(state, index, cssWidth, cssHeight);
      const candidate = Math.hypot(point.x - x, point.y - y);
      if (candidate < distance) {
        distance = candidate;
        nearest = index;
      }
    }
    return nearest;
  }

  function pointerPosition(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function updateDraggedAnchor(y: number): void {
    if (activeAnchor == null) return;
    const elevation = terrainElevationFromCanvasY(y, cssHeight);
    state.terrain[activeAnchor] = elevation;
    state = normalizeHikeState(state);
    resetWalk();
    syncUI();
    scheduleSave();
    render();
  }

  function placeFeature(x: number): void {
    if (!activeFeature) return;
    if (state.features.length >= 10) {
      saveState.textContent = "Trail has ten moments already";
      return;
    }
    const normalizedX = Math.min(0.93, Math.max(0.07, x / cssWidth));
    const next = cloneHike(state);
    next.features.push({
      id: `${activeFeature}-${state.seed.toString(36)}-${Date.now().toString(36)}`,
      type: activeFeature,
      x: normalizedX,
    });
    applyState(next);
  }

  biomeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.hikeBiome as BiomeId;
      const oldBiome =
        BIOMES.find((item) => item.id === state.biome) ?? BIOMES[0];
      const newBiome = BIOMES.find((item) => item.id === id) ?? BIOMES[0];
      const next = cloneHike(state);
      next.biome = id;
      next.terrain = next.terrain.map(
        (height, index) => height * 0.62 + newBiome.terrain[index] * 0.38,
      );
      if (next.routeName === oldBiome.defaultTitle)
        next.routeName = newBiome.defaultTitle;
      applyState(next);
    });
  });

  featureButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const selected = button.dataset.hikeFeature as FeatureId;
      activeFeature = activeFeature === selected ? null : selected;
      syncUI();
      render();
    });
  });

  lightButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const next = cloneHike(state);
      next.light = button.dataset.hikeLight as LightId;
      applyState(next);
    });
  });

  colorButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const next = cloneHike(state);
      next.hikerColor = button.dataset.hikeColor ?? next.hikerColor;
      applyState(next);
    });
  });

  seasonSelect.addEventListener("change", () => {
    const next = cloneHike(state);
    next.season = seasonSelect.value as SeasonId;
    applyState(next);
  });

  weatherSelect.addEventListener("change", () => {
    const next = cloneHike(state);
    next.weather = weatherSelect.value as WeatherId;
    applyState(next);
  });

  for (const input of [distanceInput, ...terrainInputs]) {
    input.addEventListener("pointerdown", beginContinuous);
    input.addEventListener("focus", beginContinuous);
    input.addEventListener("blur", () => {
      if (continuousSnapshot) finishContinuous();
    });
  }

  distanceInput.addEventListener("input", () => {
    state.distance = Number(distanceInput.value);
    state = normalizeHikeState(state);
    resetWalk();
    syncComputed();
    scheduleSave();
    render();
  });
  distanceInput.addEventListener("change", finishContinuous);

  terrainInputs.forEach((input) => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.hikeTerrain);
      state.terrain[index] = Number(input.value) / 100;
      state = normalizeHikeState(state);
      resetWalk();
      syncComputed();
      scheduleSave();
      render();
    });
    input.addEventListener("change", finishContinuous);
  });

  nameInput.addEventListener("focus", beginContinuous);
  nameInput.addEventListener("input", () => {
    state.routeName = nameInput.value.slice(0, 48) || "My Imagined Trail";
    dialogTitle.textContent = state.routeName;
    scheduleSave();
  });
  nameInput.addEventListener("change", () => {
    state = normalizeHikeState(state);
    finishContinuous();
  });
  nameInput.addEventListener("blur", () => {
    if (continuousSnapshot) finishContinuous();
  });

  canvas.addEventListener("pointerdown", (event) => {
    const point = pointerPosition(event);
    const anchor = nearestAnchor(point.x, point.y);
    if (anchor != null) {
      activeAnchor = anchor;
      dragSnapshot = cloneHike(state);
      canvas.dataset.dragging = "true";
      canvas.setPointerCapture(event.pointerId);
      updateDraggedAnchor(point.y);
      return;
    }
    placeFeature(point.x);
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = pointerPosition(event);
    if (activeAnchor != null) {
      updateDraggedAnchor(point.y);
      return;
    }
    const nextHover = nearestAnchor(point.x, point.y);
    if (nextHover !== hoveredAnchor) {
      hoveredAnchor = nextHover;
      render();
    }
  });

  function finishDrag(event?: PointerEvent): void {
    if (activeAnchor == null) return;
    if (event && canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    activeAnchor = null;
    delete canvas.dataset.dragging;
    if (dragSnapshot) remember(dragSnapshot);
    dragSnapshot = null;
    syncUI();
    render();
  }

  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);
  canvas.addEventListener("pointerleave", () => {
    if (activeAnchor == null && hoveredAnchor != null) {
      hoveredAnchor = null;
      render();
    }
  });

  canvas.addEventListener("focus", () => {
    if (hoveredAnchor == null) hoveredAnchor = 2;
    render();
  });
  canvas.addEventListener("blur", () => {
    if (activeAnchor == null) hoveredAnchor = null;
    render();
  });
  canvas.addEventListener("keydown", (event) => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    const current = hoveredAnchor ?? 2;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      hoveredAnchor = Math.min(
        TERRAIN_X.length - 1,
        Math.max(0, current + (event.key === "ArrowLeft" ? -1 : 1)),
      );
      render();
      return;
    }
    const next = cloneHike(state);
    next.terrain[current] = Math.min(
      0.96,
      Math.max(
        0.08,
        next.terrain[current] + (event.key === "ArrowUp" ? 0.03 : -0.03),
      ),
    );
    applyState(next);
    hoveredAnchor = current;
  });

  undoButton.addEventListener("click", () => {
    const previous = undoStack.pop();
    if (!previous) return;
    state = normalizeHikeState(previous);
    resetWalk();
    syncUI();
    scheduleSave();
    render();
  });

  shuffleButton.addEventListener("click", () => {
    const nextSeed = (Math.imul(state.seed + 1, 1664525) + 1013904223) >>> 0;
    applyState(randomizeHike(state, nextSeed));
  });

  resetButton.addEventListener("click", () => {
    activeFeature = null;
    applyState(createDefaultHike());
  });

  walkButton.addEventListener("click", () => {
    if (reduceMotion) {
      hikerProgress = 1;
      walkLabel.textContent = "At the finish";
      render();
      return;
    }
    walkingSince = performance.now();
    hikerProgress = 0;
    walkButton.disabled = true;
    walkLabel.textContent = "Walking...";
  });

  function createPostcard(): void {
    exportStatus.textContent = "Developing at 1800 × 1200...";
    dialogTitle.textContent = state.routeName;
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => {
      renderHikePostcard(postcard, state);
      exportStatus.textContent = "Rendered on your device at 1800 × 1200.";
    });
  }

  developButton.addEventListener("click", createPostcard);
  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  function postcardBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      postcard.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The postcard could not be encoded."));
      }, "image/png");
    });
  }

  downloadButton.addEventListener("click", async () => {
    try {
      exportStatus.textContent = "Preparing download...";
      const blob = await postcardBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slugify(state.routeName)}-postcard.png`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      exportStatus.textContent = "Postcard downloaded.";
    } catch {
      exportStatus.textContent = "The postcard could not be downloaded.";
    }
  });

  let supportsFileShare = false;
  try {
    const testFile = new File(["trail"], "trail.txt", { type: "text/plain" });
    supportsFileShare =
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [testFile] });
  } catch {
    supportsFileShare = false;
  }
  shareButton.hidden = !supportsFileShare;

  shareButton.addEventListener("click", async () => {
    try {
      exportStatus.textContent = "Preparing to share...";
      const blob = await postcardBlob();
      const file = new File(
        [blob],
        `${slugify(state.routeName)}-postcard.png`,
        { type: "image/png" },
      );
      await navigator.share({
        title: state.routeName,
        text: "An imagined hike from the Trail Studio",
        files: [file],
      });
      exportStatus.textContent = "Postcard shared.";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        exportStatus.textContent = "Share canceled.";
      } else {
        exportStatus.textContent =
          "Sharing is unavailable. Download the PNG instead.";
      }
    }
  });

  function frame(now: number): void {
    if (onscreen && !document.hidden && now - lastFrame >= 40) {
      if (walkingSince != null) {
        const progress = Math.min(1, (now - walkingSince) / 6200);
        hikerProgress = progress * progress * (3 - 2 * progress);
        if (progress >= 1) {
          walkingSince = null;
          walkButton.disabled = false;
          walkLabel.textContent = "Walk again";
        }
      }
      render(now);
      lastFrame = now;
    }
    raf = requestAnimationFrame(frame);
  }

  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(canvas.parentElement ?? canvas);
  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      onscreen = entries.some((entry) => entry.isIntersecting);
    },
    { threshold: 0.03 },
  );
  intersectionObserver.observe(canvas);

  syncUI();
  fit();
  if (!reduceMotion) raf = requestAnimationFrame(frame);
  else render(0);

  window.addEventListener(
    "pagehide",
    () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
    },
    { once: true },
  );
}
