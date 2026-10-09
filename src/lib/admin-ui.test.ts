import { describe, it, expect } from "vitest";
import {
  clampPanelSize,
  clampTileSize,
  defaultPanelSize,
  draftFromSession,
  draftSignature,
  filterSessions,
  fitsBanner,
  fitsLeadBox,
  fullPanelSize,
  imagesPayload,
  isDirty,
  isEditorMode,
  matchesQuery,
  needsWork,
  previewUrl,
  ratioLabel,
  sessionFlags,
  sortSessions,
  thumbUrl,
  type AdminSession,
} from "./admin-ui";

function mk(partial: Partial<AdminSession> = {}): AdminSession {
  return {
    slug: "costa-rica-2026",
    thumbSlug: "costa-rica-2026",
    title: "El Zota Biological Station, Costa Rica, September 2026",
    date: "2026-09-12",
    location: "Limón Province, Costa Rica",
    description: "Lowland Caribbean rainforest.",
    cover: "DSC001.JPG",
    banner: "",
    order: null,
    images: ["DSC001.JPG", "DSC002.JPG", "DSC003.JPG"],
    captions: { "DSC001.JPG": "A red-eyed tree frog" },
    ratios: { "DSC001.JPG": 1.5, "DSC002.JPG": 0.667, "DSC003.JPG": 1.33 },
    showcase: [],
    urls: {},
    ...partial,
  };
}

describe("frame eligibility", () => {
  it("only lets 3:2 horizontals into the lead box", () => {
    const session = mk();
    expect(fitsLeadBox(session, "DSC001.JPG")).toBe(true);
    expect(fitsLeadBox(session, "DSC002.JPG")).toBe(false);
    expect(fitsLeadBox(session, "DSC003.JPG")).toBe(false);
  });

  it("lets anything landscape survive the header crop", () => {
    const session = mk();
    expect(fitsBanner(session, "DSC001.JPG")).toBe(true);
    expect(fitsBanner(session, "DSC003.JPG")).toBe(true);
    expect(fitsBanner(session, "DSC002.JPG")).toBe(false);
  });

  it("treats an unknown shape as usable rather than blocking the admin", () => {
    const session = mk({ ratios: {} });
    expect(fitsLeadBox(session, "DSC002.JPG")).toBe(true);
    expect(fitsBanner(session, "DSC002.JPG")).toBe(true);
  });
});

describe("ratioLabel", () => {
  it("names the common shapes", () => {
    expect(ratioLabel(1.5)).toBe("3:2");
    expect(ratioLabel(0.667)).toBe("2:3");
    expect(ratioLabel(1.3333)).toBe("4:3");
    expect(ratioLabel(1)).toBe("1:1");
  });

  it("falls back to a decimal for anything unusual", () => {
    expect(ratioLabel(2.39)).toBe("2.39:1");
    expect(ratioLabel(0.3)).toBe("1:3.33");
  });

  it("says nothing when the shape is unknown", () => {
    expect(ratioLabel(undefined)).toBe("");
    expect(ratioLabel(0)).toBe("");
  });
});

describe("session flags", () => {
  it("counts captions, rotation picks, and lead candidates", () => {
    const flags = sessionFlags(mk({ showcase: ["DSC001.JPG", "gone.jpg"] }));
    expect(flags.total).toBe(3);
    expect(flags.captioned).toBe(1);
    expect(flags.hasDescription).toBe(true);
    expect(flags.hasCover).toBe(true);
    expect(flags.hasBanner).toBe(false);
    expect(flags.inRotation).toBe(1);
    expect(flags.leadCandidates).toBe(1);
  });

  it("calls a session unfinished while anything the site leans on is missing", () => {
    expect(needsWork(mk())).toBe(true);
    const done = mk({
      captions: {
        "DSC001.JPG": "one",
        "DSC002.JPG": "two",
        "DSC003.JPG": "three",
      },
    });
    expect(needsWork(done)).toBe(false);
    expect(needsWork({ ...done, description: "" })).toBe(true);
    expect(needsWork({ ...done, cover: "" })).toBe(true);
  });
});

describe("searching and filtering", () => {
  const costaRica = mk();
  const washington = mk({
    slug: "gunn-peak-2026",
    thumbSlug: "gunn-peak-2026",
    title: "Gunn Peak, Washington, June 2026",
    date: "2026-06-02",
    location: "Washington",
    description: "",
    cover: "",
    images: ["A.JPG"],
    captions: { "A.JPG": "Summit" },
    ratios: { "A.JPG": 1.5 },
    showcase: ["A.JPG"],
  });

  it("matches every term against title, slug, place, and date", () => {
    expect(matchesQuery(costaRica, "costa rica")).toBe(true);
    expect(matchesQuery(costaRica, "limon")).toBe(false);
    expect(matchesQuery(costaRica, "2026-09")).toBe(true);
    expect(matchesQuery(costaRica, "zota washington")).toBe(false);
    expect(matchesQuery(costaRica, "   ")).toBe(true);
  });

  it("narrows to unfinished sessions", () => {
    const list = filterSessions([costaRica, washington], {
      filter: "needs-work",
    });
    expect(list.map((s) => s.slug)).toEqual(["costa-rica-2026", "gunn-peak-2026"]);
  });

  it("narrows to sessions with a curated rotation", () => {
    const list = filterSessions([costaRica, washington], { filter: "rotation" });
    expect(list.map((s) => s.slug)).toEqual(["gunn-peak-2026"]);
  });

  it("narrows to sessions still missing captions", () => {
    const list = filterSessions([costaRica, washington], {
      filter: "uncaptioned",
    });
    expect(list.map((s) => s.slug)).toEqual(["costa-rica-2026"]);
  });

  it("keeps the public site's order: explicit first, then newest", () => {
    const pinned = mk({ slug: "pinned", order: 0, date: "2020-01-01" });
    const sorted = sortSessions([costaRica, washington, pinned]);
    expect(sorted.map((s) => s.slug)).toEqual([
      "pinned",
      "costa-rica-2026",
      "gunn-peak-2026",
    ]);
  });
});

