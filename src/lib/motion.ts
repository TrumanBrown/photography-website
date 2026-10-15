/**
 * Motion for the hobby pages. Each helper is a port of a React component
 * (Cult UI, Watermelon UI) rewritten as plain TypeScript, because the site is
 * Astro with no React. Only the mechanic is kept; the look comes from the
 * shared classes in src/styles/global.css.
 *
 * - rollTo: Cult UI "rolling-number". A counter eases to its new value. A
 *   single step rolls the digit instead, since counting from 2 to 3 shows
 *   nothing.
 * - setHair: the fill of a .hair progress rule (Watermelon UI
 *   "labeled-progress-indicator").
 * - initUnderlineTabs: Cult UI "direction-aware-tabs" and Watermelon UI
 *   "discrete-tabs". One bar slides to the checked option.
 * - stamp: the floating score popup games use for points won or lost, kept
 *   by the thing it's about and drawn as a rubber stamp. It slams down at an
 *   angle, sits for a beat, then drifts down and fades.
 *
 * Everything settles instantly under prefers-reduced-motion.
 */

const reduceQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

export function prefersReducedMotion(): boolean {
  return reduceQuery?.matches ?? false;
}

const counting = new WeakMap<HTMLElement, number>();

export interface RollOptions {
  /** Text for a value. Defaults to en-US digit grouping ("3,050"). */
  format?: (value: number) => string;
  /** How long a count takes, in ms. */
  ms?: number;
}

/**
 * Show `to` in `node`. The first call (or any call under reduced motion) just
 * sets the text; later calls animate from the previous value. Give the node
 * `display: inline-block` so the single-step roll can move it.
 */
export function rollTo(
  node: HTMLElement,
  to: number,
  options: RollOptions = {},
): void {
  const format =
    options.format ?? ((value: number) => value.toLocaleString("en-US"));
  const previous = node.dataset.value;
  node.dataset.value = String(to);

  // A cancelled animation never fires onfinish, so an older roll can't write
  // its value over this one.
  node.getAnimations?.().forEach((animation) => animation.cancel());
  const pending = counting.get(node);
  if (pending !== undefined) {
    cancelAnimationFrame(pending);
    counting.delete(node);
  }

  const from = previous === undefined ? Number.NaN : Number(previous);
  if (!Number.isFinite(from) || from === to || prefersReducedMotion()) {
    node.textContent = format(to);
    return;
  }

  if (Math.abs(to - from) <= 1) {
    rollDigit(node, format(to), to > from ? 1 : -1);
    return;
  }

  const ms = options.ms ?? 420;
  const start = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    node.textContent = format(Math.round(from + (to - from) * eased));
    if (k < 1) counting.set(node, requestAnimationFrame(step));
    else counting.delete(node);
  };
  counting.set(node, requestAnimationFrame(step));
}

