// Privacy-friendly pageview beacon. Sends a pageview on load and a
// time-on-page measurement when the visitor leaves. No cookies; sessionId is
// ephemeral (sessionStorage, cleared when the tab closes). The /admin pages
// are never tracked, and neither is a browser that has opened /admin (the
// `tb_owner` flag admin.ts sets), so Truman's own visits stay out.
//
// Every page also reports its speed (Core Web Vitals), JavaScript errors, the
// theme and viewport band, a theme toggle, photos viewed in the lightbox,
// Narrow nature rounds and the first play of a hobby's toy. On the front door
// it notes what happens on the Weekdays side (the resume): when it's shown,
// how long it's on screen, which sections are reached and read, and what's
// clicked and copied (docs/analytics.md).

import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";
import {
  cleanCopy,
  cleanVia,
  createVisibleTimer,
  OWNER_KEY,
  type VisibleTimer,
} from "./beacon";

interface TrackEvent {
  k:
    | "show"
    | "hide"
    | "wd"
    | "reach"
    | "click"
    | "copy"
    | "dwell"
    | "vital"
    | "err"
    | "theme"
    | "photo"
    | "nn"
    | "toy";
  t: number;
  v?: string | number;
  n?: number;
  s?: string;
  d?: number;
  l?: number;
  c?: number;
  z?: boolean;
}

/** Events a pageview may send, apart from running totals and speed. */
const MAX_EVENTS = 60;
const MAX_ERRORS = 5;
const BATCH = 20;
const FLUSH_AFTER_MS = 3000;
/** The alert to Truman waits for this much reading (api/shared/alert.js). */
const ENGAGED_MS = 15000;
const UNCAPPED = new Set<TrackEvent["k"]>(["wd", "dwell", "vital"]);

