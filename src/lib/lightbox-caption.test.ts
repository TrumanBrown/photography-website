import { describe, expect, it } from "vitest";
import {
  atRest,
  CAPTION_EDGE,
  CAPTION_GAP,
  captionRoom,
  captionTop,
  readCaption,
  slidePadding,
  TOOLBAR,
} from "./lightbox-caption";

/** Where PhotoSwipe puts a photograph inside the padding it's given. */
function fit(
  screen: { x: number; y: number },
  photo: { x: number; y: number },
  caption: number,
) {
  const pad = slidePadding(screen, photo, caption);
  const panHeight = screen.y - pad.top - pad.bottom;
  // ZoomLevel's fit, and PanBounds' centring and rounding.
  const zoom = Math.min(1, screen.x / photo.x, panHeight / photo.y);
  const height = photo.y * zoom;
  const top = Math.round((panHeight - height) / 2) + pad.top;
  const captionAt = captionTop(top, height);
  return {
    pad,
    zoom,
    top,
    bottom: top + Math.round(height),
    captionAt,
    captionEnd: captionAt + caption,
  };
}

describe("lightbox captions", () => {
  const screens = [
    { x: 390, y: 844 }, // phone
    { x: 390, y: 643 }, // phone with the browser's bars showing
    { x: 844, y: 390 }, // phone on its side
    { x: 768, y: 1024 },
    { x: 1440, y: 900 },
  ];
  const photos = [
    { x: 6000, y: 4000 },
    { x: 4000, y: 6000 },
    { x: 3561, y: 4128 },
    { x: 4000, y: 4000 },
    { x: 6000, y: 2000 },
    { x: 800, y: 600 }, // smaller than the screen: never enlarged
  ];
  const captions = [0, 20, 46, 98, 180];
  const each = (
    check: (
      at: ReturnType<typeof fit>,
      screen: { x: number; y: number },
    ) => void,
  ) => {
    for (const screen of screens)
      for (const photo of photos)
        for (const caption of captions)
          check(fit(screen, photo, caption), screen);
  };

  it("never puts a caption on its photograph, and keeps it on screen", () => {
    each((at, screen) => {
      if (at.pad.bottom === 0) return;
      expect(at.captionAt - at.bottom).toBeGreaterThanOrEqual(CAPTION_GAP - 1);
      expect(at.captionEnd).toBeLessThanOrEqual(screen.y - CAPTION_EDGE + 1);
    });
  });

  it("sits right under the photograph, not at the foot of the screen", () => {
    const at = fit({ x: 390, y: 844 }, { x: 6000, y: 4000 }, 46);
    expect(at.captionAt - at.bottom).toBeLessThanOrEqual(CAPTION_GAP + 1);
  });

  it("keeps the toolbar off a photograph only out of spare height", () => {
    for (const screen of screens)
      for (const photo of photos)
        for (const caption of captions) {
          const at = fit(screen, photo, caption);
          const room = captionRoom(caption);
          const without = Math.min(
            1,
            screen.x / photo.x,
            (screen.y - room) / photo.y,
          );
          // Never smaller for the toolbar's sake...
          expect(at.zoom).toBeCloseTo(without, 10);
          // ...and clear of it whenever the height allows.
          if (screen.y - room - photo.y * without >= TOOLBAR)
            expect(at.top).toBeGreaterThanOrEqual(TOOLBAR);
        }
  });

  it("clears the toolbar on a phone, as the Tortuguero grasshoppers do", () => {
    const at = fit({ x: 390, y: 643 }, { x: 3561, y: 4128 }, 98);
    expect(at.top).toBeGreaterThanOrEqual(TOOLBAR);
    expect(at.captionAt).toBeGreaterThan(at.bottom);
  });

  it("keeps no room when there's nothing to say", () => {
    expect(captionRoom(0)).toBe(0);
    expect(captionRoom(45.2)).toBe(46 + CAPTION_GAP + CAPTION_EDGE);
    expect(slidePadding({ x: 390, y: 844 }, { x: 0, y: 0 }, 0)).toEqual({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    });
  });

  it("reads the caption and capture line off the gallery link", () => {
    expect(
      readCaption({ pswpCaption: " Two lubber grasshoppers ", pswpExif: "" }),
    ).toEqual({ caption: "Two lubber grasshoppers", exif: "" });
    expect(readCaption(undefined)).toEqual({ caption: "", exif: "" });
  });

  it("knows when a photograph is zoomed or dragged off its place", () => {
    const fitted = {
      currZoomLevel: 0.2,
      zoomLevels: { initial: 0.2 },
      pan: { x: 0, y: 140 },
      bounds: { center: { x: 0, y: 140 } },
    };
    expect(atRest(fitted)).toBe(true);
    expect(atRest({ ...fitted, currZoomLevel: 0.5 })).toBe(false);
    expect(atRest({ ...fitted, pan: { x: 0, y: 220 } })).toBe(false);
  });
});