/** The old value slides out and fades, the new one slides in behind it. */
function rollDigit(node: HTMLElement, text: string, direction: 1 | -1): void {
  if (typeof node.animate !== "function") {
    node.textContent = text;
    return;
  }
  const out = node.animate(
    [
      { transform: "translateY(0)", opacity: 1 },
      { transform: `translateY(${-45 * direction}%)`, opacity: 0 },
    ],
    { duration: 120, easing: "cubic-bezier(0.4, 0, 1, 1)" },
  );
  out.onfinish = () => {
    node.textContent = text;
    node.animate(
      [
        { transform: `translateY(${45 * direction}%)`, opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      { duration: 200, easing: "cubic-bezier(0, 0, 0.2, 1)" },
    );
  };
}

/** Fill a .hair rule to `fraction` (0 to 1) by scaling its <i>. */
export function setHair(fill: HTMLElement, fraction: number): void {
  const clamped = Number.isFinite(fraction)
    ? Math.min(1, Math.max(0, fraction))
    : 0;
  fill.style.transform = `scaleX(${clamped})`;
}

export interface StampOptions {
  /** A small tracked line under the figure, like "points". */
  unit?: string;
  /** Degrees; left out, it's a slightly different angle each time, the way
   *  a hand stamp never lands square. */
  tilt?: number;
}

/** How long a stamp is on screen, ms. */
export const STAMP_MS = 1700;

/**
 * The keyframes for a stamp at `tilt` degrees. It comes down fast and lands a
 * touch small, as if pressed into the paper, then settles; sits still for
 * about half a second; then drifts down and away while it fades.
 */
export function stampFrames(tilt: number, reduced = false): Keyframe[] {
  const at = (y: number, scale: number, turn: number) =>
    `translateY(${y}px) scale(${scale}) rotate(${turn}deg)`;
  if (reduced) {
    return [
      { offset: 0, opacity: 0, transform: at(0, 1, tilt) },
      { offset: 0.02, opacity: 1, transform: at(0, 1, tilt) },
      { offset: 0.8, opacity: 1, transform: at(0, 1, tilt) },
      { offset: 1, opacity: 0, transform: at(0, 1, tilt) },
    ];
  }
  return [
    {
      offset: 0,
      opacity: 0,
      transform: at(-10, 1.9, tilt - 10),
      easing: "cubic-bezier(0.55, 0, 1, 0.45)",
    },
    {
      offset: 0.07,
      opacity: 1,
      transform: at(0, 0.94, tilt),
      easing: "cubic-bezier(0.2, 0, 0.2, 1)",
    },
    { offset: 0.14, opacity: 1, transform: at(0, 1, tilt), easing: "linear" },
    {
      offset: 0.5,
      opacity: 1,
      transform: at(0, 1, tilt),
      easing: "cubic-bezier(0.4, 0, 1, 1)",
    },
    { offset: 1, opacity: 0, transform: at(28, 0.98, tilt + 4) },
  ];
}

/**
 * Stamp `text` onto `host` (which needs position: relative; the stamp sits in
 * its top right corner). Each call puts down its own stamp, so quick presses
 * never cut each other off, and it takes itself away when it's done. It's
 * decorative: say what changed in words somewhere a screen reader hears it.
 */
export function stamp(
  host: HTMLElement,
  text: string,
  options: StampOptions = {},
): HTMLElement {
  const mark = document.createElement("span");
  mark.className = "stamp";
  mark.setAttribute("aria-hidden", "true");
  const figure = document.createElement("b");
  figure.textContent = text;
  mark.append(figure);
  if (options.unit) {
    const unit = document.createElement("i");
    unit.textContent = options.unit;
    mark.append(unit);
  }
  host.append(mark);

  const tilt = options.tilt ?? -9 + Math.random() * 6;
  const reduced = prefersReducedMotion();
  if (typeof mark.animate !== "function") {
    setTimeout(() => mark.remove(), STAMP_MS);
    return mark;
  }
  const run = mark.animate(stampFrames(tilt, reduced), {
    duration: reduced ? 1400 : STAMP_MS,
    fill: "both",
  });
  const done = () => mark.remove();
  run.onfinish = done;
  run.oncancel = done;
  return mark;
}

/**
 * Wire a `.utabs` radio group: `role="radiogroup"` holding
 * `<button role="radio" aria-checked>` options. Clicking or arrowing to an
 * option checks it (the option's own click handler still runs, so an engine
 * can react), and the bar follows `aria-checked` however it changes, including
 * from code. Only the checked option is in the tab order.
 */
export function initUnderlineTabs(group: HTMLElement): void {
  if (group.dataset.utabsReady === "true") return;
  group.dataset.utabsReady = "true";

  const options = (): HTMLElement[] =>
    Array.from(group.querySelectorAll<HTMLElement>(':scope > [role="radio"]'));

  let found = group.querySelector<HTMLElement>(":scope > .utabs-bar");
  if (!found) {
    found = document.createElement("span");
    found.className = "utabs-bar";
    found.setAttribute("aria-hidden", "true");
    group.append(found);
  }
  const bar = found;

  function place(): void {
    const all = options();
    const checked = all.find(
      (option) => option.getAttribute("aria-checked") === "true",
    );
    all.forEach((option, index) => {
      option.tabIndex =
        option === checked || (!checked && index === 0) ? 0 : -1;
    });
    if (!checked || checked.offsetWidth === 0) {
      bar.style.transform = "scaleX(0)";
      return;
    }
    bar.style.transform = `translateX(${checked.offsetLeft}px) scaleX(${checked.offsetWidth / 100})`;
  }

  function check(option: HTMLElement): void {
    for (const other of options()) {
      other.setAttribute("aria-checked", String(other === option));
    }
  }

  group.addEventListener("click", (event) => {
    const option = (event.target as Element | null)?.closest<HTMLElement>(
      '[role="radio"]',
    );
    if (!option || option.parentElement !== group) return;
    if (option.matches(":disabled")) return;
    check(option);
    group.dispatchEvent(
      new CustomEvent("utabs:change", {
        detail: option.dataset.value ?? option.textContent?.trim() ?? "",
        bubbles: true,
      }),
    );
  });

  group.addEventListener("keydown", (event) => {
    const all = options();
    const index = all.indexOf(event.target as HTMLElement);
    if (index < 0) return;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (index + 1) % all.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (index - 1 + all.length) % all.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = all.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    all[next].focus();
    all[next].click();
  });

  new MutationObserver(place).observe(group, {
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-checked"],
  });
  if ("ResizeObserver" in window) new ResizeObserver(place).observe(group);

  // The first placement shouldn't slide in from the left edge.
  group.classList.add("no-anim");
  place();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => group.classList.remove("no-anim")),
  );
  document.fonts?.ready.then(place).catch(() => {});
}

/** Wire every `[data-utabs]` group under `root`. */
export function initAllUnderlineTabs(root: ParentNode = document): void {
  root
    .querySelectorAll<HTMLElement>("[data-utabs]")
    .forEach((group) => initUnderlineTabs(group));
}