function rand(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function isOwner(): boolean {
  try {
    return localStorage.getItem(OWNER_KEY) === "1";
  } catch {
    return false;
  }
}

// Reads ?via= from a link Truman handed out (the resume's links carry
// ?via=resume) and takes it out of the address bar, so a copied or shared
// link doesn't carry it on.
function takeVia(): string {
  const params = new URLSearchParams(location.search);
  if (!params.has("via")) return "";
  const via = cleanVia(params.get("via"));
  params.delete("via");
  const query = params.toString();
  try {
    history.replaceState(
      history.state,
      "",
      location.pathname + (query ? `?${query}` : "") + location.hash,
    );
  } catch {}
  return via;
}

function themeNow(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function themeFrom(): "device" | "choice" {
  try {
    return localStorage.getItem("theme") ? "choice" : "device";
  } catch {
    return "device";
  }
}

function viewportBand(): string {
  const width = window.innerWidth;
  if (width < 480) return "<480";
  if (width < 768) return "480-767";
  if (width < 1024) return "768-1023";
  if (width < 1440) return "1024-1439";
  return "1440+";
}

function send(body: object): void {
  try {
    const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
    if (navigator.sendBeacon("/api/track", blob)) return;
  } catch {}
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

/** One pageview's queue of events, sent in batches. */
interface Events {
  since(): number;
  push(event: Omit<TrackEvent, "t"> & { t?: number }, now?: boolean): void;
  flush(): void;
  /** Called at each flush to add running totals (Weekdays time, dwell). */
  onFlush(add: () => void): void;
}

function createEvents(sid: string, pvid: string, start: number): Events {
  const queue: TrackEvent[] = [];
  const adders: Array<() => void> = [];
  let counted = 0;
  let timer: number | undefined;
  let flushing = false;
  const since = () => Date.now() - start;

  function flush(): void {
    if (flushing) return;
    flushing = true;
    window.clearTimeout(timer);
    timer = undefined;
    try {
      // Running totals pushed here join this flush rather than starting another.
      adders.forEach((add) => add());
      while (queue.length) {
        send({ type: "ev", sid, pvid, events: queue.splice(0, BATCH) });
      }
    } finally {
      flushing = false;
    }
  }

  return {
    since,
    flush,
    onFlush(add) {
      adders.push(add);
    },
    push(event, now = false) {
      if (!UNCAPPED.has(event.k)) {
        if (counted >= MAX_EVENTS) return;
        counted++;
      }
      queue.push({ ...event, t: event.t ?? since() } as TrackEvent);
      if (flushing) return;
      if (now || document.visibilityState === "hidden") flush();
      else if (timer === undefined) {
        timer = window.setTimeout(flush, FLUSH_AFTER_MS);
      }
    },
  };
}

// Core Web Vitals from this visit, reported when the page is hidden. Called
// before the flush listeners exist, so web-vitals' own hidden handlers run
// first and their numbers go out in the same flush.
function trackSpeed(events: Events): void {
  const report = (metric: Metric) =>
    events.push({ k: "vital", v: metric.name, d: metric.value });
  try {
    onLCP(report);
    onINP(report);
    onCLS(report);
    onFCP(report);
    onTTFB(report);
  } catch {}
}

// Script errors from this site's own files, and unhandled promise rejections.
// Extensions' and other sites' errors are left out.
function trackErrors(events: Events): void {
  let count = 0;
  window.addEventListener("error", (event) => {
    if (count >= MAX_ERRORS || !(event instanceof ErrorEvent)) return;
    const message = event.message || "";
    if (!message || message === "Script error.") return;
    let source = "";
    if (event.filename) {
      try {
        const url = new URL(event.filename);
        if (url.origin !== location.origin) return;
        source = url.pathname;
      } catch {
        return;
      }
    }
    count++;
    events.push(
      {
        k: "err",
        v: message.slice(0, 200),
        s: source,
        l: event.lineno,
        c: event.colno,
      },
      true,
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (count >= MAX_ERRORS) return;
    const reason = event.reason;
    if (reason && (reason as Error).name === "AbortError") return;
    const message =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : String(reason ?? "");
    if (!message) return;
    count++;
    events.push(
      { k: "err", v: `Unhandled rejection: ${message}`.slice(0, 200) },
      true,
    );
  });
}

// The theme toggle flips `dark` on <html> (ThemeToggle.astro).
function trackTheme(events: Events): void {
  let last = themeNow();
  new MutationObserver(() => {
    const next = themeNow();
    if (next === last) return;
    last = next;
    events.push({ k: "theme", v: next });
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

// Photos (Lightbox.astro), Narrow nature (day-list.ts) and hobby toys
// (data-toy wrappers in hobbies/[slug].astro) announce themselves.
function trackPlay(events: Events): void {
  window.addEventListener("tb:photo", (event) => {
    const detail = (
      event as CustomEvent<{ key: string; ms: number; zoomed: boolean }>
    ).detail;
    if (detail?.key)
      events.push({
        k: "photo",
        v: detail.key,
        d: Math.round(detail.ms),
        z: detail.zoomed,
      });
  });
  window.addEventListener("tb:nn", (event) => {
    const detail = (event as CustomEvent<{ mode: string; score?: number }>)
      .detail;
    if (!detail) return;
    if (detail.mode === "more") events.push({ k: "nn", v: "more" });
    else events.push({ k: "nn", v: detail.mode, d: detail.score ?? 0 }, true);
  });
  const played = new Set<string>();
  const onPlay = (event: Event) => {
    const toy = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-toy]",
    );
    const slug = toy?.dataset.toy;
    if (!slug || played.has(slug)) return;
    played.add(slug);
    events.push({ k: "toy", v: slug });
  };
  for (const type of ["pointerdown", "keydown"]) {
    document.addEventListener(type, onPlay, { capture: true, passive: true });
  }
}

function trackWeekdays(events: Events): void {
  const door = document.querySelector<HTMLElement>("[data-door]");
  const panel = door?.querySelector<HTMLElement>('[data-panel="weekdays"]');
  if (!door || !panel) return;

  const timer = createVisibleTimer();
  let showing = false;
  let lastWd = 0;
  let engagedSent = false;
  let engagedCheck: number | undefined;

  const sections = [
    ...panel.querySelectorAll<HTMLElement>("[data-track-section]"),
  ];
  const dwell = new Map<
    string,
    { timer: VisibleTimer; inBand: boolean; sent: number }
  >();
  for (const el of sections) {
    const name = el.dataset.trackSection;
    if (name && !dwell.has(name)) {
      dwell.set(name, { timer: createVisibleTimer(), inBand: false, sent: 0 });
    }
  }
  const visible = () => showing && document.visibilityState === "visible";
  function updateDwell(): void {
    for (const entry of dwell.values())
      entry.timer.set(entry.inBand && visible());
  }

  events.onFlush(() => {
    const wd = Math.round(timer.total());
    if (wd > lastWd) {
      lastWd = wd;
      events.push({ k: "wd", v: wd });
    }
    for (const [name, entry] of dwell) {
      const ms = Math.round(entry.timer.total());
      if (ms >= 1000 && ms > entry.sent) {
        entry.sent = ms;
        events.push({ k: "dwell", v: name, d: ms });
      }
    }
  });

  // Once Weekdays has been on screen for 15 seconds, send the running total
  // straight away, so an alert to Truman can go out during the visit.
  function watchEngaged(): void {
    window.clearInterval(engagedCheck);
    if (engagedSent || !visible()) return;
    engagedCheck = window.setInterval(() => {
      if (timer.total() >= ENGAGED_MS) {
        engagedSent = true;
        window.clearInterval(engagedCheck);
        events.flush();
      }
    }, 2500);
  }

  function setShowing(next: boolean): void {
    if (next === showing) return;
    showing = next;
    timer.set(visible());
    updateDwell();
    watchEngaged();
    if (showing) events.push({ k: "show" });
    else events.push({ k: "hide" }, true);
  }

  // The switch in index.astro announces each change, and marks the door with
  // the side it's on in case it ran before this script did.
  document.addEventListener("week:side", (event) => {
    setShowing((event as CustomEvent<string>).detail === "weekdays");
  });
  if (door.dataset.side) setShowing(door.dataset.side === "weekdays");

  document.addEventListener("visibilitychange", () => {
    timer.set(visible());
    updateDwell();
    watchEngaged();
  });
  window.addEventListener("pagehide", () => {
    timer.set(false);
    for (const entry of dwell.values()) entry.timer.set(false);
  });

  if ("IntersectionObserver" in window && sections.length) {
    // Each section and job once, the first time its top comes up the screen.
    const reach = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !showing) continue;
          const el = entry.target as HTMLElement;
          reach.unobserve(el);
          events.push({
            k: "reach",
            v: el.dataset.trackSection,
            n: sections.indexOf(el),
          });
        }
      },
      { rootMargin: "0px 0px -25% 0px" },
    );
    // A section is being read while it crosses the middle of the screen.
    const band = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const name = (entry.target as HTMLElement).dataset.trackSection;
          const item = name ? dwell.get(name) : undefined;
          if (item) item.inBand = entry.isIntersecting;
        }
        updateDwell();
      },
      { rootMargin: "-40% 0px -40% 0px" },
    );
    sections.forEach((el) => {
      reach.observe(el);
      band.observe(el);
    });
  }

  // Clicks on anything named for tracking: the rail, the buttons and links on
  // Weekdays. Sent at once, since a click often leaves the page.
  function onClick(event: MouseEvent): void {
    if (event.type === "auxclick" && event.button !== 1) return;
    const target = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-track]",
    );
    if (target?.dataset.track)
      events.push({ k: "click", v: target.dataset.track }, true);
  }
  document.addEventListener("click", onClick, { capture: true });
  document.addEventListener("auxclick", onClick, { capture: true });

  document.addEventListener("copy", () => {
    const selection = document.getSelection();
    const node = selection?.anchorNode;
    if (!selection || !node || !panel.contains(node)) return;
    const text = cleanCopy(selection.toString());
    if (!text) return;
    const from = (
      node instanceof Element ? node : node.parentElement
    )?.closest<HTMLElement>("[data-track-section]");
    events.push(
      { k: "copy", v: text, s: from?.dataset.trackSection ?? "weekdays" },
      true,
    );
  });
}

