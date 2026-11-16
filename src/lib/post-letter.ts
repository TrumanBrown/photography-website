/**
 * Posting the letter. When a message is sent from "Write to me", the message
 * box turns into a sheet of paper with what was written on it, folds twice
 * into an envelope, takes the round postmark the hiking postcard uses, and
 * slides out of the drawer. Flat ink and paper: a fold is a flap turning over
 * its crease seen straight on, so it narrows to an edge and opens out on the
 * other side, with no perspective, gloss or shading.
 *
 * The motion is pure (foldAt and foldFrames, pressFrames, aimPost, leaveAt
 * and leaveFrames, and the shared stampLandFrames from motion.ts) and
 * postLetter is the thin driver: it puts the paper together over the message
 * box and plays the keyframes with the Web Animations API. The caller skips
 * all of it under reduced motion and shows the thank-you line at once. The
 * paper's look is in ContactForm.astro.
 */

import { STAMP_LAND_MS, stampLandFrames } from "./motion";
import { POSTMARK_RADIUS, postmarkCentre } from "./postmark";

/** Each of the two folds, ms. */
export const FOLD_MS = 160;
/** When the postmark starts down, ms after the paper appears. */
export const STAMP_AT = 2 * FOLD_MS;
/** When it hits the paper: stampLandFrames lands halfway through. */
export const LANDS_AT = STAMP_AT + STAMP_LAND_MS / 2;
/** How long the envelope gives under the postmark, ms. */
export const PRESS_MS = 140;
/** When the envelope starts out of the drawer, and the thank-you line shows. */
export const LEAVE_AT = LANDS_AT + 50;
/** How long it takes to leave, ms. */
export const LEAVE_MS = 280;
/** The whole thing, ms. */
export const POST_MS = LEAVE_AT + LEAVE_MS;

/** The postmark's ring radius on the envelope, CSS px. */
const MARK_R = 30;
/** How far the paper reaches past the message box, so its words stay put.
 *  Little at the top and bottom, to keep clear of the label and the count. */
const PAD_X = 12;
const PAD_TOP = 3;
const PAD_BOTTOM = 6;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * How far over a flap is, `t` (0 to 1) through its fold, as the signed length
 * it shows: 1 flat where it started, 0 on edge over the crease, -1 flat on the
 * other side. A flat turn seen from above, eased in and out like a hand.
 */
export function foldAt(t: number): number {
  const k = clamp01(t);
  const eased = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
  return Math.cos(Math.PI * eased);
}

/**
 * Keyframes for one side of a flap over half a fold each: the front narrows
 * onto the crease in the first half, the back opens out from it in the second.
 * Scale only, from an origin on the crease.
 */
export function foldFrames(
  axis: "x" | "y",
  side: "front" | "back",
  steps = 8,
): Keyframe[] {
  const scale = axis === "x" ? "scaleX" : "scaleY";
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (side === "front" ? 0 : 0.5) + (i / steps) * 0.5;
    frames.push({
      offset: i / steps,
      transform: `${scale}(${round(Math.abs(foldAt(t)))})`,
    });
  }
  return frames;
}

/** The envelope giving a pixel under the postmark, then back. */
export function pressFrames(): Keyframe[] {
  return [
    { offset: 0, transform: "translateY(0px) scale(1)" },
    {
      offset: 0.3,
      transform: "translateY(1px) scale(0.985)",
      easing: "cubic-bezier(0.2, 0, 0.2, 1)",
    },
    { offset: 1, transform: "translateY(0px) scale(1)" },
  ];
}

export interface Leave {
  /** px to the right, enough to clear the drawer's edge. */
  distance: number;
  /** px it rises as it goes. */
  lift: number;
  /** Degrees it turns by the time it's out (negative tips the front up). */
  turn: number;
}

/**
 * What changes from one letter to the next: the postmark's tilt, and how far
 * the envelope rises and turns on its way out over `distance` px.
 */
export function aimPost(
  distance: number,
  random: () => number = Math.random,
): { tilt: number; leave: Leave } {
  const tilt = -12 + random() * 6;
  return {
    tilt,
    leave: {
      distance,
      lift: 4 + random() * 6,
      turn: -1.5 - random() * 2.5,
    },
  };
}

