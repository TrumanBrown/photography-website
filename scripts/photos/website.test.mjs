import { describe, expect, it } from "vitest";
import {
  allowedNames,
  backdropIn,
  captionFor,
  descriptionProblems,
  openerOf,
  placeAfter,
  placeLabel,
  plural,
  SHAPES,
  sessionDigest,
  shapeFor,
  sharedPhrase,
  slugPlace,
  speciesSubject,
  withoutBackdrop,
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

  it("uses the written first line: the name, then what it's doing, no background", () => {
    expect(
      captionFor({
        analysis: look({ count: 2 }),
        taxon: frog,
        session: crarc,
        line: { action: "resting with its toes on a stem" },
      }),
    ).toBe(
      "Two Sylvia's tree frogs (Cruziohyla sylviae) resting with their toes on a stem, Guayacán",
    );
    expect(
      captionFor({
        analysis: look(),
        taxon: frog,
        session: crarc,
        line: { action: "clinging to a stem" },
      }),
    ).toBe(
      "Sylvia's tree frog (Cruziohyla sylviae) clinging to a stem, Guayacán",
    );
    expect(
      captionFor({
        analysis: look({ group: "mountain", subject: "Mount Baker" }),
        session: baker,
        line: { text: "Mount Baker from Yellow Aster Butte" },
      }),
    ).toBe("Mount Baker from Yellow Aster Butte");
  });

  it("takes just the name and place when the line says nothing more, and drops a pose from the notes", () => {
    expect(
      captionFor({
        analysis: look(),
        taxon: frog,
        session: crarc,
        line: { action: "" },
      }),
    ).toBe("Sylvia's tree frog (Cruziohyla sylviae), Guayacán");
    // No written line: built from the notes, without their pose.
    expect(
      captionFor({
        analysis: look({
          scene: "perched on a twig facing right",
          conditions: "",
        }),
        taxon: frog,
        session: crarc,
      }),
    ).toBe(
      "Sylvia's tree frog (Cruziohyla sylviae) perched on a twig, Guayacán",
    );
    expect(
      captionFor({
        analysis: look({ scene: "on a twig" }),
        taxon: frog,
        session: crarc,
        line: { action: "on a twig with its head turned" },
      }),
    ).toBe("Sylvia's tree frog (Cruziohyla sylviae) on a twig, Guayacán");
  });

  it("falls back to the notes when a written line names something nobody wrote down", () => {
    const caption = captionFor({
      analysis: look({
        group: "mountain",
        subject: "Snow-covered peak",
        scene: "above a still tarn",
        conditions: "",
      }),
      session: baker,
      line: { text: "Mount Shuksan above a still tarn" },
    });
    expect(caption).toBe(
      "Snow-covered peak above a still tarn, Yellow Aster Butte",
    );
  });

  it("only adds the parts of the place the line hasn't named", () => {
    expect(
      placeAfter(
        "Mount Everest above the clouds",
        "Everest north face, Tibet, China",
      ),
    ).toBe("Tibet, China");
    expect(
      placeAfter(
        "Shanghai skyline across the river at night",
        "Shanghai, China",
      ),
    ).toBe("China");
    expect(
      placeAfter(
        "Heron in the shallows",
        "Tortuguero canals, Limón Province, Costa Rica",
      ),
    ).toBe("Tortuguero canals, Limón Province, Costa Rica");
  });

  it("keeps a place that only shares a word with the line or the species", () => {
    expect(
      placeAfter(
        "grazing on sparse grass",
        "Tibetan plateau, Tibet, China",
        "Tibetan gazelle (Procapra picticaudata)",
      ),
    ).toBe("Tibetan plateau, Tibet, China");
    expect(
      placeAfter(
        "standing on a slope",
        "Tapir Valley, Bijagua, Costa Rica",
        "Baird's tapir (Tapirus bairdii)",
      ),
    ).toBe("Tapir Valley, Bijagua, Costa Rica");
    expect(
      placeAfter(
        "crouching on a leaf",
        "Tapir Valley, Bijagua, Costa Rica",
        "Tapir Valley tree frog (Tlalocohyla celeste)",
      ),
    ).toBe("Bijagua, Costa Rica");
    expect(
      placeAfter(
        "resting on wet mesh",
        "Puget Sound tide pools",
        "Northern kelp crab (Pugettia producta)",
      ),
    ).toBe("Puget Sound tide pools");
    expect(placeAfter("Jagged peaks above rocky slopes", "Gunn Peak")).toBe(
      "Gunn Peak",
    );
    expect(
      placeAfter("Moss-covered cloud forest in fog", "Monteverde Cloud Forest"),
    ).toBe("Monteverde Cloud Forest");
  });

  it("writes 'near' mid-sentence", () => {
    expect(
      captionFor({
        analysis: look({ group: "other", subject: "Slug" }),
        session: {
          slug: "june-nearby-seattle-wildlife",
          title: "Near Seattle, Washington, June 2026",
          location: "Puget Sound lowlands, Washington",
        },
        line: { text: "A slug with its tentacles out" },
      }),
    ).toBe("A slug with its tentacles out, near Seattle");
  });

  it("counts several of a species", () => {
    expect(speciesSubject(seal, 2)).toBe("Two harbor seals (Phoca vitulina)");
    expect(speciesSubject(seal, 14)).toBe("Harbor seals (Phoca vitulina)");
    expect(
      speciesSubject(
        {
          name: "Lontra canadensis",
          common: "North American River Otter",
          rank: "species",
        },
        2,
      ),
    ).toBe("Two North American river otters (Lontra canadensis)");
    expect(plural("Canada goose")).toBe("Canada geese");
    expect(plural("rockfish")).toBe("rockfish");
    expect(plural("butterfly")).toBe("butterflies");
    expect(plural("finch")).toBe("finches");
  });

  it("leads a species with no English name with a plain word for what it is", () => {
    const opima = { name: "Corythalia opima", common: null, rank: "species" };
    expect(speciesSubject(opima, 1, "Jumping spider")).toBe(
      "Jumping spider (Corythalia opima)",
    );
    expect(speciesSubject(opima, 2, "Jumping spider")).toBe(
      "Two jumping spiders (Corythalia opima)",
    );
    expect(speciesSubject(opima)).toBe("Corythalia opima");
    const caption = captionFor({
      analysis: look({
        group: "spider",
        subject: "Jumping spider",
        scene: "on a fern",
        conditions: "",
      }),
      taxon: opima,
      session: crarc,
    });
    expect(caption).toBe(
      "Jumping spider (Corythalia opima) on a fern, Guayacán",
    );
    // A subject that only repeats the scientific name falls back to the group word.
    const repeated = captionFor({
      analysis: look({
        group: "spider",
        subject: "Corythalia opima",
        scene: "on a fern",
        conditions: "",
      }),
      taxon: opima,
      session: crarc,
    });
    expect(repeated).toBe("Spider (Corythalia opima) on a fern, Guayacán");
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

  it("leaves out light that only describes the flash", () => {
    const caption = captionFor({
      analysis: look({ conditions: "under bright direct light" }),
      taxon: frog,
      session: crarc,
    });
    expect(caption).toBe(
      "Sylvia's tree frog (Cruziohyla sylviae) on a thin twig, Guayacán",
    );
  });

  it("keeps place names inside species names capitalised", () => {
    const snake = {
      name: "Thamnophis sirtalis pickeringii",
      common: "Puget Sound Garter Snake",
      rank: "subspecies",
    };
    expect(speciesSubject(snake)).toBe(
      "Puget Sound garter snake (Thamnophis sirtalis pickeringii)",
    );
    expect(speciesSubject(snake, 2)).toBe(
      "Two Puget Sound garter snakes (Thamnophis sirtalis pickeringii)",
    );
  });

  it("treats everyday abbreviations as words, not names", () => {
    const caption = captionFor({
      analysis: look({
        group: "other",
        subject: "Silver SUV",
        scene: "parked on a dirt track",
        conditions: "",
      }),
      session: baker,
    });
    expect(caption).toBe(
      "Silver SUV parked on a dirt track, Yellow Aster Butte",
    );
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

  it("leaves what you did there out of the place", () => {
    expect(
      placeLabel({
        slug: "costa-rica-tortuguero-night-walk-august-2026",
        title: "Tortuguero night walk, Costa Rica, September 2026",
        location: "Limón Province, Costa Rica",
      }),
    ).toBe("Tortuguero");
    expect(
      placeLabel({
        slug: "july-macro-eastern-washington",
        title: "Eastern Washington macro, July 2026",
        location: "Eastern Washington",
      }),
    ).toBe("Eastern Washington");
    expect(
      placeLabel({
        slug: "eastern-washington-camping-memorial-weekend",
        title: "Shrub-steppe, Eastern Washington, May 2026",
        location: "Eastern Washington",
      }),
    ).toBe("shrub-steppe");
    expect(
      placeLabel({
        slug: "portland-and-nearby-oct-2025",
        title: "Portland and Nearby, Oregon, November 2025",
        location: "Portland area, Oregon",
      }),
    ).toBe("Portland");
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

  it("passes a grounded description in his voice", () => {
    expect(
      check(
        "Frogs, and most of them at night lol. Found a Sylvia's tree frog on a thin twig, and a heron by the canal in Guayacán.",
      ),
    ).toEqual([]);
  });

  it("wants his reaction in it, and nothing he didn't say happened", () => {
    expect(
      check(
        "Frogs, and most of them at night. A Sylvia's tree frog on a thin twig, and a heron by the canal in Guayacán.",
      ).join(" "),
    ).toMatch(/no reaction of his/);
    for (const [text, said] of [
      [
        "We spent the night looking for frogs, such a fun walk with a Sylvia's tree frog on a twig.",
        "We",
      ],
      [
        "Went snorkeling off the bank and found a heron, such a cool bird.",
        "snorkeling",
      ],
      [
        "Waited ages for the Sylvia's tree frog to move, so cool when it finally did.",
        "Waited",
      ],
    ])
      expect(check(text).join(" ")).toContain(`It says "${said}"`);
    // His notes are what back it up.
    expect(
      check(
        "Went snorkeling off the bank and found a heron, such a cool bird.",
        { notes: "Snorkeled the reef in the afternoon." },
      ),
    ).toEqual([]);
  });

  it("keeps it about the trip, not the pictures, and in plain punctuation", () => {
    const voiced =
      "Such a fun night, a Sylvia's tree frog on a twig and a heron by the canal.";
    expect(check(voiced)).toEqual([]);
    expect(check(`${voiced} These photos are mostly frogs.`).join(" ")).toMatch(
      /talks about the photos/,
    );
    expect(check(`${voiced} Love it!`).join(" ")).toMatch(/exclamation/);
    expect(check(`${voiced} Who knew?`).join(" ")).toMatch(/question/);
    expect(check(voiced.replace("twig", "twig, likely (?)"))).toEqual([]);
  });

  it("keeps lol rare across sessions and opens differently from the rest", () => {
    const lol =
      "Frogs, and most of them at night lol. Found a Sylvia's tree frog on a thin twig.";
    expect(
      check(lol, { others: ["Big peaks lol.", "Lots of snow."] }).join(" "),
    ).toMatch(/Enough other sessions already say "lol"/);
    expect(check(`${lol} Such a cool spot lol`).join(" ")).toMatch(/2 times/);
    expect(openerOf("I saw a heron.")).toBe("i saw");
    expect(openerOf("Saw a heron.")).toBe("saw");
    expect(
      check("I saw a Sylvia's tree frog on a twig, such a cool one.", {
        openerCounts: new Map([["i saw", 3]]),
      }).join(" "),
    ).toMatch(/open with "i saw"/);
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

  it("won't describe the photo instead of the moment, and leaves it out of what the writer sees", () => {
    for (const text of [
      "Frogs on every leaf after dark, their orange toes bright against a nearly black background.",
      "A heron by the canal, its bill sharp against blurred green water.",
      "Snow on the face, with a bright foreground ridge in the light.",
      "A basilisk on a branch, lit against the dark.",
      "Basilisks on a branch, with leafy vegetation and water behind them.",
      "A fritillary on wet stones with a dark shadow falling to the left.",
      "A pika on a mossy rock, facing left.",
      "Under direct flash, a poison dart frog on a leaf.",
    ])
      expect(check(text).join(" ")).toMatch(/describes the photo/);
    expect(backdropIn("Waves break against the rocks below the trail.")).toBe(
      null,
    );
    expect(backdropIn("We left the trail where the river turns.")).toBe(null);
    expect(
      withoutBackdrop(
        "A dark brown bird faces right with one red foot raised. It has a raised crest and white flecks on its neck, against blurred green leaves and pale grass heads. The background is dark.",
      ),
    ).toBe(
      "A dark brown bird. It has a raised crest and white flecks on its neck.",
    );
    // Poses read as the photo, not the moment.
    for (const text of [
      "A snowcap on a stem with its bill raised.",
      "A crowned woodnymph perched upright on a stem.",
      "A gull facing the camera on wet stones.",
    ])
      expect(check(text).join(" ")).toMatch(/describes the photo/);
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

  it("lists a genus-level photo by its identification, never the model's guess", () => {
    const lizard = sessionDigest({
      session: crarc,
      shots: [
        {
          inat: { taxon: 3 },
          analysis: {
            ...look({ group: "lizard", subject: "Western fence lizard" }),
            description: "A lizard.",
            appeal: 5,
            setting: "rock",
            conditions: "",
          },
        },
      ],
      taxa: { 3: spiny },
    });
    expect(lizard.groups).toEqual([
      { name: "Spiny lizards (Sceloporus)", count: 1 },
    ]);
    const lexicon = compileLexicon(["Western Fence Lizard"]);
    expect(
      descriptionProblems(
        {
          description:
            "A western fence lizard on a warm rock, and not much else that day.",
        },
        { session: crarc, digest: lizard, lexicon },
      ).join(" "),
    ).toMatch(/Western Fence Lizard/);
  });

  it("rejects a description that reuses another session's phrasing", () => {
    expect(
      sharedPhrase("A white satin moth faces the camera with broad antennae.", [
        "Moths on rocks. A white satin moth faces the camera with broad antennae, and a bee.",
      ]),
    ).toBe("a white satin moth faces the");
    expect(sharedPhrase("Herons along the canal.", ["Frogs at night."])).toBe(
      null,
    );
    const problems = check(
      "Frogs, and most of them at night. A Sylvia's tree frog on a thin twig, and a heron by the canal in Guayacán.",
      {
        others: [
          "Somewhere else, a Sylvia's tree frog on a thin twig at dusk.",
        ],
      },
    );
    expect(problems.join(" ")).toMatch(/repeats/);
  });

  it("gives sessions different shapes, the same one every run", () => {
    expect(shapeFor("gunn-peak-june-2026")).toBe(
      shapeFor("gunn-peak-june-2026"),
    );
    const used = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((x) =>
        shapeFor(`session-${x}`),
      ),
    );
    expect(used.size).toBeGreaterThan(2);
    expect(SHAPES).toContain(shapeFor("anything"));
  });
});