function track() {
  // Astro dev does not host the SWA Functions; avoid noisy local 404s.
  if (import.meta.env.DEV) return;

  // Don't track the admin tool, Truman's own browsers or automated ones.
  if (location.pathname.startsWith("/admin")) return;
  if (navigator.webdriver) return;
  if (isOwner()) return;

  let sid = sessionStorage.getItem("tb_sid");
  if (!sid) {
    sid = rand();
    sessionStorage.setItem("tb_sid", sid);
  }
  const pvid = rand();
  const start = Date.now();
  const via = takeVia();
  const events = createEvents(sid, pvid, start);

  // Pageview on load — use keepalive so it survives a fast navigation.
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "pv",
        path: location.pathname,
        ref: document.referrer,
        via,
        sid,
        pvid,
        theme: themeNow(),
        themeFrom: themeFrom(),
        vw: viewportBand(),
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {}

  // Weekdays first: its timers stop on a hidden tab before web-vitals' own
  // hidden handlers report, so the totals sent with them are already final.
  trackWeekdays(events);
  trackSpeed(events);

  // Time-on-page when the tab is hidden/closed. sendBeacon is reliable here.
  let sent = false;
  function sendDuration() {
    if (sent) return;
    sent = true;
    const dur = Date.now() - start;
    try {
      const blob = new Blob([JSON.stringify({ type: "dur", sid, pvid, dur })], {
        type: "application/json",
      });
      navigator.sendBeacon("/api/track", blob);
    } catch {}
  }

  trackErrors(events);
  trackTheme(events);
  trackPlay(events);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      sendDuration();
      events.flush();
    }
  });
  window.addEventListener("pagehide", () => {
    sendDuration();
    events.flush();
  });
}

track();
