import type { EarlyWorker } from "../landing";
import { drawLabel } from "./label";
import { applyLook } from "./look";
import type {
  FinalMessage,
  FromWorker,
  LeaveMessage,
  PlayRequest,
  ResumeRequest,
  ToWorker,
  View,
} from "./protocol";

/**
 * The page's side of the scene worker (worker.ts): one canvas, handed over
 * to the worker once, shown while a scene plays. Where the browser can't run
 * canvases in a worker (or on the dev server with `?scene-main`), there's no
 * player and the scenes play on the page itself (engine.ts).
 */

export interface PlayEvents {
  /** It has the card's plate and is setting the scene up. */
  setting(): void;
  /** Its first frame is up, over the card. */
  started(): void;
  leave(message: LeaveMessage): void;
  final(message: FinalMessage): void;
  /** It couldn't play (no plate in time, say). The canvas is gone. */
  failed(): void;
  /** Escape called it off. The canvas is gone. */
  cancelled(): void;
}

export interface ResumeEvents {
  /** Its first frame is up: the page can stop covering itself. */
  shown(): void;
  /** It's over, or couldn't go on. The canvas is gone either way. */
  done(): void;
  failed(): void;
}

export interface Playing {
  hurry(): void;
  /** Stop it and take the canvas down. */
  stop(): void;
}

export interface Player {
  readonly canvas: HTMLCanvasElement;
  /** True once the worker is set up; false if it couldn't be. */
  readonly ready: Promise<boolean>;
  /** The worker's script, once it's ready: the next page starts its own from it. */
  readonly workerUrl: string | null;
  warm(
    slug: string,
    card: string,
    mini: string | undefined,
    dark: boolean,
  ): void;
  play(request: Omit<PlayRequest, "view">, events: PlayEvents): Playing;
  resume(request: Omit<ResumeRequest, "view">, events: ResumeEvents): Playing;
}

const flags = () =>
  import.meta.env.DEV ? new URLSearchParams(location.search) : null;

/** Whether this browser can play scenes in a worker at all. */
export function canPlayInWorker(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    "transferControlToOffscreen" in HTMLCanvasElement.prototype &&
    !flags()?.has("scene-main") &&
    !flags()?.has("scene-debug")
  );
}

const viewNow = (): View => ({
  w: document.documentElement.clientWidth,
  h: document.documentElement.clientHeight,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
});

let made: Player | null | undefined;
/** Whether the player has said it's ready (or failed), without waiting. */
let settled: boolean | undefined;

/** The page's player, made the first time it's asked for; null if it can't be. */
export function scenePlayer(): Player | null {
  if (made === undefined) made = makePlayer();
  return made;
}

/** The player if it's ready right now, never waiting on it. */
export function readyPlayer(): Player | null {
  return settled ? (made ?? null) : null;
}

/** The player unless it's known not to work: it may still be setting up. */
export function usablePlayer(): Player | null {
  return settled === false ? null : scenePlayer();
}

