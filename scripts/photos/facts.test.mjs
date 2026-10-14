import { describe, expect, it } from "vitest";
import { checkFacts, factKey, pickFact } from "./facts.mjs";
import { normaliseLine } from "./lines.mjs";
import { compileLexicon } from "./text.mjs";

const art = {
  title: "Red-eyed tree frog",
  text:
    "Embryos can hatch early and drop into the water to escape approaching predators. " +
    "Its orange feet have suction cups that help it cling to the undersides of leaves. " +
    "Males shake branches to keep rivals away during the mating season, which lasts 3 months. " +
    "Unlike the Mexican leaf frog, it is mostly green.",
};

describe("post facts", () => {
  it("keeps facts it can trace to the article", () => {
    const facts = checkFacts(
      {
        facts: [
          {
            text: "Embryos can hatch early and drop into the water below when a predator closes in.",
            source:
              "Embryos can hatch early and drop into the water to escape approaching predators.",
          },
        ],
      },
      art,
    );
    expect(facts).toHaveLength(1);
  });

  it("drops facts that can't be traced, add numbers, or pretend to be the photographer", () => {
    const reply = {
      facts: [
        // The quoted sentence isn't in the article.
        {
          text: "Red-eyed tree frogs can live for more than five years in the wild.",
          source: "They live five years.",
        },
        // A number the article never gives.
        {
          text: "Males shake branches for up to 6 months to keep their rivals away.",
          source:
            "Males shake branches to keep rivals away during the mating season, which lasts 3 months.",
        },
        // First person.
        {
          text: "Orange feet are what I look for: they carry suction cups for gripping leaves.",
          source:
            "Its orange feet have suction cups that help it cling to the undersides of leaves.",
        },
        // Fine.
        {
          text: "Males shake their branch to keep rivals away during a mating season of 3 months.",
          source:
            "Males shake branches to keep rivals away during the mating season, which lasts 3 months.",
        },
      ],
    };
    expect(checkFacts(reply, art)).toEqual([
      "Males shake their branch to keep rivals away during a mating season of 3 months.",
    ]);
  });

  it("won't let a fact name a species the article doesn't mention", () => {
    const lexicon = compileLexicon(["Glass Frog", "Mexican Leaf Frog"]);
    const reply = {
      facts: [
        {
          text: "Its suction-cup feet grip leaves much like a glass frog's do, even upside down.",
          source:
            "Its orange feet have suction cups that help it cling to the undersides of leaves.",
        },
        {
          text: "Unlike a Mexican leaf frog, this one is mostly green, apart from its orange feet.",
          source: "Unlike the Mexican leaf frog, it is mostly green.",
        },
      ],
    };
    expect(checkFacts(reply, art, { lexicon })).toHaveLength(1);
  });

  it("rotates: a new post takes the fact used least, the more surprising one on a tie", () => {
    const facts = ["first", "second", "third"];
    expect(pickFact(facts, [])).toBe("first");
    expect(pickFact(facts, ["first"])).toBe("second");
    expect(pickFact(facts, ["first", "second", "third", "first"])).toBe(
      "second",
    );
    expect(pickFact([], [])).toBe("");
  });

  it("drops facts that open on a teaser instead of just saying it", () => {
    const reply = {
      facts: [
        {
          text: "Escape starts early. Embryos can hatch and drop into the water when predators approach.",
          source:
            "Embryos can hatch early and drop into the water to escape approaching predators.",
        },
        {
          text: "Their embryos can hatch early and drop into the water when a predator gets close.",
          source:
            "Embryos can hatch early and drop into the water to escape approaching predators.",
        },
      ],
    };
    expect(checkFacts(reply, art)).toEqual([
      "Their embryos can hatch early and drop into the water when a predator gets close.",
    ]);
  });

  it("drops facts that say themselves twice, and straightens curly quotes", () => {
    const source =
      "Males shake branches to keep rivals away during the mating season, which lasts 3 months.";
    const reply = {
      facts: [
        {
          text: "Males shake their branch to keep rivals away, that's how they hold a spot.",
          source,
        },
        {
          text: "Males shake their branch to keep rivals away. It's a handy trick.",
          source,
        },
        {
          text: "Males shake the branch they’re on to keep rivals away during a 3 month mating season.",
          source,
        },
      ],
    };
    expect(checkFacts(reply, art)).toEqual([
      "Males shake the branch they're on to keep rivals away during a 3 month mating season.",
    ]);
  });

  describe("from a genus or family article", () => {
    const katydids = {
      title: "Tettigoniidae",
      about: "family",
      group: "Katydids",
      text:
        "Katydids sing by rubbing their forewings together, at a tempo set by the temperature. " +
        "Some katydids flick their wings open to show eyespots. " +
        "They are found in every continent except Antarctica.",
    };

    it("keeps only facts true of the whole group, without 'like this one'", () => {
      const reply = {
        facts: [
          {
            text: "Katydids like this one sing by rubbing their forewings together.",
            source:
              "Katydids sing by rubbing their forewings together, at a tempo set by the temperature.",
          },
          {
            text: "Some katydids flick their wings open to flash fake eyes at a predator.",
            source: "Some katydids flick their wings open to show eyespots.",
          },
          {
            text: "Katydids are found in every continent except Antarctica, from rainforest to desert.",
            source: "They are found in every continent except Antarctica.",
          },
          {
            text: "They sing faster when it's warm, so their song works as a rough thermometer.",
            source:
              "Katydids sing by rubbing their forewings together, at a tempo set by the temperature.",
          },
        ],
      };
      expect(checkFacts(reply, katydids)).toEqual([
        "They sing faster when it's warm, so their song works as a rough thermometer.",
      ]);
    });

    it("says the group's name the way a person would", () => {
      const salamanders = {
        title: "Bolitoglossa",
        about: "genus",
        group: "Mushroom-tongued Salamanders",
        text: "Mushroom-tongued salamanders catch prey by firing out their tongues, and they have no lungs.",
      };
      expect(
        checkFacts(
          {
            facts: [
              {
                text: "Mushroom-tongued Salamanders have no lungs, so they breathe through their skin and the lining of the mouth.",
                source:
                  "Mushroom-tongued salamanders catch prey by firing out their tongues, and they have no lungs.",
              },
              {
                text: "With no lungs at all, Mushroom-tongued Salamanders fire out their tongues to catch prey.",
                source:
                  "Mushroom-tongued salamanders catch prey by firing out their tongues, and they have no lungs.",
              },
            ],
          },
          salamanders,
        ),
      ).toEqual([
        "Mushroom-tongued salamanders have no lungs, so they breathe through their skin and the lining of the mouth.",
        "With no lungs at all, mushroom-tongued salamanders fire out their tongues to catch prey.",
      ]);
    });
  });

  it("files facts under the species, a landmark, or the session's place", () => {
    expect(factKey({ taxon: { id: 42 }, level: "species", slug: "s" })).toBe(
      "taxon:42",
    );
    expect(factKey({ landmark: "Mount Baker", slug: "s" })).toBe(
      "landmark:mount baker",
    );
    expect(factKey({ slug: "zhangjiajie-april-2026" })).toBe(
      "place:zhangjiajie-april-2026",
    );
  });
});

