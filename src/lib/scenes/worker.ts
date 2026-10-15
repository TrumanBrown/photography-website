/// <reference lib="webworker" />
import { cardUnits, type DotField, findDots, plateUrl } from "../plate-dots";
import { pack, unpack } from "./carry";
import {
  clock,
  HOLD_ZOOM,
  HURRY,
  type Look,
  PUSH_MS,
  pushZoom,
  type Scene,
  type Stage,
  stageScene,
} from "./engine";
import { makeRenderer, type Renderer } from "./gl";
import type { LabelArt, Labeler } from "./label";
import { canvasSink, type Colors, type Sink } from "./pen";
import type {
  FromWorker,
  PlayRequest,
  ResumeRequest,
  ToWorker,
  View,
  WarmRequest,
} from "./protocol";
import { split } from "./stage";
import { ready, SCENES } from "./table";

/**
 * The scene worker: reads the plates, draws the props and plays the scenes
 * on a canvas the page handed over, so nothing the page itself is doing
 * (loading, its own scripts) can make a scene stutter, and none of this
 * holds the page up. The page side is player.ts.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: FromWorker, transfer: Transferable[] = []) =>
  scope.postMessage(message, transfer);

const frame: (cb: (now: number) => void) => number =
  typeof scope.requestAnimationFrame === "function"
    ? (cb) => scope.requestAnimationFrame(cb)
    : (cb) => scope.setTimeout(() => cb(performance.now()), 16);
const cancelFrame = (id: number) =>
  typeof scope.cancelAnimationFrame === "function"
    ? scope.cancelAnimationFrame(id)
    : scope.clearTimeout(id);

let canvas: OffscreenCanvas | null = null;
let gl: Renderer<OffscreenCanvas> | null = null;
let view: View = { w: 1, h: 1, dpr: 1 };

/* ---------------------------------------------------------------- turns */

/**
 * Work for cards that are only being got ready, one piece at a time, each
 * in a task of its own: a click's message always gets in between any two,
 * and none of it runs while a clicked card's scene sets up or plays (it
 * would cost the scene frames).
 */
const queue: Array<() => void> = [];
let held = false;
let pending = false;
function schedule() {
  if (pending || held || !queue.length) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    if (held) return;
    queue.shift()?.();
    schedule();
  }, 0);
}
const later = (job: () => void) => {
  queue.push(job);
  schedule();
};
function hold(on: boolean) {
  held = on;
  schedule();
}

/* --------------------------------------------------------------- plates */

const plates = new Map<string, Promise<DotField | null>>();
/** Plates a click wants: read the moment they're in, not in their turn. */
const wanted = new Set<string>();
const waiting = new Map<string, () => void>();

/** Until it's this plate's turn to be read: at once, if a click wants it. */
function turnFor(url: string): Promise<void> {
  if (wanted.has(url)) return Promise.resolve();
  return new Promise((resolve) => {
    const go = () => {
      if (waiting.get(url) !== go) return;
      waiting.delete(url);
      resolve();
    };
    waiting.set(url, go);
    later(go);
  });
}

function readPlate(bitmap: ImageBitmap): DotField | null {
  const { width, height } = bitmap;
  const ctx = new OffscreenCanvas(width, height).getContext("2d", {
    willReadFrequently: true,
  });
  if (!ctx) throw new Error("No 2D canvas.");
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  return cardUnits(findDots(data, width, height), width);
}

/**
 * A plate's dots, in card units, read once each. Fetching and decoding it
 * go on in the background; reading its dots waits its turn behind a click,
 * unless it's `now` for the card that was clicked.
 */
function plate(url: string, now = false): Promise<DotField | null> {
  let known = plates.get(url);
  if (!known) {
    known = (async () => {
      const response = await fetch(plateUrl(url), { mode: "cors" });
      if (!response.ok) throw new Error(`${response.status} for ${url}`);
      const bitmap = await createImageBitmap(await response.blob());
      try {
        await turnFor(url);
        return readPlate(bitmap);
      } finally {
        bitmap.close();
      }
    })().catch(() => {
      plates.delete(url);
      return null;
    });
    plates.set(url, known);
  }
  if (now) {
    wanted.add(url);
    waiting.get(url)?.();
  }
  return known;
}

const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);

/* --------------------------------------------------------------- labels */

/** Labels come from the page, drawn in its fonts; until one has, it's left out. */
const labelArt = new Map<string, LabelArt | null | "asked">();
const labels: Labeler = (text, color, dpr) => {
  const key = `${text}|${color}|${dpr}`;
  const known = labelArt.get(key);
  if (known === undefined) {
    labelArt.set(key, "asked");
    post({ type: "label", key, text, color, dpr });
    return null;
  }
  return known === "asked" ? null : known;
};

/* ---------------------------------------------------------------- drawing */

function sinkFor(colors: Colors): Sink | null {
  if (!canvas) return null;
  if (gl) return gl.ready ? gl.sink(colors, labels) : null;
  try {
    return canvasSink(canvas, colors, labels);
  } catch {
    return null;
  }
}

