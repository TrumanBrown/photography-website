import { buildHashtags, landmarkTag, placeTag, tagify } from "./hashtags.mjs";
import { finishPost } from "./compose.mjs";
import {
  compileLexicon,
  displayName,
  lint,
  speciesLabel,
  tidy,
  ungroundedNames,
} from "../photos/text.mjs";
import { cameraName, gearLine } from "../photos/exif.mjs";

const frog = {
  id: 1,
  name: "Cruziohyla sylviae",
  common: "Sylvia's Tree Frog",
  rank: "species",
  kingdom: "Animalia",
  lineage: {
    class: { name: "Amphibia" },
    order: { name: "Anura" },
    family: { name: "Phyllomedusidae", common: "Leaf Frogs" },
  },
  iucn: null,
};
const session = {
  title: "Guayacán, Costa Rica, September 2026",
  location: "Limón Province, Costa Rica",
  description:
    "A night walk at Guayacán, and wall-to-wall amphibians once it got dark.",
};
const a6700macro = {
  make: "SONY",
  model: "ILCE-6700",
  lens: "FE 90mm F2.8 Macro G OSS",
  focalLength: 90,
  fNumber: 2.8,
  exposureTime: 1 / 160,
  iso: 3200,
};

describe("hashtags", () => {
  it("tagifies names, accents and apostrophes", () => {
    expect(tagify("Sylvia's Tree Frog")).toBe("sylviastreefrog");
    expect(tagify("Limón")).toBe("limon");
  });

  it("builds five data-driven tags for a verified animal", () => {
    const tags = buildHashtags({
      taxon: frog,
      speciesOk: true,
      group: "frog",
      facts: a6700macro,
      session,
      proposedPlace: "Costa Rica",
    });
    expect(tags).toEqual([
      "#sylviastreefrog",
      "#frogsofinstagram",
      "#costarica",
      "#macrophotography",
      "#sonya6700",
    ]);
  });

  it("never names an unverified species and caps at five", () => {
    const tags = buildHashtags({
      taxon: frog,
      speciesOk: false,
      group: "bird",
      facts: a6700macro,
      session,
      proposedPlace: "Guayacán",
    });
    expect(tags).not.toContain("#sylviastreefrog");
    expect(tags).toContain("#birdsofinstagram");
    expect(tags.length).toBeLessThanOrEqual(5);
  });

  it("only accepts place and landmark ideas grounded in the session text", () => {
    expect(placeTag({ proposed: "Tortuguero", ...session })).toBe("costarica");
    expect(placeTag({ proposed: "Guayacán", ...session })).toBe("guayacan");
    expect(placeTag({ proposed: "Limón Province", ...session })).toBe(
      "costarica",
    );
    expect(
      placeTag({
        proposed: "",
        title: "Gunn Peak, Washington, June 2026",
        location: "Central Cascades, Washington",
      }),
    ).toBe("pnw");
    expect(
      landmarkTag({
        landmark: "Mount Shuksan",
        title: "North Cascades, July 2026",
        location: "North Cascades, Washington",
      }),
    ).toBe("");
    expect(
      landmarkTag({
        landmark: "Mount Rainier",
        title: "Sunrise, Mount Rainier, July 2026",
        location: "Mount Rainier National Park, Washington",
      }),
    ).toBe("mountrainier");
  });
});

describe("camera facts", () => {
  it("names bodies the way people search for them", () => {
    expect(cameraName({ make: "SONY", model: "ILCE-6700" })).toBe("Sony a6700");
    expect(cameraName({ make: "Apple", model: "iPhone 16 Pro" })).toBe(
      "iPhone 16 Pro",
    );
    expect(cameraName({ make: "Canon", model: "Canon EOS R100" })).toBe(
      "Canon EOS R100",
    );
  });

  it("writes a gear line, with focal length only for zooms", () => {
    expect(gearLine(a6700macro)).toBe(
      "Sony a6700 · FE 90mm F2.8 Macro G OSS · f/2.8 · 1/160s · ISO 3200",
    );
    expect(
      gearLine({
        ...a6700macro,
        lens: "E 70-350mm F4.5-6.3 G OSS",
        focalLength: 350,
        fNumber: 6.3,
      }),
    ).toBe(
      "Sony a6700 · E 70-350mm F4.5-6.3 G OSS at 350mm · f/6.3 · 1/160s · ISO 3200",
    );
  });
});

