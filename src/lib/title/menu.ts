/**
 * The title screen's menu: one selection for the pointer, focus and the arrow
 * keys, with a frame and a pixel cursor that spring from key to key.
 *
 * Nothing looks selected at rest. A key shows as selected only while the
 * mouse is on it or the keyboard is ("it should not show the preview of the
 * item when i am not hovering my cursor over it", Truman, 2026-11-20).
 */

/** A box that springs to each target and stretches along its motion. */
export function follow(
  el: HTMLElement,
  o: { k: number; c: number; stretch: number; reduced: () => boolean },
): {
  to(
    r: { x: number; y: number; w: number; h: number },
    instant?: boolean,
  ): void;
} {
  type State = {
    x: number;
    y: number;
    w: number;
    h: number;
    vx: number;
    vy: number;
    vw: number;
    vh: number;
  };
  let s: State | null = null;
  let t = { x: 0, y: 0, w: 0, h: 0 };
  let raf = 0;
  let last = 0;
  const keys = ["x", "y", "w", "h"] as const;
  const vel = { x: "vx", y: "vy", w: "vw", h: "vh" } as const;
  function set(): void {
    const q = s!;
    const sx =
      1 +
      Math.min(0.22, Math.abs(q.vx) * o.stretch) -
      Math.min(0.08, Math.abs(q.vy) * o.stretch * 0.5);
    const sy =
      1 +
      Math.min(0.22, Math.abs(q.vy) * o.stretch) -
      Math.min(0.08, Math.abs(q.vx) * o.stretch * 0.5);
    const w = q.w * sx;
    const h = q.h * sy;
    el.style.width = `${w.toFixed(1)}px`;
    el.style.height = `${h.toFixed(1)}px`;
    el.style.transform = `translate3d(${(q.x - (w - q.w) / 2).toFixed(1)}px,${(q.y - (h - q.h) / 2).toFixed(1)}px,0)`;
  }
  function tick(now: number): void {
    const dt = Math.min(0.034, (now - last) / 1000);
    last = now;
    const q = s!;
    let moving = false;
    for (const k of keys) {
      const v = vel[k];
      q[v] += (o.k * (t[k] - q[k]) - o.c * q[v]) * dt;
      q[k] += q[v] * dt;
      if (Math.abs(t[k] - q[k]) > 0.05 || Math.abs(q[v]) > 0.5) moving = true;
    }
    set();
    if (moving) raf = requestAnimationFrame(tick);
    else {
      raf = 0;
      for (const k of keys) {
        q[k] = t[k];
        q[vel[k]] = 0;
      }
      set();
    }
  }
  return {
    to(r, instant) {
      t = { x: r.x, y: r.y, w: r.w, h: r.h };
      if (!s || instant || o.reduced()) {
        cancelAnimationFrame(raf);
        raf = 0;
        s = { ...t, vx: 0, vy: 0, vw: 0, vh: 0 };
        set();
        return;
      }
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    },
  };
}

export interface Menu {
  readonly sel: number;
  select(i: number, how: string): void;
  clear(): void;
  /** Back to rest unless the mouse is on the menu or the keyboard is. */
  rest(): void;
  /** After a door or a drawer closes: rest, unless the mouse is on the menu. */
  back(): void;
}

/**
 * Items are links or buttons. Arrow keys move through them (and wrap), Home
 * and End jump, Enter or a click opens. A mouse selects on hover; touch
 * selects on press. The mouse leaving `boxes`, or the focus leaving the
 * items, clears it, unless the keyboard is on an item. `live()` says whether
 * the keys should answer at all (the title screen is up, no drawer open), and
 * `busy()` whether a door is opening over the page.
 */
export function createMenu(o: {
  items: HTMLElement[];
  boxes: HTMLElement[];
  live: () => boolean;
  busy: () => boolean;
  onSelect: (i: number, prev: number, how: string) => void;
  onClear: () => void;
  onOpen: (i: number, event: MouseEvent) => boolean;
}): Menu {
  const { items, boxes } = o;
  let sel = -1;
  function select(i: number, how: string): void {
    if (i === sel || i < 0 || i >= items.length) return;
    const prev = sel;
    sel = i;
    items.forEach((el, k) => el.classList.toggle("is-sel", k === i));
    o.onSelect(i, prev, how);
  }
  function clear(): void {
    if (sel < 0) return;
    sel = -1;
    for (const el of items) el.classList.remove("is-sel", "is-down");
    o.onClear();
  }
  const keyed = (): number => {
    const k = items.indexOf(document.activeElement as HTMLElement);
    return k >= 0 && items[k].matches(":focus-visible") ? k : -1;
  };
  const hovered = (): boolean => boxes.some((b) => b.matches(":hover"));
  function rest(): void {
    if (o.busy()) return;
    const k = keyed();
    if (k >= 0) select(k, "focus");
    else clear();
  }
  for (const b of boxes) {
    b.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") rest();
    });
  }
  items.forEach((el, i) => {
    el.addEventListener("focusout", (e) => {
      if (items.includes(e.relatedTarget as HTMLElement) || hovered()) return;
      rest();
    });
    el.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") select(i, "pointer");
    });
    el.addEventListener("focus", () => select(i, "focus"));
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      select(i, "press");
      el.classList.add("is-down");
    });
    for (const type of [
      "pointerup",
      "pointercancel",
      "pointerleave",
    ] as const) {
      el.addEventListener(type, () => el.classList.remove("is-down"));
    }
    el.addEventListener("click", (e) => {
      if (o.onOpen(i, e)) e.preventDefault();
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !o.live()) return;
    const inMenu = items.includes(document.activeElement as HTMLElement);
    const step =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (step) {
      e.preventDefault();
      const i = sel < 0 ? 0 : (sel + step + items.length) % items.length;
      items[i].focus({ preventScroll: true });
      select(i, "keys");
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const j = e.key === "Home" ? 0 : items.length - 1;
      items[j].focus({ preventScroll: true });
      select(j, "keys");
    } else if (
      (e.key === "Enter" || e.key === " ") &&
      !inMenu &&
      sel >= 0 &&
      document.activeElement === document.body
    ) {
      e.preventDefault();
      items[sel].click();
    }
  });
  return {
    get sel() {
      return sel;
    },
    select,
    clear,
    rest,
    back: () => {
      if (!hovered()) rest();
    },
  };
}