/** Blank the canvas between scenes, so the next one never opens on the last. */
function blank() {
  const sink = sinkFor({ ink: "#000", red: "#000", paper: "#fff" });
  sink?.frame(view.w, view.h, view.dpr, 1, 0);
  sink?.flush();
}

let lastLook = "";
function sendLook(look: Look) {
  const key = `${look.opacity.toFixed(3)}|${look.blur.toFixed(2)}`;
  if (key === lastLook) return;
  lastLook = key;
  post({ type: "look", ...look });
}

interface Running {
  stop(): void;
  hurry(): void;
  uncover(): void;
}
let current: Running | null = null;
let generation = 0;

function stopCurrent() {
  current?.stop();
  current = null;
  lastLook = "";
}

/* ------------------------------------------------------------------ play */

/** Ready a card's plate and props ahead of a click on it, in their turn. */
async function warm(m: WarmRequest) {
  const scene = SCENES[m.slug];
  if (m.mini) void plate(m.mini);
  const dots = await plate(m.card);
  if (!scene || !dots) return;
  later(() => ready(scene, dots, m.dark));
  const { rehearse: likely } = m;
  if (likely)
    later(() => rehearse(scene, dots, m.dark, likely.rect, likely.view));
}

const rehearsed = new Set<Scene>();

/**
 * Set a scene up once where nobody sees it, draw a few moments of it on the
 * canvas while that's off the page, and clear it again. The browser readies
 * its code the first time it runs, which is slow: this way that happens
 * before a click on the card, not while it waits.
 */
function rehearse(
  scene: Scene,
  dots: DotField,
  dark: boolean,
  rect: [number, number, number, number],
  seen: View,
) {
  if (rehearsed.has(scene)) return;
  rehearsed.add(scene);
  const colors = {
    ink: dots.color || "#16150f",
    red: "#b3301c",
    paper: "#fbfaf8",
  };
  const sink = sinkFor(colors);
  if (!sink) return;
  view = seen;
  try {
    const staged = ready(scene, dots, dark);
    const stage = stageScene({
      scene,
      prep: staged.prep,
      main: staged,
      rect,
      w: seen.w,
      h: seen.h,
      colors,
      font: "",
      dark,
      seed: 1,
      sink,
      size: () => seen,
      zoom: () => 1,
    });
    const end = stage.run.duration;
    for (const t of [0, stage.leave, (stage.depart + end) / 2, end - 1])
      stage.draw(t);
  } catch {
    // A click on it plays it all the same.
  }
  blank();
}

async function play(m: PlayRequest, mine: number) {
  if (mine !== generation) return;
  stopCurrent();
  // Nothing for other cards until this one's scene is up, or called off.
  hold(true);
  const fail = () => {
    hold(false);
    post({ type: "failed" });
  };
  const scene = SCENES[m.slug];
  // Whatever time the click has left: a plate that's in already wins even
  // when there's none.
  const due = Math.max(0, m.until - Date.now());
  const [card, mini] = await Promise.all([
    within(plate(m.card, true), due),
    m.mini ? within(plate(m.mini, true), due) : null,
  ]);
  if (mine !== generation) return;
  const main = card ?? mini;
  if (!scene || !main || main.n < 40) return fail();
  // It has its plate: the page lets it finish setting up.
  post({ type: "setting" });
  const ink = main.color;
  const colors = { ink, red: m.red, paper: m.paper };
  const sink = sinkFor(colors);
  if (!sink) return fail();
  let stage: Stage;
  let staged: ReturnType<typeof ready>;
  // The camera's push in starts when the page changes.
  let leftAt = 0;
  try {
    staged = ready(scene, main, m.dark);
    const from = card && mini ? ready(scene, mini, m.dark, false) : undefined;
    stage = stageScene({
      scene,
      prep: staged.prep,
      main: staged,
      from,
      rect: m.rect,
      w: m.w,
      h: m.h,
      colors,
      font: "",
      dark: m.dark,
      seed: m.seed,
      sink,
      size: () => view,
      zoom: () => (leftAt ? pushZoom(Date.now() - leftAt) : 1),
    });
  } catch {
    return fail();
  }
  const handsOver = stage.leave < stage.run.duration;
  const drawnFrom = card ? m.card : (m.mini ?? m.card);

  let time: ReturnType<typeof clock> | null = null;
  let stopped = false;
  let left = false;
  let id = 0;
  const tick = () => {
    if (stopped) return;
    if (sink.lost) {
      stopped = true;
      return fail();
    }
    // The scene's clock starts on its first frame, so it never jumps ahead.
    const first = !time;
    time ??= clock();
    try {
      if (!left) {
        const t = Math.min(stage.leave, time.now());
        sendLook(stage.draw(t));
        if (first) post({ type: "started" });
        if (t >= stage.leave) {
          left = true;
          if (!handsOver) {
            stopped = true;
            const { dots, w, h, reveal } = stage.final();
            return post({ type: "final", dots, w, h, reveal, ink });
          }
          const at = Date.now();
          const frame = stage.held(stage.leave);
          leftAt = at;
          post({
            type: "leave",
            at,
            t: stage.leave,
            frame,
            w: m.w,
            h: m.h,
            rect: m.rect,
            speed: time.rate,
            hold: PUSH_MS,
            zoom: HOLD_ZOOM,
            ink,
            plate: drawnFrom,
            carry: JSON.stringify({
              path: m.path,
              at,
              dots: pack(main),
              prep: pack(staged.prep),
            }),
          });
        }
      } else {
        // Easing into the hold until the page goes.
        sendLook(stage.draw(Math.min(stage.depart, time.now())));
      }
    } catch {
      stopped = true;
      return fail();
    }
    id = frame(tick);
  };
  id = frame(tick);
  current = {
    stop() {
      stopped = true;
      cancelFrame(id);
      blank();
    },
    hurry: () => time?.hurry(),
    uncover() {},
  };
}

