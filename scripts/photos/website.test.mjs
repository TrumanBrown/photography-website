import { describe, expect, it } from "vitest";
import {
  allowedNames,
  captionFor,
  descriptionProblems,
  placeLabel,
  plural,
  sessionDigest,
  slugPlace,
  speciesSubject,
} from "./website.mjs";
import { compileLexicon } from "./text.mjs";

const frog = {
  id: 1,
  name: "Cruziohyla sylviae",
  common: "Sylvia's Tree Frog",
  rank: "species",
  lineage: { family: { name: "Phyllomedusidae", common: "Leaf Frogs" } },
};
const seal = {
  id: 2,
  name: "Phoca vitulina",
  common: "Harbor Seal",
  rank: "species",
};
const spiny = {
  id: 3,
  name: "Sceloporus",
  common: "Spiny Lizards",
  rank: "genus",
};
const crarc = {
  slug: "costa-rica-amphibian-research-center-crarc-august-2026",
  title: "Guayacán, Costa Rica, September 2026",
  location: "Limón Province, Costa Rica",
};
const baker = {
  slug: "mt-baker-fall-2026",
  title: "Yellow Aster Butte, Washington, October 2026",
  location: "North Cascades, Washington",
};
const look = (over = {}) => ({
  group: "frog",
  subject: "Tree frog",
  count: 1,
  scene: "on a thin twig",
  conditions: "at night",
  idCheck: "fits",
  ...over,
});

describe("website captions", () => {
  it("leads with the iNaturalist species and ends on the most specific place", () => {
    expect(captionFor({ analysis: look(), taxon: frog, session: crarc })).toBe(
      "Sylvia's tree frog (Cruziohyla sylviae) on a thin twig at night, Guayacán",
    );
  });

  it("counts several of a species", () => {
    expect(speciesSubject(seal, 2)).toBe("Two harbor seals (Phoca vitulina)");
    expect(speciesSubject(seal, 14)).toBe("Harbor seals (Phoca vitulina)");
    expect(plural("Canada goose")).toBe("Canada geese");
    expect(plural("rockfish")).toBe("rockfish");
    expect(plural("butterfly")).toBe("butterflies");
    expect(plural("finch")).toBe("finches");
  });

  it("brackets a coarser identification after the model's plain word for it", () => {
    const caption = captionFor({
      analysis: look({
        group: "lizard",
        subject: "Spiny lizard",
        scene: "basking on a rock",
        conditions: "",
      }),
      taxon: spiny,
      session: crarc,
    });
    expect(caption).toBe(
      "Spiny lizard (Sceloporus) basking on a rock, Guayacán",
    );
  });

  it("never names a species without an identification", () => {
    const lexicon = compileLexicon([
      "Red-eyed Tree Frog",
      "Agalychnis callidryas",
    ]);
    const caption = captionFor({
      analysis: look({ subject: "Red-eyed tree frog" }),
      taxon: null,
      session: crarc,
      lexicon,
    });
    expect(caption).toBe("Frog on a thin twig at night, Guayacán");
  });

  it("drops the name when the photo plainly isn't the identified organism", () => {
    const caption = captionFor({
      analysis: look({
        group: "bird",
        subject: "Heron",
        scene: "standing in shallow water",
        conditions: "",
        idCheck: "conflict",
      }),
      taxon: frog,
      session: crarc,
    });
    expect(caption).toBe("Heron standing in shallow water, Guayacán");
  });

  it("drops a scene that names a place nobody wrote down", () => {
    const caption = captionFor({
      analysis: look({
        group: "mountain",
        subject: "Snow-covered peak",
        scene: "behind Mount Shuksan",
        conditions: "",
      }),
      session: baker,
    });
    expect(caption).toBe("Snow-covered peak, Yellow Aster Butte");
  });

  it("can name a landmark from your folder name", () => {
    expect(slugPlace("mt-baker-fall-2026")).toBe("Mount Baker");
    expect(allowedNames(baker)).toContain("Mount Baker");
    const caption = captionFor({
      analysis: look({
        group: "mountain",
        subject: "Mount Baker",
        scene: "above a still tarn",
        conditions: "at sunrise",
      }),
      session: baker,
    });
    expect(caption).toBe(
      "Mount Baker above a still tarn at sunrise, Yellow Aster Butte",
    );
  });

  it("skips the place when the subject already is the place", () => {
    const caption = captionFor({
      analysis: look({
        group: "coast",
        subject: "Yellow Aster Butte",
        scene: "under red autumn shrubs",
        conditions: "",
      }),
      session: baker,
    });
    expect(caption).toBe("Yellow Aster Butte under red autumn shrubs");
  });

  it("stays short enough for alt text", () => {
    const caption = captionFor({
      analysis: look({
        scene:
          "clinging to the underside of a broad leaf beside a dripping stream bank",
        conditions: "in light rain at dusk",
      }),
      taxon: frog,
      session: crarc,
    });
    expect(caption.length).toBeLessThanOrEqual(125);
    expect(
      caption.startsWith("Sylvia's tree frog (Cruziohyla sylviae) clinging"),
    ).toBe(true);
    expect(caption).not.toContain("rain");
  });

  it("uses the location for an untitled session", () => {
    expect(
      placeLabel({
        slug: "new-trip",
        title: "New Trip",
        location: "Kauai, Hawaii",
      }),
    ).toBe("Kauai");
    expect(placeLabel(baker)).toBe("Yellow Aster Butte");
  });
});

