import type PhotoSwipeLightbox from "photoswipe/lightbox";

/**
 * Lightbox captions go under the photograph and never on it, on any screen.
 *
 * Each slide keeps room at the bottom for its own caption: PhotoSwipe fits
 * the photograph into the space above it (the `paddingFn` option), and the
 * caption sits in the slide just under the photograph, so it moves with the
 * photograph when you swipe. It's the slide's first child, so a photograph
 * zoomed or dragged over it covers the caption rather than the reverse, and
 * the caption fades out until the photograph is back in place.
 *
 * Making that room lifts the photograph, so where there's height to spare
 * the toolbar gets room at the top too, and the photograph doesn't slide up
 * under it. That room only ever comes out of spare height: the photograph is
 * never made smaller for it.
 */

/** Space between a photograph and its caption, px. */
export const CAPTION_GAP = 12;
/** Space under the caption, to the bottom of the screen, px. */
export const CAPTION_EDGE = 16;
/** Height of PhotoSwipe's toolbar (.pswp__top-bar), px. */
export const TOOLBAR = 60;

export interface CaptionText {
  caption: string;
  exif: string;
}

interface Point {
  x: number;
  y: number;
}

/** A gallery link's caption and capture line (data-pswp-caption, data-pswp-exif). */
export function readCaption(data: DOMStringMap | undefined): CaptionText {
  return {
    caption: data?.pswpCaption?.trim() ?? "",
    exif: data?.pswpExif?.trim() ?? "",
  };
}

/**
 * Room to keep under a photograph whose caption is `height` px tall: the
 * caption, the gap above it and the margin below it. None without a caption.
 */
export function captionRoom(height: number): number {
  return height > 0 ? Math.ceil(height) + CAPTION_GAP + CAPTION_EDGE : 0;
}

/**
 * Padding for PhotoSwipe to fit a `photo` (its width and height, px) on a
 * `screen` in: the caption's room at the bottom, and as much of the
 * toolbar's height at the top as the fitted photograph leaves spare.
 */
export function slidePadding(screen: Point, photo: Point, caption: number) {
  const bottom = captionRoom(caption);
  let top = 0;
  if (photo.x > 0 && photo.y > 0) {
    // PhotoSwipe's fit, which never enlarges a photograph past its own size.
    const zoom = Math.min(1, screen.x / photo.x, (screen.y - bottom) / photo.y);
    const spare = screen.y - bottom - photo.y * zoom;
    top = Math.max(0, Math.min(TOOLBAR, Math.floor(spare)));
  }
  return { top, bottom, left: 0, right: 0 };
}

/** Top of a caption under a photograph whose top and height are given, px. */
export function captionTop(photoTop: number, photoHeight: number): number {
  return photoTop + photoHeight + CAPTION_GAP;
}

/** The parts of a PhotoSwipe slide read here. */
interface Slide {
  data: { element?: HTMLElement };
  holderElement: HTMLElement | null;
  height: number;
  zoomLevels: { initial: number };
  currZoomLevel: number;
  pan: Point;
  bounds: { center: Point };
}

/** Whether a photograph is where it was fitted: not zoomed in, not dragged. */
export function atRest(
  slide: Pick<Slide, "currZoomLevel" | "zoomLevels" | "pan" | "bounds">,
): boolean {
  return (
    Math.abs(slide.currZoomLevel - slide.zoomLevels.initial) < 0.001 &&
    Math.abs(slide.pan.y - slide.bounds.center.y) < 1
  );
}

/** Fill a caption with text nodes only, so a caption can never inject markup. */
function fillCaption(el: HTMLElement, text: CaptionText): void {
  el.replaceChildren();
  if (text.caption) {
    const line = document.createElement("span");
    line.className = "pswp__caption-text";
    line.textContent = text.caption;
    el.append(line);
  }
  if (text.exif) {
    const line = document.createElement("span");
    line.className = "pswp__caption-exif";
    line.textContent = text.exif;
    el.append(line);
  }
}

/**
 * Captions for a PhotoSwipe lightbox. Give `padding` to the lightbox as its
 * `paddingFn` option, and call `attach(lightbox)` before `lightbox.init()`.
 */
export function lightboxCaptions() {
  /** Caption heights by slide and screen width. */
  const heights = new Map<string, number>();
  const placed = new WeakMap<Slide, HTMLElement>();

  function measure(text: CaptionText, key: string): number {
    if (!text.caption && !text.exif) return 0;
    let height = heights.get(key);
    if (height === undefined) {
      // Laid out off screen at the width a caption gets in the slide.
      const ruler = document.createElement("div");
      ruler.className = "pswp__caption pswp__caption--ruler";
      ruler.setAttribute("aria-hidden", "true");
      fillCaption(ruler, text);
      document.body.append(ruler);
      height = ruler.getBoundingClientRect().height;
      ruler.remove();
      heights.set(key, height);
    }
    return height;
  }

  function padding(
    viewport: Point,
    data: { element?: HTMLElement; width?: number; height?: number },
    index: number,
  ) {
    const text = readCaption(data.element?.dataset);
    const caption = measure(text, `${index} ${viewport.x}`);
    return slidePadding(
      viewport,
      { x: Number(data.width) || 0, y: Number(data.height) || 0 },
      caption,
    );
  }

  /** Put a slide's caption under its photograph as fitted. */
  function place(slide: Slide): HTMLElement | undefined {
    let el = placed.get(slide);
    if (!el) {
      const text = readCaption(slide.data.element?.dataset);
      if (!text.caption && !text.exif) return undefined;
      el = document.createElement("div");
      el.className = "pswp__caption";
      fillCaption(el, text);
      placed.set(slide, el);
    }
    if (slide.holderElement && el.parentElement !== slide.holderElement) {
      slide.holderElement.prepend(el);
    }
    const photoHeight = slide.height * slide.zoomLevels.initial;
    el.style.top = `${captionTop(slide.bounds.center.y, photoHeight)}px`;
    return el;
  }

  function attach(lightbox: PhotoSwipeLightbox): void {
    // Each time PhotoSwipe fits a slide: opening, swiping, resizing.
    lightbox.on("initialZoomPan", ({ slide }) => {
      place(slide);
    });
    lightbox.on("zoomPanUpdate", ({ slide }) => {
      const rest = atRest(slide);
      const el = rest ? place(slide) : placed.get(slide);
      el?.classList.toggle("pswp__caption--away", !rest);
    });
    // A slide swiped away is put back as it was fitted.
    lightbox.on("slideDeactivate", ({ slide }) => {
      placed.get(slide)?.classList.remove("pswp__caption--away");
    });
    lightbox.on("slideDestroy", ({ slide }) => {
      placed.get(slide)?.remove();
      placed.delete(slide);
    });
  }

  return { padding, attach };
}