function makePlayer(): Player | null {
  if (!canPlayInWorker()) return null;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  let worker: Worker;
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }
  const send = (message: ToWorker, transfer: Transferable[] = []) =>
    worker.postMessage(message, transfer);

  let listener: ((message: FromWorker) => void) | null = null;
  let resolveReady: (ok: boolean) => void = () => {};
  const ready = new Promise<boolean>((resolve) => (resolveReady = resolve));
  ready.then((ok) => {
    settled = ok;
  });
  let paper = "";
  let font = "";
  let workerUrl: string | null = null;
  worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
    if (data.type === "ready") {
      workerUrl = data.url;
      return resolveReady(data.ok);
    }
    if (data.type === "label") {
      // Labels are drawn here, in the page's fonts.
      const art = drawLabel(data.text, data.color, paper, font, data.dpr);
      if (!art) return send({ type: "label", key: data.key, art: null });
      void createImageBitmap(art.image).then(
        (image) =>
          send(
            {
              type: "label",
              key: data.key,
              art: { image, w: art.w, h: art.h },
            },
            [image],
          ),
        () => send({ type: "label", key: data.key, art: null }),
      );
      return;
    }
    listener?.(data);
  };
  worker.onerror = () => {
    resolveReady(false);
    listener?.({ type: "failed" });
  };

  try {
    const offscreen = canvas.transferControlToOffscreen();
    send(
      {
        type: "init",
        canvas: offscreen,
        software: Boolean(flags()?.has("scene-gl")),
        gl: !flags()?.has("scene-2d"),
      },
      [offscreen],
    );
  } catch {
    worker.terminate();
    return null;
  }
  // Give up on a worker that never says it's ready.
  setTimeout(() => resolveReady(false), 6000);

  window.addEventListener("resize", () => {
    if (canvas.isConnected) send({ type: "view", view: viewNow() });
  });

  /** Put the canvas up, listening for the scene's input, until `off()`. */
  function mount(className: string) {
    canvas.className = className;
    canvas.style.opacity = "";
    canvas.style.filter = "";
    document.body.append(canvas);
    paper = getComputedStyle(document.documentElement)
      .getPropertyValue("--paper")
      .trim();
    font = getComputedStyle(document.body).fontFamily;
  }

  return {
    canvas,
    ready,
    get workerUrl() {
      return workerUrl;
    },
    warm(slug, card, mini, dark) {
      send({ type: "warm", slug, card, mini, dark });
    },

    play(request, events) {
      mount("open-layer");
      const view = viewNow();
      let over = false;
      const end = () => {
        if (over) return;
        over = true;
        listener = null;
        listen(false);
        canvas.remove();
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          stop();
          events.cancelled();
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          hurry();
        }
      };
      const hold = (event: Event) => event.preventDefault();
      const hurry = () => send({ type: "hurry" });
      const listen = (on: boolean) => {
        const method = on ? "addEventListener" : "removeEventListener";
        window[method]("keydown", onKey as EventListener, true);
        canvas[method]("pointerdown", hurry);
        canvas[method]("wheel", hold, {
          passive: false,
        } as AddEventListenerOptions);
        canvas[method]("touchmove", hold, {
          passive: false,
        } as AddEventListenerOptions);
      };
      const stop = () => {
        send({ type: "stop" });
        end();
      };
      listen(true);
      listener = (message) => {
        if (message.type === "setting") events.setting();
        else if (message.type === "started") events.started();
        else if (message.type === "look") applyLook(canvas, message);
        else if (message.type === "leave") {
          // Escape still calls it off now, through stop(); input otherwise ends.
          listen(false);
          events.leave(message);
        } else if (message.type === "final") {
          listen(false);
          events.final(message);
        } else if (message.type === "failed") {
          end();
          events.failed();
        }
      };
      send({ type: "play", ...request, view });
      return { hurry, stop };
    },

    resume(request, events) {
      mount("landing-veil");
      let over = false;
      const end = () => {
        if (over) return;
        over = true;
        listener = null;
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("pointerdown", hurry, true);
        canvas.remove();
      };
      const hurry = () => send({ type: "hurry" });
      const onKey = (event: KeyboardEvent) => {
        if (["Escape", "Enter", " "].includes(event.key)) hurry();
      };
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("pointerdown", hurry, true);
      listener = (message) => {
        if (message.type === "shown") {
          events.shown();
          if (!over) send({ type: "uncovered" });
        } else if (message.type === "look") applyLook(canvas, message);
        else if (message.type === "done") {
          end();
          events.done();
        } else if (message.type === "failed") {
          end();
          events.failed();
        }
      };
      send({ type: "resume", ...request, view: viewNow() });
      return {
        hurry,
        stop() {
          send({ type: "stop" });
          end();
        },
      };
    },
  };
}

/**
 * Take over a scene the page's head script already started in a worker of
 * its own (landing.ts): show it, pass input on, and clear it away.
 */
export function adoptResume(early: EarlyWorker, events: ResumeEvents): Playing {
  const { worker, canvas } = early;
  const send = (message: ToWorker) => worker.postMessage(message);
  let over = false;
  const hurry = () => send({ type: "hurry" });
  const onKey = (event: KeyboardEvent) => {
    if (["Escape", "Enter", " "].includes(event.key)) hurry();
  };
  const end = () => {
    if (over) return;
    over = true;
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointerdown", hurry, true);
    canvas.remove();
    worker.terminate();
  };
  const handle = (message: FromWorker) => {
    if (over) return;
    if (message.type === "shown") {
      events.shown();
      if (!over) send({ type: "uncovered" });
    } else if (message.type === "look") applyLook(canvas, message);
    else if (message.type === "done") {
      end();
      events.done();
    } else if (message.type === "failed") {
      end();
      events.failed();
    }
  };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", hurry, true);
  worker.onmessage = ({ data }: MessageEvent<FromWorker>) => handle(data);
  worker.onerror = () => handle({ type: "failed" });
  // What came in before the page took over goes through once the caller has
  // its handle, as anything after it does.
  queueMicrotask(() => {
    for (const message of early.inbox.splice(0)) handle(message as FromWorker);
    // The head script only had the window to go by; now the page is laid out.
    if (!over) send({ type: "view", view: viewNow() });
  });
  return {
    hurry,
    stop() {
      send({ type: "stop" });
      end();
    },
  };
}
