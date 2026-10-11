import { buildHashtags, landmarkTag, placeTag, tagify } from "./hashtags.mjs";
import {
  compileLexicon,
  displayName,
  finishPost,
  lint,
  speciesLabel,
  tidy,
  ungroundedNames,
} from "./compose.mjs";
import { cameraName, gearLine } from "./exif.mjs";

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

  it("assembles a verified post with the species first and the place grounded", () => {
    const post = finishPost({
      draft: {
        detail: "on a thin twig at night",
        place_line: "Guayacán, Limón Province, Costa Rica",
        body: "Orange hands, a barred yellow side, and a firm grip on a very thin twig.",
        alt_text: "A green frog with orange hands gripping a twig at night",
      },
      session,
      gear: gearLine(a6700macro),
      taxon: { ...frog, iucn: "Vulnerable" },
      speciesOk: true,
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
    expect(post.caption.endsWith("#sylviastreefrog #frogsofinstagram")).toBe(
      true,
    );
  });

  it("falls back to the session location when the model invents a place", () => {
    const post = finishPost({
      draft: {
        detail: "",
        place_line: "Tortuguero National Park",
        body: "Green and orange.",
        alt_text: "A frog",
      },
      session,
      gear: "",
      taxon: frog,
      speciesOk: true,
      hashtags: [],
      pointer: "",
    });
    expect(post.headline).toBe(
      "Sylvia's tree frog (Cruziohyla sylviae), Limón Province, Costa Rica",
    );
  });

  it("rejects species names a post has no verified right to use", () => {
    const lexicon = compileLexicon([
      "Red-eyed Tree Frog",
      "Agalychnis callidryas",
      "Sylvia's Tree Frog",
      "Cruziohyla sylviae",
    ]);
    const unverified = finishPost({
      draft: {
        subject: "Tree frog",
        detail: "",
        place_line: "",
        body: "A red-eyed tree frog, Agalychnis callidryas.",
        alt_text: "A frog",
      },
      session,
      gear: "",
      taxon: null,
      speciesOk: false,
      hashtags: [],
      pointer: "",
      lexicon,
    });
    expect(unverified.problem).toMatch(/Red-eyed Tree Frog/);
    const verified = finishPost({
      draft: {
        detail: "",
        place_line: "",
        body: "Green back, orange hands.",
        alt_text: "Sylvia's tree frog on a twig",
      },
      session,
      gear: "",
      taxon: frog,
      speciesOk: true,
      hashtags: [],
      pointer: "",
      lexicon,
    });
    expect(verified.problem).toBeUndefined();
  });

  it("drops a detail phrase that names something unverified", () => {
    const post = finishPost({
      draft: {
        detail: "on a Heliconia leaf",
        place_line: "",
        body: "Green and orange.",
        alt_text: "A frog",
      },
      session,
      gear: "",
      taxon: frog,
      speciesOk: true,
      hashtags: [],
      pointer: "",
    });
    expect(post.headline).toBe(
      "Sylvia's tree frog (Cruziohyla sylviae), Limón Province, Costa Rica",
    );
  });

  it("rejects an unverified subject that names something not in the session", () => {
    const post = finishPost({
      draft: {
        subject: "Snow on Mount Shuksan",
        detail: "",
        place_line: "",
        body: "Snow.",
        alt_text: "Snow",
      },
      session: {
        title: "North Cascades, July 2026",
        location: "North Cascades, Washington",
      },
      gear: "",
      taxon: null,
      speciesOk: false,
      hashtags: [],
      pointer: "",
    });
    expect(post.problem).toMatch(/Mount, Shuksan/);
  });
});