describe("caption text", () => {
  it("puts species names in sentence case, keeping proper nouns", () => {
    expect(displayName("Northwestern Garter Snake")).toBe(
      "Northwestern garter snake",
    );
    expect(displayName("Hoffmann's Two-toed Sloth")).toBe(
      "Hoffmann's two-toed sloth",
    );
    expect(displayName("American Robin")).toBe("American robin");
    expect(speciesLabel(frog)).toBe("Sylvia's tree frog (Cruziohyla sylviae)");
  });

  it("tidies machine tells without changing meaning", () => {
    expect(tidy("Wet leaves — a frog! 🐸 #frog")).toBe(
      "Wet leaves, a frog. frog",
    );
  });

  it("flags banned words and passes plain text", () => {
    expect(lint("A stunning frog")).toEqual(['uses "stunning"']);
    expect(lint("Orange hands and a barred yellow side")).toEqual([]);
  });

  it("keeps demonyms capitalised mid-sentence", () => {
    expect(displayName("Ecuadorian Hermit Crab", { midSentence: true })).toBe(
      "Ecuadorian hermit crab",
    );
    expect(
      displayName("Northwestern Garter Snake", { midSentence: true }),
    ).toBe("northwestern garter snake");
    expect(displayName("Ocean Sunfish", { midSentence: true })).toBe(
      "ocean sunfish",
    );
  });

  it("finds capitalised names that aren't in the session text", () => {
    expect(
      ungroundedNames("Snow on Mount Shuksan", "North Cascades, Washington"),
    ).toEqual(["Mount", "Shuksan"]);
    expect(
      ungroundedNames(
        "x Guayacán, Limón Province, Costa Rica",
        `${session.title} ${session.location}`,
      ),
    ).toEqual([]);
  });

  it("assembles a post: website caption first, then body, IUCN line, gear and hashtags", () => {
    const post = finishPost({
      headline:
        "Sylvia's tree frog (Cruziohyla sylviae) on a thin twig at night, Guayacán, Limón Province, Costa Rica",
      body: "Orange hands, a barred yellow side, and a firm grip on a very thin twig.",
      alt: "A green frog with orange hands gripping a twig at night",
      session: { ...session, slug: "costa-rica-crarc-august-2026" },
      taxon: { ...frog, iucn: "Vulnerable" },
      level: "species",
      gear: gearLine(a6700macro),
      hashtags: ["#sylviastreefrog", "#frogsofinstagram"],
      pointer: "The rest of this set is on example.com, link in bio",
    });
    expect(post.problem).toBeUndefined();
    expect(post.caption.split("\n")[0]).toBe(
      "Sylvia's tree frog (Cruziohyla sylviae) on a thin twig at night, Guayacán, Limón Province, Costa Rica",
    );
    expect(post.caption).toContain(
      "Listed as Vulnerable on the IUCN Red List.",
    );
    expect(post.caption).toContain("Sony a6700");
    expect(post.caption.endsWith("#sylviastreefrog #frogsofinstagram")).toBe(
      true,
    );
  });

  it("rejects a body that names a species nobody identified", () => {
    const lexicon = compileLexicon([
      "Red-eyed Tree Frog",
      "Agalychnis callidryas",
      "Sylvia's Tree Frog",
      "Cruziohyla sylviae",
    ]);
    const base = {
      headline: "Tree frog on a leaf, Guayacán",
      alt: "A frog",
      session: { ...session, slug: "crarc" },
      gear: "",
      hashtags: [],
      pointer: "",
      lexicon,
    };
    const unverified = finishPost({
      ...base,
      body: "A red-eyed tree frog, Agalychnis callidryas.",
      taxon: null,
      level: null,
    });
    expect(unverified.problem).toMatch(/Red-eyed Tree Frog/);
    const verified = finishPost({
      ...base,
      body: "Green back, orange hands. Sylvia's tree frog keeps to the canopy.",
      taxon: frog,
      level: "species",
    });
    expect(verified.problem).toBeUndefined();
  });

  it("rejects a body that names a place the facts don't mention", () => {
    const post = finishPost({
      headline: "Snow-covered peak above the meadows, Washington Pass",
      body: "Fresh snow on Mount Shuksan above the meadows.",
      alt: "Snow",
      session: {
        slug: "north-cascades-july-2026",
        title: "Washington Pass, North Cascades, July 2026",
        location: "North Cascades, Washington",
      },
      taxon: null,
      level: null,
      gear: "",
      hashtags: [],
      pointer: "",
    });
    expect(post.problem).toMatch(/Shuksan/);
  });

  it("lets the body repeat a name from the species' reference summary", () => {
    const post = finishPost({
      headline: "Sylvia's tree frog (Cruziohyla sylviae) on a twig, Guayacán",
      body: "Orange hands. These frogs live in the canopy from Honduras to Panama.",
      alt: "A frog",
      session: { ...session, slug: "crarc" },
      taxon: {
        ...frog,
        summary: "It is found in lowland forest from Honduras to Panama.",
      },
      level: "species",
      gear: "",
      hashtags: [],
      pointer: "",
    });
    expect(post.problem).toBeUndefined();
  });
});