describe("first lines", () => {
  it("keeps a plain action after a species name, lowercase", () => {
    expect(
      normaliseLine({ action: "Clinging to a stem." }, { named: true }),
    ).toEqual({
      action: "clinging to a stem",
    });
  });

  it("takes just the name for a photo of it sitting there, and never a pose", () => {
    expect(normaliseLine({ action: "" }, { named: true })).toEqual({
      action: "",
    });
    expect(
      normaliseLine(
        { action: "perched upright on a stem facing left" },
        { named: true },
      ),
    ).toEqual({ action: "perched on a stem" });
    expect(
      normaliseLine({ action: "perched upright facing left" }, { named: true }),
    ).toEqual({ action: "" });
    expect(
      normaliseLine(
        { action: "perched on a stem with its bill raised" },
        { named: true },
      ),
    ).toEqual({ action: "perched on a stem" });
    expect(normaliseLine({ line: "A gull facing right" })).toEqual({
      text: "A gull",
    });
    // An empty line for something unnamed says nothing at all.
    expect(normaliseLine({ line: "" })).toBeNull();
  });

  it("cuts the background if the model slips it in", () => {
    expect(
      normaliseLine(
        { action: "clinging to a stem against a dark background" },
        { named: true },
      ),
    ).toEqual({ action: "clinging to a stem" });
    expect(
      normaliseLine({ line: "A heron in front of blurred foliage" }),
    ).toEqual({ text: "A heron" });
  });

  it("refuses lines with the words that give generated text away", () => {
    expect(
      normaliseLine({ line: "Illuminated skyline over the river" }),
    ).toBeNull();
    expect(normaliseLine({ line: "" })).toBeNull();
    expect(
      normaliseLine({ line: "Mount Baker from Yellow Aster Butte" }),
    ).toEqual({
      text: "Mount Baker from Yellow Aster Butte",
    });
  });

  it("refuses vague words, but not a real surface", () => {
    expect(
      normaliseLine(
        { action: "holding an object among stems" },
        { named: true },
      ),
    ).toBeNull();
    expect(
      normaliseLine(
        { action: "facing the camera on a surface" },
        { named: true },
      ),
    ).toBeNull();
    expect(
      normaliseLine({ action: "swimming at the surface" }, { named: true }),
    ).toEqual({ action: "swimming at the surface" });
  });

  it("gives a bare body part its 'with its'", () => {
    expect(
      normaliseLine(
        { action: "mouth open among grass and fallen leaves" },
        { named: true },
      ),
    ).toEqual({ action: "with its mouth open among grass and fallen leaves" });
    // A lowered head is a pose, so it comes out once it has its "with".
    expect(
      normaliseLine(
        { action: "standing head lowered on a slope" },
        { named: true },
      ),
    ).toEqual({ action: "standing on a slope" });
    expect(
      normaliseLine(
        { action: "grazing heads lowered" },
        { named: true, plural: true },
      ),
    ).toEqual({ action: "grazing" });
    expect(
      normaliseLine({ action: "flying with its tail fanned" }, { named: true }),
    ).toEqual({ action: "flying with its tail fanned" });
    // A body part inside a "with" phrase already has its "with".
    for (const action of [
      "preening with its long curved bill tucked into its feathers",
      "resting on a gray rock with its orange and black wings spread",
      "standing with its front legs spread",
    ])
      expect(normaliseLine({ action }, { named: true })).toEqual({ action });
    expect(
      normaliseLine(
        { action: "hanging head down in its web with its legs spread" },
        { named: true },
      ),
    ).toEqual({ action: "hanging head down in its web with its legs spread" });
  });
});
