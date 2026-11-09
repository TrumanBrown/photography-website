// Privacy-friendly pageview beacon. Sends a pageview on load and a
// time-on-page measurement when the visitor leaves. No cookies; sessionId is
// ephemeral (sessionStorage, cleared when the tab closes). The /admin pages
// are never tracked, and neither is a browser that has opened /admin (the
// `tb_owner` flag admin.ts sets), so Truman's own visits stay out.
//
// On the front door it also notes what happens on the Weekdays side (the
// resume): when it's shown, how long it's on screen, which sections are
// reached, what's clicked and what's copied (docs/analytics.md).

import { cleanCopy, cleanVia, createVisibleTimer, OWNER_KEY } from "./beacon";

interface TrackEvent {
  k: "show" | "hide" | "wd" | "reach" | "click" | "copy";
  t: number;
  v?: string | number;
  n?: number;
  s?: string;
}

const MAX_EVENTS = 60;
const BATCH = 20;
const FLUSH_AFTER_MS = 3000;

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

function trackWeekdays(sid: string, pvid: string, start: number): void {
  const door = document.querySelector<HTMLElement>("[data-door]");
  const panel = door?.querySelector<HTMLElement>('[data-panel="weekdays"]');
  if (!door || !panel) return;

  const timer = createVisibleTimer();
  let showing = false;
  const queue: TrackEvent[] = [];
  let sent = 0;
  let lastWd = 0;
  let flushTimer: number | undefined;
  const since = () => Date.now() - start;

  function flush(withTime: boolean): void {
    window.clearTimeout(flushTimer);
    flushTimer = undefined;
    const wd = Math.round(timer.total());
    if (withTime && wd > lastWd) {
      queue.push({ k: "wd", v: wd, t: since() });
      lastWd = wd;
    }
    while (queue.length) {
      send({ type: "ev", sid, pvid, events: queue.splice(0, BATCH) });
    }
  }

  function push(event: TrackEvent, now = false): void {
    if (sent >= MAX_EVENTS) return;
    sent++;
    queue.push(event);
    if (now) flush(true);
    else if (flushTimer === undefined) {
      flushTimer = window.setTimeout(() => flush(false), FLUSH_AFTER_MS);
    }
  }

  function setShowing(next: boolean): void {
    if (next === showing) return;
    showing = next;
    timer.set(showing && document.visibilityState === "visible");
    if (showing) push({ k: "show", t: since() });
    else push({ k: "hide", t: since() }, true);
  }

  // The switch in index.astro announces each change, and marks the door with
  // the side it's on in case it ran before this script did.
  document.addEventListener("week:side", (event) => {
    setShowing((event as CustomEvent<string>).detail === "weekdays");
  });
  if (door.dataset.side) setShowing(door.dataset.side === "weekdays");

  document.addEventListener("visibilitychange", () => {
    timer.set(showing && document.visibilityState === "visible");
    if (document.visibilityState === "hidden") flush(true);
  });
  window.addEventListener("pagehide", () => {
    timer.set(false);
    flush(true);
  });

  // Each section and job once, the first time its top comes up the screen.
  const sections = [
    ...panel.querySelectorAll<HTMLElement>("[data-track-section]"),
  ];
  if ("IntersectionObserver" in window && sections.length) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !showing) continue;
          const el = entry.target as HTMLElement;
          observer.unobserve(el);
          push({
            k: "reach",
            v: el.dataset.trackSection,
            n: sections.indexOf(el),
            t: since(),
          });
        }
      },
      { rootMargin: "0px 0px -25% 0px" },
    );
    sections.forEach((el) => observer.observe(el));
  }

  // Clicks on anything named for tracking: the rail, the buttons and links on
  // Weekdays. Sent at once, since a click often leaves the page.
  function onClick(event: MouseEvent): void {
    if (event.type === "auxclick" && event.button !== 1) return;
    const target = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-track]",
    );
    if (target?.dataset.track)
      push({ k: "click", v: target.dataset.track, t: since() }, true);
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
    push(
      {
        k: "copy",
        v: text,
        s: from?.dataset.trackSection ?? "weekdays",
        t: since(),
      },
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
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {}

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
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") sendDuration();
  });
  window.addEventListener("pagehide", sendDuration);

  trackWeekdays(sid, pvid, start);
}

track();
