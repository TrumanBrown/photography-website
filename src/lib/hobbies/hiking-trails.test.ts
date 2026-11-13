import { describe, expect, it, vi } from "vitest";
import type { CollectionEntry } from "astro:content";
import { trailCards, trailStats } from "./hiking-trails";

type Session = CollectionEntry<"sessions">;

function session(slug: string, date: string, cover?: string): Session {
  return {
    id: `${slug}.json`,
    data: {
      title: `${slug} Peak, Washington, June 2026`,
      date,
      cover,
      images: [
        {
          file: "marmot.jpg",
          width: 6192,
          height: 4128,
          caption: "Hoary marmot",
        },
        {
          file: "tarn.jpg",
          width: 6192,
          height: 4128,
          caption: "A tarn below rocky peaks",
          alt: "A blue tarn below rocky peaks under a clear sky",
        },
      ],
    },
  } as unknown as Session;
}

const sessions = [
  session("gunn", "2026-06-13", "tarn.jpg"),
  session("baker", "2026-10-03"),
  session("valhalla", "2025-11-08", "tarn.jpg"),
];

describe("trailCards", () => {
  it("lists the hikes newest first, whatever order the JSON has", () => {
    const cards = trailCards(
      [{ session: "valhalla" }, { session: "baker" }, { session: "gunn" }],
      sessions,
    );
    expect(cards.map((c) => c.slug)).toEqual(["baker", "gunn", "valhalla"]);
    expect(cards[1]).toMatchObject({
      place: "gunn Peak, Washington",
      date: "2026-06-13",
      dateText: "June 13, 2026",
    });
  });

  it("leaves out a hike whose session isn't in the build, and says so once", () => {
    const warn = vi.fn();
    const cards = trailCards(
      [{ session: "gunn" }, { session: "renamed" }, { session: "gone" }],
      sessions,
      warn,
    );
    expect(cards.map((c) => c.slug)).toEqual(["gunn"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("renamed, gone");
  });

  it("shows the cover unless the hike names another photo from the session", () => {
    const warn = vi.fn();
    const [gunn, baker, valhalla] = [
      ...trailCards([{ session: "gunn" }], sessions, warn),
      ...trailCards([{ session: "baker" }], sessions, warn),
      ...trailCards(
        [{ session: "valhalla", photo: "missing.jpg" }],
        sessions,
        warn,
      ),
    ];
    expect(gunn).toMatchObject({
      file: "tarn.jpg",
      alt: "A blue tarn below rocky peaks under a clear sky",
    });
    // No cover set: the first photograph, the same frame its session card shows.
    expect(baker.file).toBe("marmot.jpg");
    expect(valhalla.file).toBe("tarn.jpg");
    expect(warn).toHaveBeenCalledTimes(1);

    const [picked] = trailCards(
      [{ session: "gunn", photo: "marmot.jpg" }],
      sessions,
    );
    expect(picked).toMatchObject({ file: "marmot.jpg", alt: "Hoary marmot" });
  });
});

describe("miles and gain", () => {
  it("never shows a figure that wasn't given", () => {
    const [card] = trailCards([{ session: "gunn" }], sessions);
    expect(card.stats).toBe("");
    expect(trailStats({})).toBe("");
  });

  it("shows exactly the numbers given", () => {
    expect(trailStats({ miles: 9.5, gainFt: 4300 })).toBe(
      "9.5 mi · 4,300 ft gain",
    );
    expect(trailStats({ miles: 12 })).toBe("12 mi");
    expect(trailStats({ gainFt: 2550 })).toBe("2,550 ft gain");
  });
});
