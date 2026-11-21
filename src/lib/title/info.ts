/**
 * About this photo: the "i" on the title screen and its card. A toggletip,
 * the pattern for a tip that holds a link (a tooltip can't): a round glass
 * button, and a glass card in the top layer (popover) right after it in the
 * tab order. A resting mouse opens it after 160 ms and a 240 ms bridge keeps
 * it open while the pointer crosses to the card; a click, a tap, Enter or
 * Space pins it until Escape, a press elsewhere or another press. Its link
 * opens this photo in its session.
 *
 * The markup works without script too: the button's `popovertarget` toggles
 * the card natively until this takes over.
 */
import { clamp } from "./frame";

export interface Info {
  readonly open: boolean;
  hide(instant?: boolean): void;
}

export function initInfo(
  button: HTMLButtonElement,
  card: HTMLElement,
  o: { reduced: () => boolean; onPlace: (card: HTMLElement) => void },
): Info {
  // From here on this file decides when the card shows.
  button.removeAttribute("popovertarget");
  const canPop = typeof card.showPopover === "function";
  if (!canPop) {
    card.removeAttribute("popover");
    card.hidden = true;
  }
  let open = false;
  let pinned = false;
  let tIn = 0;
  let tOut = 0;
  let anim: Animation | null = null;

  function position(): void {
    const r = button.getBoundingClientRect();
    const vw = innerWidth;
    const vh = innerHeight;
    const m = 12;
    const gap = 8;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const right = r.left + r.width / 2 > vw / 2;
    const below = r.top + r.height / 2 < vh / 2;
    const x = clamp(right ? r.right - w : r.left, m, vw - w - m);
    const y = clamp(below ? r.bottom + gap : r.top - gap - h, m, vh - h - m);
    card.style.left = `${Math.round(x)}px`;
    card.style.top = `${Math.round(y)}px`;
    // It grows out of the corner nearest the button.
    card.style.transformOrigin = `${right ? "100%" : "0%"} ${below ? "0%" : "100%"}`;
    card.dataset.side = below ? "below" : "above";
    o.onPlace(card);
  }
  function show(how: "hover" | "pin"): void {
    window.clearTimeout(tIn);
    window.clearTimeout(tOut);
    if (how === "pin") pinned = true;
    if (open) return;
    open = true;
    if (canPop) card.showPopover();
    else card.hidden = false;
    position();
    button.setAttribute("aria-expanded", "true");
    button.classList.add("is-open");
    anim?.cancel();
    anim = o.reduced()
      ? null
      : card.animate(
          [
            {
              opacity: 0,
              transform: `translateY(${card.dataset.side === "below" ? -4 : 4}px) scale(0.96)`,
            },
            { opacity: 1, transform: "none" },
          ],
          { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
  }
  function hide(instant = false): void {
    window.clearTimeout(tIn);
    window.clearTimeout(tOut);
    pinned = false;
    if (!open) return;
    open = false;
    button.setAttribute("aria-expanded", "false");
    button.classList.remove("is-open");
    const done = () => {
      if (open) return;
      if (canPop) {
        try {
          card.hidePopover();
        } catch {
          // Already closed.
        }
      } else card.hidden = true;
    };
    anim?.cancel();
    if (instant || o.reduced()) {
      done();
      return;
    }
    anim = card.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 120,
      easing: "linear",
    });
    anim.onfinish = done;
  }
  function leave(e: PointerEvent): void {
    if (e.pointerType !== "mouse") return;
    window.clearTimeout(tIn);
    if (open && !pinned) tOut = window.setTimeout(() => hide(), 240);
  }
  button.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "mouse") return;
    window.clearTimeout(tOut);
    if (!open) tIn = window.setTimeout(() => show("hover"), 160);
  });
  button.addEventListener("pointerleave", leave);
  card.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse") window.clearTimeout(tOut);
  });
  card.addEventListener("pointerleave", leave);
  button.addEventListener("click", () => {
    if (open && pinned) hide();
    else show("pin");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !open) return;
    const inside = card.contains(document.activeElement);
    hide(true);
    if (inside || document.activeElement === button) button.focus();
  });
  // A press anywhere else closes it (the light dismiss a popover="auto" would
  // give, kept manual so hovering in and out doesn't fight the browser's own
  // toggling).
  document.addEventListener(
    "pointerdown",
    (e) => {
      const t = e.target as Node;
      if (open && !button.contains(t) && !card.contains(t)) hide();
    },
    true,
  );
  card.addEventListener("focusout", (e) => {
    const to = e.relatedTarget as Node | null;
    if (open && !card.contains(to) && to !== button) hide();
  });
  window.addEventListener("resize", () => {
    if (open) position();
  });
  return {
    get open() {
      return open;
    },
    hide,
  };
}