describe("image URLs", () => {
  it("points at the pre-generated admin thumbnail", () => {
    expect(thumbUrl("acct.blob.core.windows.net", "costa-rica", "DSC001.JPG")).toBe(
      "https://acct.blob.core.windows.net/variants/thumbs/costa-rica/DSC001.jpg",
    );
  });

  it("escapes names with spaces", () => {
    expect(thumbUrl("host", "a slug", "two frogs.JPG")).toBe(
      "https://host/variants/thumbs/a%20slug/two%20frogs.jpg",
    );
  });

  it("prefers the full-size URL for the preview and falls back to the thumb", () => {
    const session = mk({ urls: { "DSC001.JPG": "https://host/originals/s/DSC001.JPG" } });
    expect(previewUrl(session, "DSC001.JPG", "host")).toBe(
      "https://host/originals/s/DSC001.JPG",
    );
    expect(previewUrl(session, "DSC002.JPG", "host")).toBe(
      "https://host/variants/thumbs/costa-rica-2026/DSC002.jpg",
    );
  });
});

describe("panel and tile sizing", () => {
  it("keeps a remembered size inside the screen it is reopened on", () => {
    expect(clampPanelSize({ width: 4000, height: 3000 }, { width: 1280, height: 800 })).toEqual({
      width: 1256,
      height: 776,
    });
    expect(clampPanelSize({ width: 10, height: 10 }, { width: 1280, height: 800 })).toEqual({
      width: 420,
      height: 380,
    });
  });

  it("lets a phone screen win over the comfortable minimum", () => {
    const size = clampPanelSize({ width: 1200, height: 900 }, { width: 390, height: 700 });
    expect(size.width).toBe(366);
    expect(size.height).toBe(676);
  });

  it("opens wide but not wider than a big monitor needs", () => {
    expect(defaultPanelSize({ width: 2560, height: 1440 }).width).toBe(1400);
    expect(defaultPanelSize({ width: 1280, height: 800 })).toEqual({
      width: 1203,
      height: 736,
    });
    expect(fullPanelSize({ width: 1280, height: 800 })).toEqual({
      width: 1256,
      height: 776,
    });
  });

  it("holds tile sizes between the slider's ends", () => {
    expect(clampTileSize(40)).toBe(120);
    expect(clampTileSize(900)).toBe(420);
    expect(clampTileSize(Number.NaN)).toBe(200);
    expect(clampTileSize(201.4)).toBe(201);
  });
});

describe("the draft an edit works on", () => {
  it("drops rotation picks for photographs that are no longer there", () => {
    const draft = draftFromSession(mk({ showcase: ["DSC001.JPG", "gone.jpg"] }));
    expect(draft.showcase).toEqual(["DSC001.JPG"]);
  });

  it("ignores pick order and whitespace when deciding something changed", () => {
    const original = draftFromSession(mk({ showcase: ["DSC001.JPG"] }));
    const reordered = {
      ...original,
      showcase: ["DSC001.JPG"],
      title: `${original.title}  `,
    };
    expect(isDirty(original, reordered)).toBe(false);
    expect(isDirty(original, { ...original, cover: "DSC002.JPG" })).toBe(true);
    expect(
      isDirty(original, {
        ...original,
        captions: { ...original.captions, "DSC002.JPG": "A fer-de-lance" },
      }),
    ).toBe(true);
  });

  it("treats an emptied caption as no caption", () => {
    const original = draftFromSession(mk());
    const blanked = { ...original, captions: { "DSC001.JPG": "A red-eyed tree frog" } };
    expect(draftSignature(original)).toBe(draftSignature(blanked));
    expect(isDirty(original, { ...original, captions: {} })).toBe(true);
  });

  it("sends a caption slot for every photograph, in session order", () => {
    const session = mk();
    expect(imagesPayload(session, { "DSC002.JPG": "  A frog  " })).toEqual([
      { file: "DSC001.JPG", caption: "" },
      { file: "DSC002.JPG", caption: "A frog" },
      { file: "DSC003.JPG", caption: "" },
    ]);
  });
});

describe("editor modes", () => {
  it("accepts only the four the grid knows how to paint", () => {
    expect(isEditorMode("cover")).toBe(true);
    expect(isEditorMode("captions")).toBe(true);
    expect(isEditorMode("banner")).toBe(false);
  });
});