/**
 * Where the envelope is `t` (0 to 1) through leaving: it starts slow and
 * picks up speed to the right, like a hand pushing it through a slot, rising
 * a little early on and turning as it goes.
 */
export function leaveAt(
  t: number,
  leave: Leave,
): { x: number; y: number; turn: number } {
  const k = clamp01(t);
  return {
    x: leave.distance * Math.pow(k, 2.2),
    y: -leave.lift * Math.sin((Math.min(1, k * 1.6) * Math.PI) / 2),
    turn: leave.turn * k,
  };
}

export function leaveFrames(leave: Leave, steps = 10): Keyframe[] {
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const at = leaveAt(i / steps, leave);
    frames.push({
      offset: i / steps,
      transform: `translate(${round(at.x)}px, ${round(at.y)}px) rotate(${round(at.turn)}deg)`,
    });
  }
  return frames;
}

export interface PostOptions {
  /** The message box the paper lifts off. */
  field: HTMLTextAreaElement;
  /** Where the paper goes: a positioned ancestor of the field. */
  host: HTMLElement;
  /** What it leaves through: the drawer, whose right edge is the way out. */
  exit: HTMLElement;
  /** The postmark, drawn by makePostmark. */
  mark: HTMLCanvasElement;
  random?: () => number;
}

export interface Posting {
  /** Resolves as the envelope starts out of the drawer. */
  leaving: Promise<void>;
  /** Resolves once it's gone and the paper is taken away. */
  done: Promise<void>;
  /** Jump to the end, as when the drawer closes partway. */
  finish(): void;
}

type Edge = "t" | "r" | "b" | "l";

function piece(
  x: number,
  y: number,
  w: number,
  h: number,
  edges: Edge[],
  origin: string,
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "post-piece";
  el.dataset.edges = edges.join("");
  Object.assign(el.style, {
    left: `${x}px`,
    top: `${y}px`,
    width: `${w}px`,
    height: `${h}px`,
    transformOrigin: origin,
  });
  return el;
}

/** The message as it reads in the box, for a face of the paper. */
function words(field: HTMLTextAreaElement, offsetY: number): HTMLDivElement {
  const style = getComputedStyle(field);
  const text = document.createElement("div");
  text.className = "post-words";
  text.textContent = field.value;
  Object.assign(text.style, {
    left: `${PAD_X + field.clientLeft + parseFloat(style.paddingLeft)}px`,
    top: `${PAD_TOP + field.clientTop + parseFloat(style.paddingTop) - field.scrollTop - offsetY}px`,
    width: `${field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)}px`,
    font: style.font,
    letterSpacing: style.letterSpacing,
  });
  return text;
}

const ENVELOPE_SVG =
  '<svg class="post-flap" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
  '<polyline points="0,0 50,58 100,0" vector-effect="non-scaling-stroke"/></svg>';

