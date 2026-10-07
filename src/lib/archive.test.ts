import { describe, expect, it } from "vitest";
import { buildLeadFrames, buildPlaces, coverFileOf } from "./archive";

type AnySession = Parameters<typeof buildPlaces>[0][number];

/** Minimal stand-in for a content-collection entry. */
function session(
  id: string,
  data: {
    title?: string;
    location?: string;
    date?: string;
    cover?: string;
    showcase?: string[];
    images: { file: string; width: number; height: number }[];
  },
): AnySession {
  return {
    id,
    collection: "sessions",
    data: {
      title: data.title ?? id,
      date: data.date ?? "2026-01-01",
      location: data.location ?? "",
      description: "",
      showcase: data.showcase ?? [],
      cover: data.cover,
      images: data.images,
    },
  } as unknown as AnySession;
}

const wide = (file: string) => ({ file, width: 6000, height: 4000 }); // 3:2
const tall = (file: string) => ({ file, width: 4000, height: 6000 });
const pano = (file: string) => ({ file, width: 6000, height: 2000 }); // 3:1

describe("buildPlaces", () => {
  it("gives one pin per location, collecting the sessions there", () => {
    const places = buildPlaces([
      session("a", { location: "Eastern Washington", images: [wide("1.jpg")] }),
      session("b", { location: "Eastern Washington", images: [wide("2.jpg")] }),
      session("c", { location: "Shanghai, China", images: [wide("3.jpg")] }),
    ]);
    expect(places).toHaveLength(2);
    const wa = places.find((p) => p.name === "Eastern Washington")!;
    expect(wa.slugs).toEqual(["a", "b"]);
    expect(wa.region).toBe("Washington");
  });

  it("skips sessions with no location and places it cannot find", () => {
    const places = buildPlaces([
      session("a", { location: "", images: [wide("1.jpg")] }),
      session("b", { location: "Atlantis", images: [wide("2.jpg")] }),
    ]);
    expect(places).toHaveLength(0);
  });
});

describe("buildLeadFrames", () => {
  it("picks one near-3:2 frame per session when nothing is curated", () => {
    const frames = buildLeadFrames([
      session("a", {
        location: "Eastern Washington",
        images: [tall("portrait.jpg"), wide("landscape.jpg")],
      }),
    ]);
    expect(frames.map((f) => f.file)).toEqual(["landscape.jpg"]);
  });

  it("uses the curated showcase list when there is one", () => {
    const frames = buildLeadFrames([
      session("a", {
        location: "Eastern Washington",
        showcase: ["two.jpg", "three.jpg"],
        images: [wide("one.jpg"), wide("two.jpg"), wide("three.jpg")],
      }),
    ]);
    expect(frames.map((f) => f.file)).toEqual(["two.jpg", "three.jpg"]);
  });

  it("ignores curated frames that would not fit the lead box", () => {
    const frames = buildLeadFrames([
      session("a", {
        location: "Eastern Washington",
        showcase: ["portrait.jpg"],
        images: [tall("portrait.jpg"), wide("landscape.jpg")],
      }),
    ]);
    expect(frames).toHaveLength(0);
  });

  it("sits a session out when nothing is close to 3:2", () => {
    const frames = buildLeadFrames([
      session("a", {
        location: "Eastern Washington",
        images: [tall("a.jpg"), pano("b.jpg")],
      }),
    ]);
    expect(frames).toHaveLength(0);
  });

  it("deals frames out region by region so the first few show the range", () => {
    const frames = buildLeadFrames([
      session("wa1", {
        location: "Eastern Washington",
        images: [wide("wa1.jpg")],
      }),
      session("wa2", {
        location: "Puget Sound, Washington",
        images: [wide("wa2.jpg")],
      }),
      session("cr1", {
        location: "Limón Province, Costa Rica",
        images: [wide("cr1.jpg")],
      }),
    ]);
    expect(frames.map((f) => f.file)).toEqual([
      "wa1.jpg",
      "cr1.jpg",
      "wa2.jpg",
    ]);
  });
});

describe("coverFileOf", () => {
  it("prefers the chosen cover and falls back to the first photograph", () => {
    expect(
      coverFileOf(
        session("a", {
          cover: "b.jpg",
          images: [wide("a.jpg"), wide("b.jpg")],
        }),
      ),
    ).toBe("b.jpg");
    expect(coverFileOf(session("a", { images: [wide("a.jpg")] }))).toBe(
      "a.jpg",
    );
  });
});
