/**
 * The layered tarn photo behind the title screen. The plain photo paints
 * first, with the land laid over the name (the name sits in the sky, behind
 * the summit). Then the moving layers take over: the sky moves as one, the
 * name a little less, the land in WebGL by its depth map (plate.ts), and
 * Truman with the ridge he stands on. One spring follows the pointer, the
 * phone's tilt or a finger, like an iPhone wallpaper.
 *
 * Nothing runs while the page shows something else (`setActive(false)`):
 * no layout, no spring, no listeners doing work.
 */
import {
  ampOf,
  boxOf,
  clamp,
  DIR,
  FRAMES,
  FRONT_TO,
  fxOf,
  fyOf,
  layoutFrame,
  NEAR,
  pickSize,
  pt,
  TALL_MQ,
  WIDE,
  armSpans,
  type Geo,
  type Kind,
  type Run,
  type Want,
} from "./frame";
import { loadImg, makePlate, type Plate, type PlateHost } from "./plate";

export interface Spring {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
}

export interface Near {
  kind: Kind;
  img: CanvasImageSource;
  w: number;
  h: number;
}

export interface Scene {
  root: HTMLElement;
  world: HTMLElement;
  photo: HTMLImageElement;
  bird: HTMLCanvasElement;
  geo: Geo;
  st: Spring;
  /** Other parts (the eagle) hold the frame loop open while they move. */
  keepAlive: number;
  near: Near | null;
  ready: Promise<unknown>;
  tilt: { on: boolean; ask: boolean; request(): Promise<boolean> };
  onTilt: (() => void) | null;
  active: boolean;
  onLayout(fn: (g: Geo) => void): void;
  onFrame(fn: (st: Spring, dt: number, now: number) => void): void;
  layout(): void;
  pt(fx: number, fy: number): { x: number; y: number };
  fx(x: number): number;
  fy(y: number): number;
  amp(): number;
  off(n: number): { x: number; y: number };
  aim(x: number, y: number): void;
  kick(): void;
  freeze(on: boolean): void;
  spans(y: number): Run[];
  /** Reads the land's outline ahead of time, off the main thread where it can. */
  prepare(): Promise<void>;
  nearBox(): { x: number; y: number; w: number; h: number };
  setActive(on: boolean): void;
}

export interface SceneParts {
  root: HTMLElement;
  world: HTMLElement;
  photo: HTMLImageElement;
  /** The front layer: the land above the name, laid over it at first. */
  me: HTMLImageElement;
  sky: HTMLImageElement;
  him: HTMLImageElement;
  plane: HTMLElement;
  plate: HTMLCanvasElement;
  bird: HTMLCanvasElement;
}

/** Resolves once the image can paint (decoded, or failed). */
export function decoded(im: HTMLImageElement): Promise<void> {
  if (im.complete && im.naturalWidth) return im.decode().catch(() => undefined);
  return new Promise((resolve) => {
    im.addEventListener(
      "load",
      () => {
        im.decode().then(resolve, resolve);
      },
      { once: true },
    );
    im.addEventListener("error", () => resolve(), { once: true });
  });
}