export function postLetter(options: PostOptions): Posting {
  const { field, host, exit, mark } = options;
  const box = field.getBoundingClientRect();
  const at = host.getBoundingClientRect();

  // Even sizes, so each half lands on whole pixels.
  const w = 2 * Math.round((box.width + PAD_X * 2) / 2);
  const h = 2 * Math.round((box.height + PAD_TOP + PAD_BOTTOM) / 2);
  const left = Math.round(box.left - at.left - PAD_X);
  const top = Math.round(box.top - at.top - PAD_TOP);
  const hw = w / 2;
  const hh = h / 2;

  const root = document.createElement("div");
  root.className = "post";
  root.setAttribute("aria-hidden", "true");
  Object.assign(root.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${w}px`,
    height: `${h}px`,
    transformOrigin: `${hw / 2}px ${hh / 2}px`,
  });
  const paper = document.createElement("div");
  paper.className = "post-paper";
  paper.style.transformOrigin = `${hw / 2}px ${hh / 2}px`;
  root.append(paper);

  // The sheet: its top half stays, its bottom half folds up over it.
  const sheetTop = piece(0, 0, w, hh, ["t", "r", "l"], "50% 100%");
  sheetTop.append(words(field, 0));
  const sheetBottom = piece(0, hh, w, hh, ["r", "b", "l"], "50% 0%");
  sheetBottom.append(words(field, hh));
  // The back of the bottom half, coming up over the top half: one piece,
  // in two halves so its right half can fold again.
  const backLeft = piece(0, 0, hw, hh, ["t", "b", "l"], "50% 100%");
  // Its origin works for both folds: the bottom edge for the first, the
  // left edge for the second.
  const backRight = piece(hw, 0, hw, hh, ["t", "r", "b"], "0% 100%");
  // The right half's other side, coming down on the left half: the envelope.
  const envelope = piece(0, 0, hw, hh, ["t", "r", "b", "l"], "100% 50%");
  envelope.classList.add("post-envelope");
  envelope.insertAdjacentHTML("beforeend", ENVELOPE_SVG);
  paper.append(sheetTop, sheetBottom, backLeft, backRight, envelope);

  const { tilt, leave } = aimPost(
    Math.ceil(exit.getBoundingClientRect().right - (at.left + left)) + 24,
    options.random,
  );

  // The postmark, ring near the top right corner of the envelope.
  const scale = MARK_R / POSTMARK_RADIUS;
  const centre = postmarkCentre(mark);
  mark.className = "post-mark";
  Object.assign(mark.style, {
    width: `${mark.width * scale}px`,
    left: `${Math.round(hw - MARK_R - 6 - centre.x * scale)}px`,
    top: `${Math.round(MARK_R + 4 - centre.y * scale)}px`,
    transformOrigin: `${(centre.x / mark.width) * 100}% 50%`,
    transform: `rotate(${tilt}deg)`,
  });
  envelope.append(mark);
  host.append(root);

  const half = FOLD_MS / 2;
  const anims: Animation[] = [];
  const play = (
    el: Element,
    frames: Keyframe[],
    timing: KeyframeAnimationOptions,
  ): Animation => {
    const run = el.animate(frames, timing);
    anims.push(run);
    return run;
  };
  const hideAt = (el: Element, ms: number) =>
    play(el, [{ visibility: "visible" }, { visibility: "hidden" }], {
      duration: 1,
      delay: ms - 1,
      fill: "forwards",
    });

  // Fold one: the bottom half up over the top.
  play(sheetBottom, foldFrames("y", "front"), {
    duration: half,
    fill: "forwards",
  });
  for (const back of [backLeft, backRight]) {
    play(back, foldFrames("y", "back"), {
      duration: half,
      delay: half,
      fill: "both",
    });
  }
  hideAt(sheetTop, FOLD_MS);
  hideAt(sheetBottom, FOLD_MS);
  // Fold two: the right half over the left, and it's an envelope.
  play(backRight, foldFrames("x", "front"), {
    duration: half,
    delay: FOLD_MS,
    fill: "forwards",
  });
  play(envelope, foldFrames("x", "back"), {
    duration: half,
    delay: FOLD_MS + half,
    fill: "both",
  });
  hideAt(backRight, 2 * FOLD_MS);
  // The postmark slams on, the envelope gives under it, and out it goes.
  play(mark, stampLandFrames(tilt), {
    duration: STAMP_LAND_MS,
    delay: STAMP_AT,
    fill: "both",
  });
  play(paper, pressFrames(), { duration: PRESS_MS, delay: LANDS_AT });
  play(root, leaveFrames(leave), {
    duration: LEAVE_MS,
    delay: LEAVE_AT,
    fill: "forwards",
  });

  // A keyframe-less animation as the clock for the thank-you line, so it
  // keeps time with the rest (and finish() brings it forward with them).
  const clock = play(root, [], { duration: LEAVE_AT });
  const leaving = clock.finished.then(
    () => undefined,
    () => undefined,
  );
  const cleanup = () => root.remove();
  const done = Promise.all(anims.map((run) => run.finished)).then(
    cleanup,
    cleanup,
  );

  return {
    leaving,
    done,
    finish() {
      for (const run of anims) {
        try {
          run.finish();
        } catch {
          run.cancel();
        }
      }
    },
  };
}
