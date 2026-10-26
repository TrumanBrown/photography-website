/**
 * The video of the real thing at the top of a hobby's media section
 * (HobbyVideo.astro), a YouTube upload in the privacy-enhanced player.
 *
 * Nothing loads from YouTube until the video is close to the viewport. Then it
 * plays muted, starting at the point in the upload that matches the visitor's
 * time of day, and pauses while it's off screen or the tab is hidden. With
 * reduced motion it loads without autoplay and waits for a press of play.
 *
 * Links anywhere on the page with `data-video-at="<seconds>"` (the aquarium
 * picker's "in my tank" links) scroll to the video and play it from there.
 * Commands go to the player over postMessage, the protocol YouTube's own
 * iframe API uses, so no YouTube script runs on the page.
 */
import { covered, whenUncovered } from "../covered";

export const EMBED_ORIGIN = "https://www.youtube-nocookie.com";

/** YouTube player states, from its infoDelivery messages. */
const PLAYING = 1;

/** Seconds into the upload that match the time of day, wrapped to its length. */
export function clockStart(now: Date, lengthSeconds: number): number {
  const s = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  return lengthSeconds > 0 ? s % lengthSeconds : 0;
}

export interface EmbedOptions {
  start: number;
  autoplay: boolean;
  /** The page's origin, so the player knows where to post its state. */
  origin?: string;
}

export function embedSrc(
  id: string,
  { start, autoplay, origin }: EmbedOptions,
): string {
  const p = new URLSearchParams({
    autoplay: autoplay ? "1" : "0",
    // Browsers only autoplay muted video. A player someone starts with the
    // play button keeps its sound.
    mute: autoplay ? "1" : "0",
    // loop needs the playlist set to the same video.
    loop: "1",
    playlist: id,
    start: String(Math.max(0, Math.floor(start))),
    playsinline: "1",
    rel: "0",
    enablejsapi: "1",
  });
  if (origin) p.set("origin", origin);
  return `${EMBED_ORIGIN}/embed/${encodeURIComponent(id)}?${p.toString()}`;
}

/** The player state in a message from the player, if it carries one. */
export function playerState(data: unknown): number | null {
  let msg = data;
  if (typeof msg === "string") {
    try {
      msg = JSON.parse(msg);
    } catch {
      return null;
    }
  }
  if (!msg || typeof msg !== "object") return null;
  const info = (msg as { info?: unknown }).info;
  if (!info || typeof info !== "object") return null;
  const state = (info as { playerState?: unknown }).playerState;
  return typeof state === "number" ? state : null;
}

export function initHobbyVideo(root: HTMLElement): void {
  const id = root.dataset.youtubeId;
  const frame = root.querySelector<HTMLElement>("[data-hobby-video-frame]");
  if (!id || !frame) return;
  const length = Number(root.dataset.length) || 0;
  const title = root.dataset.title ?? "";
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  let iframe: HTMLIFrameElement | null = null;
  // Until the player reports its state, assume it does what it was told.
  let playing = false;
  let pausedByUs = false;
  let onScreen = false;
  let heard = false;

  const send = (func: string, args: unknown[] = []): void => {
    iframe?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      EMBED_ORIGIN,
    );
  };

  // The player only reports its state after a page says it's listening, and
  // it ignores that until its own script is up, so keep saying it for a bit.
  const listen = (): void => {
    let tries = 0;
    const timer = window.setInterval(() => {
      if (heard || ++tries > 40 || !iframe) {
        window.clearInterval(timer);
        return;
      }
      iframe.contentWindow?.postMessage(
        JSON.stringify({
          event: "listening",
          id: "hobby-video",
          channel: "widget",
        }),
        EMBED_ORIGIN,
      );
    }, 250);
  };

  const load = (start: number, autoplay: boolean): void => {
    const el = document.createElement("iframe");
    el.src = embedSrc(id, { start, autoplay, origin: window.location.origin });
    el.title = title;
    el.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    el.referrerPolicy = "strict-origin-when-cross-origin";
    el.addEventListener("load", listen, { once: true });
    iframe = el;
    heard = false;
    playing = autoplay;
    frame.replaceChildren(el);
    root.classList.add("is-live");
  };

  window.addEventListener("message", (e) => {
    if (
      e.origin !== EMBED_ORIGIN ||
      !iframe ||
      e.source !== iframe.contentWindow
    )
      return;
    heard = true;
    const state = playerState(e.data);
    if (state !== null) playing = state === PLAYING;
  });

  const pause = (): void => {
    if (!iframe || !playing) return;
    send("pauseVideo");
    playing = false;
    pausedByUs = true;
  };
  const resume = (): void => {
    if (!iframe || !pausedByUs || document.hidden || !onScreen) return;
    send("playVideo");
    playing = true;
    pausedByUs = false;
  };

  const start = (): void => {
    const near = new IntersectionObserver(
      (entries) => {
        if (!entries.some((en) => en.isIntersecting)) return;
        near.disconnect();
        if (!iframe) load(clockStart(new Date(), length), !reduceMotion);
      },
      { rootMargin: "100px 0px" },
    );
    near.observe(root);
  };
  if (covered()) whenUncovered(start);
  else start();

  new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    if (onScreen) resume();
    else pause();
  }).observe(root);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else resume();
  });

  document.addEventListener("click", (e) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    const link = (e.target as Element | null)?.closest?.<HTMLElement>(
      "[data-video-at]",
    );
    if (!link) return;
    const at = Number(link.dataset.videoAt);
    if (!Number.isFinite(at)) return;
    e.preventDefault();
    root.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
    });
    // A player that hasn't said hello yet would drop the seek, so start a
    // fresh one at the right second instead.
    if (!iframe || !heard) {
      load(at, true);
      return;
    }
    send("seekTo", [at, true]);
    send("playVideo");
    playing = true;
    pausedByUs = false;
  });
}