/* ---------------------------------------------------------------- resume */

function resume(m: ResumeRequest, mine: number) {
  if (mine !== generation) return;
  stopCurrent();
  const s = m.note.scene;
  const scene = SCENES[m.slug];
  let carried: { path: string; at: number; dots: unknown; prep: unknown };
  try {
    carried = JSON.parse(m.carried ?? "null");
  } catch {
    return post({ type: "failed" });
  }
  if (
    !s ||
    !scene ||
    !carried ||
    carried.path !== m.note.path ||
    carried.at !== m.note.at
  )
    return post({ type: "failed" });
  const dots = unpack(carried.dots) as DotField;
  const prep = unpack(carried.prep);
  const colors = {
    ink: m.note.ink || dots.color || "#16150f",
    red: m.red,
    paper: m.paper,
  };
  const sink = sinkFor(colors);
  if (!sink) return post({ type: "failed" });
  // Until the page stops covering itself with the frame it opened on, the
  // scene goes no further than its hold: it never jumps on, out of sight.
  let uncovered = false;
  let stage: Stage;
  try {
    stage = stageScene({
      scene,
      prep,
      main: { dots, parts: split(dots, scene.parts ?? []) },
      rect: s.rect,
      w: s.w,
      h: s.h,
      colors,
      font: "",
      dark: s.dark,
      seed: s.seed,
      sink,
      size: () => view,
      zoom: () => pushZoom(Date.now() - m.note.at),
    });
  } catch {
    return post({ type: "failed" });
  }
  const end = stage.run.duration;
  let t = 0;
  let rate = s.speed;
  let last = 0;
  let stopped = false;
  let id = 0;
  const tick = (now: number) => {
    if (stopped) return;
    if (sink.lost) {
      stopped = true;
      return post({ type: "failed" });
    }
    // On from where the last page left it, by the clock, but not past the
    // hold until the page is uncovered.
    if (!last)
      t = Math.min(
        stage.depart,
        s.t + Math.max(0, Date.now() - m.note.at) * s.speed,
      );
    else t = Math.min(uncovered ? end : stage.depart, t + (now - last) * rate);
    last = now;
    try {
      sendLook(stage.draw(t));
    } catch {
      stopped = true;
      return post({ type: "failed" });
    }
    if (!shown) {
      shown = true;
      post({ type: "shown" });
    }
    if (t >= end) {
      stopped = true;
      blank();
      return post({ type: "done" });
    }
    id = frame(tick);
  };
  let shown = false;
  id = frame(tick);
  current = {
    stop() {
      stopped = true;
      cancelFrame(id);
      blank();
    },
    hurry() {
      rate = Math.max(rate, HURRY);
    },
    uncover() {
      uncovered = true;
    },
  };
}

/* -------------------------------------------------------------- messages */

/** Set up the canvas: WebGL if it can, or 2D. Everything else waits on this. */
async function init(data: Extract<ToWorker, { type: "init" }>) {
  canvas = data.canvas;
  gl = data.gl ? makeRenderer(canvas, data.software) : null;
  let ok = true;
  if (gl && !(await gl.whenReady(4000))) {
    // The canvas has a WebGL context now, so it can't fall back to 2D.
    gl = null;
    ok = false;
  }
  post({ type: "ready", ok, gl: !!gl, url: scope.location.href });
}
let initialized: Promise<void> = Promise.resolve();

scope.onmessage = ({ data }: MessageEvent<ToWorker>) => {
  switch (data.type) {
    case "init":
      initialized = init(data);
      return;
    case "view":
      view = data.view;
      return;
    case "label":
      labelArt.set(data.key, data.art);
      return;
    case "stop":
      generation++;
      stopCurrent();
      // Called off: other cards can be got ready again.
      hold(false);
      return;
    case "hurry":
      current?.hurry();
      return;
    case "uncovered":
      current?.uncover();
      return;
  }
  // The rest need the canvas set up, and stay in order; a stop that comes
  // in meanwhile still calls off a scene that hasn't started.
  const mine = data.type === "warm" ? generation : ++generation;
  initialized = initialized.then(() => {
    switch (data.type) {
      case "warm":
        void warm(data);
        return;
      case "play":
        view = data.view;
        void play(data, mine);
        return;
      case "resume":
        view = data.view;
        resume(data, mine);
        return;
    }
  });
};
