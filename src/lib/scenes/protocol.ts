import type { HeldFrame, LandingNote, Reveal } from "../landing";

/**
 * Messages between the page and the scene worker (worker.ts, player.ts).
 * Times are ms; sizes CSS px.
 */

export interface View {
  w: number;
  h: number;
  /** Device pixels per CSS px, at most 2. */
  dpr: number;
}

/** A card to get ready ahead of a click on it. */
export interface WarmRequest {
  slug: string;
  card: string;
  mini?: string;
  dark: boolean;
  /**
   * Where the card is and the viewport, when a click on it is likely (it's
   * pointed at, focused or pressed): its scene is set up once beforehand.
   */
  rehearse?: { rect: [number, number, number, number]; view: View };
}

export interface PlayRequest {
  slug: string;
  /** The card plate to draw the scene from, and a home-page card's mini plate. */
  card: string;
  mini?: string;
  /** The hobby page's path, for the data carried there. */
  path: string;
  /** Where the card's plate is on screen: left, top, width, height. */
  rect: [number, number, number, number];
  /** The viewport the scene is laid out in. */
  w: number;
  h: number;
  view: View;
  red: string;
  paper: string;
  dark: boolean;
  seed: number;
  /**
   * Date.now() by which the plates have to be in. It runs from the click,
   * not from when the worker gets to it, so a worker that's still starting
   * up never makes the click wait longer than the page will.
   */
  until: number;
}

export interface ResumeRequest {
  slug: string;
  note: LandingNote;
  /** The data the last page carried here, as it was stored. */
  carried: string | null;
  view: View;
  red: string;
  paper: string;
}

export type ToWorker =
  | { type: "init"; canvas: OffscreenCanvas; software: boolean; gl: boolean }
  | ({ type: "warm" } & WarmRequest)
  | ({ type: "play" } & PlayRequest)
  | ({ type: "resume" } & ResumeRequest)
  | { type: "hurry" }
  | { type: "stop" }
  | { type: "uncovered" }
  | { type: "view"; view: View }
  | {
      type: "label";
      key: string;
      art: { image: ImageBitmap; w: number; h: number } | null;
    };

/** The scene has reached the hold and the page should change. */
export interface LeaveMessage {
  type: "leave";
  at: number;
  t: number;
  /** The frame it left on, for the next page to paint first. */
  frame: HeldFrame;
  w: number;
  h: number;
  rect: [number, number, number, number];
  speed: number;
  hold: number;
  zoom: number;
  ink: string;
  /** The plate it was drawn from. */
  plate: string;
  /** The plate's dots and the props, as the next page takes them. */
  carry: string;
}

/** A scene that ends on big dots (the globe) has ended. */
export interface FinalMessage {
  type: "final";
  dots: number[];
  w: number;
  h: number;
  reveal: Reveal;
  ink: string;
}

export type FromWorker =
  | { type: "ready"; ok: boolean; gl: boolean; url: string }
  | { type: "started" }
  /** It has the clicked card's plate and is setting the scene up. */
  | { type: "setting" }
  | LeaveMessage
  | FinalMessage
  | { type: "shown" }
  | { type: "look"; opacity: number; blur: number }
  | { type: "done" }
  | { type: "failed" }
  | { type: "label"; key: string; text: string; color: string; dpr: number };