export function createScene(
  p: SceneParts,
  o: {
    reduced: boolean;
    active: boolean;
    frame: (g: Geo, w0: number, h0: number) => Want;
  },
): Scene {
  const { root, world, photo, me, sky, him, plane } = p;
  // On a window too wide for the photo, its own edges carried on beside it.
  // They follow the photo's rules (hidden until placed, the dusk grade, gone
  // once the moving layers, which have them built in, take over).
  const after =
    photo.parentElement?.tagName === "PICTURE" ? photo.parentElement : photo;
  const sides = (["L", "R"] as const).map((side) => {
    const im = document.createElement("img");
    im.className = "t-photo t-side";
    im.alt = "";
    im.decoding = "async";
    im.setAttribute("aria-hidden", "true");
    im.style.display = "none";
    im.dataset.side = side;
    return im;
  });
  after.after(sides[0], sides[1]);
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const layoutFns: ((g: Geo) => void)[] = [];
  const frameFns: ((st: Spring, dt: number, now: number) => void)[] = [];
  const st: Spring = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
  let gl: Plate | null = null;

  const S: Scene = {
    root,
    world,
    photo,
    bird: p.bird,
    geo: null as unknown as Geo,
    st,
    keepAlive: 0,
    near: null,
    ready: Promise.resolve(),
    tilt: { on: false, ask: false, request: () => Promise.resolve(false) },
    onTilt: null,
    active: o.active,
    onLayout: (fn) => layoutFns.push(fn),
    onFrame: (fn) => frameFns.push(fn),
    layout,
    pt: (fx, fy) => pt(S.geo, fx, fy),
    fx: (x) => fxOf(S.geo, x),
    fy: (y) => fyOf(S.geo, y),
    amp: () => ampOf(innerWidth, innerHeight),
    off,
    aim,
    kick,
    freeze,
    spans,
    prepare: () => prepare(),
    nearBox,
    setActive,
  };

  function px(el: HTMLElement, x: number, y: number, w: number, h: number) {
    el.style.width = `${w.toFixed(1)}px`;
    el.style.height = `${h.toFixed(1)}px`;
    el.style.left = `${x.toFixed(1)}px`;
    el.style.top = `${y.toFixed(1)}px`;
  }

  function layout(): void {
    const vw = innerWidth;
    const vh = innerHeight;
    const g = layoutFrame(
      vw,
      vh,
      matchMedia(TALL_MQ).matches,
      S.amp(),
      o.frame,
    );
    S.geo = g;
    px(photo, g.x, g.y, g.w, g.h);
    px(him, g.x, g.y, g.w, g.h);
    // The front layer is the frame's top part, down to FRONT_TO.
    const b = g.fr.box;
    px(me, g.x, g.y, g.w, (g.h * (FRONT_TO - b[1])) / (b[3] - b[1]));
    // The sky covers the photo and, when wide, its carried-on edges.
    const sb = boxOf(g);
    px(sky, sb.x, g.y, sb.w, g.h);
    placeSides(g);
    // A door pushes the scene in toward the summit.
    world.style.transformOrigin = `${g.apex.x.toFixed(1)}px ${g.apex.y.toFixed(1)}px`;
    root.classList.add("placed");
    for (const fn of layoutFns) fn(g);
    gl?.layout();
    if (S.near && S.near.kind !== g.kind) {
      S.near = null;
      loadNear();
    }
    apply(true);
  }

  function placeSides(g: Geo): void {
    const on = g.kind === "wide";
    root.classList.toggle("wide", on);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const size = pickSize(FRAMES.land.sizes, g.w * dpr);
    const sw = (WIDE.ext + WIDE.feather) * g.w;
    for (const im of sides) {
      if (!on) {
        im.style.display = "none";
        continue;
      }
      const src = `${DIR}side-${im.dataset.side}-${size}.webp`;
      if (im.getAttribute("src") !== src) im.src = src;
      im.style.display = "";
      const left =
        im.dataset.side === "L"
          ? g.x - WIDE.ext * g.w
          : g.x + g.w - WIDE.feather * g.w;
      px(im, left, g.y, sw, g.h);
    }
  }

  /* ---------- The spring ---------- */

  let running = false;
  let last = 0;
  // The layers move only once the WebGL plate is drawn: before that the photo
  // still shows him, and moving his cutout over it would ghost his outline.
  let parallax = false;
  let held = false;
  let pending: [number, number] | null = null;
  const K = 64;
  const C = 12.5; // a little overshoot, so it feels pulled rather than dragged
  let ax0 = Infinity;
  let ay0 = Infinity;

  function kick(): void {
    if (running || !S.active) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(tick);
  }
  function tick(now: number): void {
    if (!S.active) {
      running = false;
      return;
    }
    const dt = Math.min(0.034, (now - last) / 1000);
    last = now;
    st.vx += (K * (st.tx - st.x) - C * st.vx) * dt;
    st.vy += (K * (st.ty - st.y) - C * st.vy) * dt;
    st.x += st.vx * dt;
    st.y += st.vy * dt;
    // At rest (only the eagle moving) the layers are already where they
    // belong, so the full-screen redraw is skipped.
    if (Math.abs(st.x - ax0) > 1e-5 || Math.abs(st.y - ay0) > 1e-5) {
      apply(false);
      ax0 = st.x;
      ay0 = st.y;
    }
    for (const fn of frameFns) fn(st, dt, now);
    const moving =
      Math.abs(st.tx - st.x) + Math.abs(st.ty - st.y) > 0.0006 ||
      Math.abs(st.vx) + Math.abs(st.vy) > 0.002;
    if (moving || S.keepAlive > 0) requestAnimationFrame(tick);
    else running = false;
  }
  /** The offset of a layer at nearness n, in CSS px (against the pointer). */
  function off(n: number): { x: number; y: number } {
    const A = S.amp();
    const m = 1 - n;
    return { x: -st.x * A * m, y: -st.y * A * 0.6 * m };
  }
  function move(el: HTMLElement, at: { x: number; y: number }): void {
    el.style.transform = `translate3d(${at.x.toFixed(2)}px,${at.y.toFixed(2)}px,0)`;
  }
  let lastLight = "";
  function apply(force: boolean): void {
    // The sky moves as one, the name a little less, the land by its depth and
    // he with the ridge under his feet. The front layer never moves: it's only
    // up until the moving layers take over, and nothing moves before then.
    move(sky, off(NEAR.sky));
    move(plane, off(NEAR.name));
    move(him, off(NEAR.him));
    gl?.draw();
    // The glass's light sits toward the pointer.
    const lx = `${(50 + st.x * 38).toFixed(1)}%`;
    const ly = `${(32 + st.y * 34).toFixed(1)}%`;
    if (force || lx + ly !== lastLight) {
      root.style.setProperty("--lx", lx);
      root.style.setProperty("--ly", ly);
      lastLight = lx + ly;
    }
  }
  function aim(x: number, y: number): void {
    if (!parallax || held) {
      pending = [x, y];
      return;
    }
    st.tx = clamp(x, -1, 1);
    st.ty = clamp(y, -1, 1);
    kick();
  }

  /* ---------- Inputs: pointer, tilt, a finger ---------- */

  let source: "none" | "pointer" | "tilt" = "none";
  if (!o.reduced) {
    window.addEventListener(
      "pointermove",
      (e: PointerEvent) => {
        if (!S.active) return;
        if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
        if (source === "tilt") return;
        source = "pointer";
        aim(
          (e.clientX / innerWidth) * 2 - 1,
          (e.clientY / innerHeight) * 2 - 1,
        );
      },
      { passive: true },
    );
    document.documentElement.addEventListener("mouseleave", () => {
      if (source === "pointer") aim(0, 0);
    });
    window.addEventListener("blur", () => {
      if (source === "pointer") aim(0, 0);
    });
  }

  // Tilt. Android sends it without asking; an iPhone needs a tap first.
  type DOE = typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<PermissionState>;
  };
  const Orient = window.DeviceOrientationEvent as DOE | undefined;
  let base: [number, number] | null = null;
  function onOrient(e: DeviceOrientationEvent): void {
    if (e.gamma == null || e.beta == null || !S.active) return;
    const ang =
      screen.orientation?.angle ??
      ((window as unknown as { orientation?: number }).orientation || 0);
    let gx = e.gamma;
    let by = e.beta;
    if (ang === 90) {
      gx = e.beta;
      by = -e.gamma;
    } else if (ang === -90 || ang === 270) {
      gx = -e.beta;
      by = e.gamma;
    }
    if (!base) base = [gx, by];
    // The middle drifts toward how the phone is held, over about 6 s.
    base[0] += (gx - base[0]) * 0.003;
    base[1] += (by - base[1]) * 0.003;
    if (!S.tilt.on) {
      S.tilt.on = true;
      source = "tilt";
      S.onTilt?.();
    }
    aim((gx - base[0]) / 14, (by - base[1]) / 14);
  }
  if (!o.reduced && !fine && Orient) {
    window.addEventListener("deviceorientation", onOrient);
    // Ask only from a tap on the page's own Tilt button, never on load.
    if (typeof Orient.requestPermission === "function") S.tilt.ask = true;
  }
  S.tilt.request = () => {
    if (!Orient || typeof Orient.requestPermission !== "function")
      return Promise.resolve(false);
    return Orient.requestPermission().then(
      (state) => {
        S.tilt.ask = false;
        return state === "granted";
      },
      () => false,
    );
  };

  // A finger dragged on the photo moves it too, and it springs back on release.
  if (!o.reduced && !fine) {
    let drag: {
      x: number;
      y: number;
      sx: number;
      sy: number;
      id: number;
    } | null = null;
    root.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest("a,button,[role=button]")) return;
      drag = {
        x: e.clientX,
        y: e.clientY,
        sx: st.tx,
        sy: st.ty,
        id: e.pointerId,
      };
    });
    root.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      aim(
        drag.sx - (e.clientX - drag.x) / 110,
        drag.sy - (e.clientY - drag.y) / 110,
      );
    });
    for (const type of ["pointerup", "pointercancel"] as const) {
      root.addEventListener(type, () => {
        if (!drag) return;
        drag = null;
        if (!S.tilt.on) aim(0, 0);
      });
    }
  }

  /* ---------- The WebGL plate ---------- */

  // Made after the entrance (creating a context and the first upload can
  // take a frame or two), so the photo paints and the name rises on a free
  // main thread.
  let glWanted = false;
  function startGL(): void {
    glWanted = true;
    if (gl || o.reduced || !S.active) return;
    gl = makePlate(
      host,
      p.plate,
      root,
      () => {
        parallax = true;
        if (pending) {
          const [x, y] = pending;
          pending = null;
          aim(x, y);
        }
        kick();
      },
      () => S.ready,
    );
    gl?.layout();
  }

  /* Hold the scene still (a door opening) and let it go. */
  function freeze(on: boolean): void {
    held = on;
    if (held) st.tx = st.ty = 0;
    else if (pending) {
      const [x, y] = pending;
      pending = null;
      aim(x, y);
    }
    kick();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) st.tx = st.ty = 0;
  });

  /* The sky and him for the moving layers, at the land's size (the plate
     waits for both, so the swap from the photo never shows a frame without
     them). */
  const loadMoving = (kind: Kind, size: number): Promise<unknown> => {
    const sk = `${DIR}sky-${kind}-${size}.webp`;
    const hm = `${DIR}him-${kind === "wide" ? "land" : kind}-${size}.webp`;
    if (sky.getAttribute("src") !== sk) sky.src = sk;
    if (him.getAttribute("src") !== hm) him.src = hm;
    return Promise.all([decoded(sky), decoded(him)]);
  };
  const host: PlateHost = {
    get geo() {
      return S.geo;
    },
    off,
    loadMoving,
  };

  /* The land nearer than the far peaks (the trees on either side), as alpha:
     the eagle cuts itself with it, so it flies in front of the mountains and
     behind the trees. Decoded off the main thread before the eagle needs it:
     drawn straight from an <img>, the mask decoded during the first cut and
     dropped a frame. */
  function loadNear(): void {
    if (!S.active) return;
    const want = S.geo.kind;
    if (S.near?.kind === want) return;
    loadImg(`${DIR}near-${want}.png`)
      .then(async (im) => {
        const w = im.naturalWidth;
        const h = im.naturalHeight;
        const img: CanvasImageSource =
          "createImageBitmap" in window
            ? await createImageBitmap(im).catch(() => im)
            : im;
        if (S.geo.kind === want) S.near = { kind: want, img, w, h };
      })
      .catch(() => undefined);
  }
  function nearBox(): { x: number; y: number; w: number; h: number } {
    const g = S.geo;
    const b = boxOf(g);
    const at = off(NEAR.near);
    return { x: b.x + at.x, y: g.y + at.y, w: b.w, h: g.h };
  }

  /* The land's exact outline, read from the front layer's alpha once it
     decodes (960 px across), as runs on a screen row at rest; the table in
     tarn.json before then. */
  let sil: { W: number; H: number; a: Uint8Array; src: string } | null = null;
  function buildSil(from: CanvasImageSource = me): void {
    if (!me.naturalWidth) return;
    const W = 960;
    const H = Math.round((W * me.naturalHeight) / me.naturalWidth);
    try {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const x = c.getContext("2d", { willReadFrequently: true })!;
      x.drawImage(from, 0, 0, W, H);
      const d = x.getImageData(0, 0, W, H).data;
      const a = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) a[i] = d[i * 4 + 3];
      sil = { W, H, a, src: me.currentSrc };
    } catch {
      sil = null;
    }
  }
  /* The outline ahead of time, from a copy shrunk off the main thread, so
     fitting the name doesn't resample the full-size layer on it. */
  async function prepare(): Promise<void> {
    if ((sil && sil.src === me.currentSrc) || !me.naturalWidth) return;
    const W = 960;
    const H = Math.round((W * me.naturalHeight) / me.naturalWidth);
    try {
      const small = await createImageBitmap(me, {
        resizeWidth: W,
        resizeHeight: H,
        resizeQuality: "medium",
      });
      buildSil(small);
      small.close();
    } catch {
      // spans() reads it when it's first needed.
    }
  }
  function spans(y: number): Run[] {
    const g = S.geo;
    if (!sil || sil.src !== me.currentSrc) buildSil();
    if (!sil) {
      const fy = fyOf(g, y);
      return armSpans(fy).map(
        (r) => [pt(g, r[0], fy).x, pt(g, r[1], fy).x] as Run,
      );
    }
    const b = g.fr.box;
    const v = (y - g.y) / ((g.h * (FRONT_TO - b[1])) / (b[3] - b[1]));
    if (v < 0 || v >= 1) return [];
    const row = Math.floor(v * sil.H) * sil.W;
    const out: Run[] = [];
    let start = -1;
    for (let i = 0; i <= sil.W; i++) {
      const on = i < sil.W && sil.a[row + i] > 150;
      if (on && start < 0) start = i;
      else if (!on && start >= 0) {
        out.push([g.x + (start / sil.W) * g.w, g.x + (i / sil.W) * g.w]);
        start = -1;
      }
    }
    return out;
  }

  /* Ready once the photo and the front layer can paint, so the name never
     shows before the summit is over it. On a window too wide for the photo,
     its carried-on edges come in with it. */
  layout();
  const painted = decoded(photo).then(() =>
    Promise.all(
      sides
        .filter((im) => im.style.display !== "none" && im.getAttribute("src"))
        .map(decoded),
    ),
  );
  void painted.then(() => root.classList.add("painted"));
  S.ready = Promise.all([painted, decoded(me)]);
  void S.ready.then(() => {
    loadNear();
    if (o.reduced) return;
    window.setTimeout(() => {
      if ("requestIdleCallback" in window)
        requestIdleCallback(startGL, { timeout: 400 });
      else startGL();
    }, 900);
  });

  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (S.active) layout();
    });
  });

  function setActive(on: boolean): void {
    if (S.active === on) return;
    S.active = on;
    if (!on) {
      st.tx = st.ty = st.x = st.y = st.vx = st.vy = 0;
      return;
    }
    layout();
    void S.ready.then(loadNear);
    if (glWanted && !gl) startGL();
    kick();
  }

  return S;
}