describe("session descriptions", () => {
  const shots = [
    {
      inat: { taxon: 1 },
      analysis: {
        ...look(),
        description: "A green frog.",
        appeal: 8,
        setting: "rainforest",
        conditions: "at night",
      },
    },
    {
      inat: { taxon: 1 },
      analysis: {
        ...look(),
        description: "Another frog.",
        appeal: 6,
        setting: "rainforest",
        conditions: "at night",
      },
    },
    {
      analysis: {
        ...look({ group: "bird", subject: "Heron" }),
        description: "A heron.",
        appeal: 5,
        setting: "canal bank",
        conditions: "",
      },
    },
  ];
  const digest = sessionDigest({
    session: crarc,
    shots,
    taxa: { 1: frog },
    captions: [
      "Sylvia's tree frog (Cruziohyla sylviae) on a twig, Guayacán",
      "Heron by the canal, Guayacán",
    ],
  });

  it("condenses the session's photos", () => {
    expect(digest.species).toEqual([
      {
        name: "Sylvia's tree frog",
        count: 2,
        scientific: "Cruziohyla sylviae",
        kind: "",
      },
    ]);
    expect(digest.unnamed).toEqual([{ name: "heron", count: 1 }]);
    expect(digest.captions).toEqual([
      "Sylvia's tree frog (Cruziohyla sylviae) on a twig",
      "Heron by the canal",
    ]);
    expect(digest.highlights[0]).toBe("A green frog.");
  });

  const check = (description, extra = {}) =>
    descriptionProblems({ description }, { session: crarc, digest, ...extra });

  it("passes a plain, grounded description", () => {
    expect(
      check(
        "Frogs, and most of them at night. A Sylvia's tree frog on a thin twig, and a heron by the canal in Guayacán.",
      ),
    ).toEqual([]);
  });

  it("catches the tells and the made-up names", () => {
    const lexicon = compileLexicon(["Red-eyed Tree Frog"]);
    expect(
      check(
        "A stunning night — frogs everywhere, more than enough for one walk.",
      ).join(" "),
    ).toMatch(/stunning.*em dash/);
    expect(
      check("A red-eyed tree frog sat on a twig all night by the canal.", {
        lexicon,
      }).join(" "),
    ).toMatch(/Red-eyed Tree Frog/);
    expect(
      check(
        "Frogs on every leaf near Tortuguero after dark, more than I could count.",
      ).join(" "),
    ).toMatch(/Tortuguero/);
    expect(
      check(
        "Frogs on every leaf after dark, more than I could count, and a heron.",
        {
          openerCounts: new Map([["frogs", 3]]),
        },
      ).join(" "),
    ).toMatch(/open with "frogs"/);
  });

  it("checks the shape of a drafted title", () => {
    const problems = descriptionProblems(
      {
        description:
          "Frogs on every leaf after dark, more than I could count, and a heron.",
        title: "Guayacán night walk",
      },
      { session: crarc, digest, needTitle: true },
    );
    expect(problems.join(" ")).toMatch(/Place, Region, Month Year/);
  });
});
