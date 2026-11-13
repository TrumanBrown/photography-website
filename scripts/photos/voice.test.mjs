import { describe, expect, it } from "vitest";
import {
  HIS_EMOJI,
  HIS_STORIES,
  cleanEmoji,
  ownOpening,
  fillName,
  loadVoiceGuide,
  mockVoice,
  normaliseStory,
  normaliseVoice,
  personIn,
  pickEmoji,
  pickShape,
  pickStart,
  storyOpener,
  voicePrompt,
  wantsEmoji,
} from "./voice.mjs";
import { compileLexicon } from "./text.mjs";

const fact =
  "Groove-billed anis lay their eggs in one communal nest, and all group members incubate the eggs and care for the young.";
const ani = {
  named: true,
  name: "groove-billed ani (Crotophaga sulcirostris)",
  allowed: "Bijagua Alajuela Province Costa Rica",
  grounding:
    "Bijagua Costa Rica Bird perched on a mossy post holding an insect",
  fact,
};

describe("post voice", () => {
  it("keeps openings written the way he writes them", () => {
    expect(
      normaliseStory(
        "Saw this {name} munching on some insect in Bijagua. Such a unique bird, the beak goes so far up its head, almost looks like a horn lol",
        ani,
      ),
    ).toBe(
      "Saw this {name} munching on some insect in Bijagua. Such a unique bird, the beak goes so far up its head, almost looks like a horn lol",
    );
    // His hedge stays; the last full stop goes, because the emoji takes its place.
    expect(
      normaliseStory(
        "Was taking a break on a hike and captured this {name} perched on a purple flower, likely (?) sucking nectar from the petals. I feel like some of the best wildlife experiences come when you're resting, and nature just comes to you.",
        {
          named: true,
          name: "two-tailed swallowtail (Papilio multicaudata)",
          allowed: "Eastern Washington",
          notes: "Took a break on a hike when this one landed.",
        },
      ),
    ).toMatch(/likely \(\?\) sucking nectar.*comes to you$/);
    expect(
      normaliseStory(
        "Pulled over on the side of the road to capture this canyon view in Kauai. I love how the low clouds cast such a distinct shadow on the cliffs",
        {
          allowed: "Napali Coast Kauai Hawaii",
          notes: "Pulled over on the drive down from the lookout.",
        },
      ),
    ).toMatch(/^Pulled over/);
  });

  it("won't make up what he was doing, who with, or when", () => {
    for (const text of [
      // A hike, a drive, a boat or the dark, with nothing to say so.
      "Was taking a break on a hike when this {name} landed right next to me. Such a cool bird to see up close",
      "Pulled over on the side of the road for this {name} on a post. Such a goofy looking beak on it",
      "Out on a boat when this {name} flew past. Pretty cool to see the beak up close",
      "Spotted this {name} at night on a post. Such a goofy looking beak on it",
      // Waiting, company, and time words that would be wrong months later.
      "After hours of waiting this {name} finally showed up on a post. Such a goofy looking beak",
      "We spotted this {name} on a post by the road. Such a goofy looking beak on it",
      "Saw this {name} this morning on a mossy post. Such a goofy looking beak on it",
    ])
      expect(normaliseStory(text, ani)).toBe("");
    // The same claim is fine once his notes back it up.
    expect(
      normaliseStory(
        "Out on a boat when this {name} flew past. Pretty cool to see the beak up close",
        { ...ani, notes: "Morning boat tour on the river." },
      ),
    ).not.toBe("");
    // A trip named for the canals can say "canal tour".
    expect(
      normaliseStory(
        "While on a canal tour in Tortuguero, got pretty close to this {name}. They're such odd looking birds, almost alien-like",
        {
          named: true,
          name: "green ibis (Mesembrinibis cayennensis)",
          allowed: "Tortuguero canals Limón Province Costa Rica",
          grounding: "costa rica tortuguero national park canal august 2026",
        },
      ),
    ).not.toBe("");
  });

  it("keeps the photo itself, facts, numbers and AI tells out", () => {
    const lexicon = compileLexicon(["Smooth-billed Ani"]);
    for (const text of [
      "Saw this {name} on a post against a blurred green background. Such a goofy looking beak on it",
      "Saw this {name} on a post. They can eat 30 insects a day, which is so wild",
      "Saw this {name} on a post. Isn't that beak something? So wild",
      "Saw this {name} on a post. Truly a testament to nature's design, so cool",
      "Saw this {name} on a post. It looks a lot like a smooth-billed ani up close, so cool",
      "Saw this {name} on a post. They lay their eggs in one communal nest, which is so wild",
      "Saw this {name} on a post in Monteverde. Such a goofy looking beak on it",
      "Saw this {name} munching on a bug. Nature never disappoints, so cool",
      "Saw this {name} on a post. Goofy looking beak on it, which stands out against the moss",
    ])
      expect(normaliseStory(text, { ...ani, lexicon })).toBe("");
    // A description with no opinion in it isn't his.
    expect(
      normaliseStory(
        "Saw this {name} perched on a mossy post with an insect in its bill in Bijagua",
        ani,
      ),
    ).toBe("");
  });

  it("puts the name where the animal comes up, not tacked on after a comma", () => {
    for (const text of [
      "Got this bird, a {name}, munching on some insect in Bijagua. Such a goofy beak on it",
      "Spotted a bird on a mossy post in Bijagua, this {name}. Such a goofy beak on it",
    ])
      expect(normaliseStory(text, ani)).toBe("");
  });

  it("won't swap in a fancier way to say I love", () => {
    for (const text of [
      "Saw this {name} munching on some insect in Bijagua. I really dig that goofy beak",
      "Saw this {name} munching on some insect in Bijagua. I'm a fan of that goofy beak",
      "Saw this {name} munching on some insect in Bijagua. Got a kick out of that goofy beak",
    ])
      expect(normaliseStory(text, ani)).toBe("");
    // ...and "I like" two posts running is a tic too.
    expect(
      normaliseStory(
        "Saw this {name} munching on some insect in Bijagua. I like how goofy that beak is",
        { ...ani, recent: ["I like how the frog sits. So cool"] },
      ),
    ).toBe("");
  });

  it("wants {name} exactly once for an identified species, and never for a landscape", () => {
    expect(
      normaliseStory(
        "Saw this groove-billed ani munching on some insect. Such a goofy looking beak on it",
        ani,
      ),
    ).toBe("");
    expect(
      normaliseStory(
        "Saw this {name} next to another {name} on a post. Such goofy looking beaks on them",
        ani,
      ),
    ).toBe("");
    expect(
      normaliseStory(
        "A fun pic of this {name} near the volcano. Such a cool view of it from the road",
        { allowed: "Arenal Volcano Costa Rica" },
      ),
    ).toBe("");
  });

  it("fills in the verified name, capitalised at the start of a sentence", () => {
    expect(
      fillName(
        "Saw this {name} munching on some insect",
        "groove-billed ani (Crotophaga sulcirostris)",
      ),
    ).toBe(
      "Saw this groove-billed ani (Crotophaga sulcirostris) munching on some insect",
    );
    expect(
      fillName(
        "So cool. {name} hanging off a leaf",
        "katydid (Mimetica incisa)",
      ),
    ).toBe("So cool. Katydid (Mimetica incisa) hanging off a leaf");
  });

  it("makes the words in front of the name agree with it", () => {
    const otters = "two North American river otters (Lontra canadensis)";
    expect(fillName("I came across this {name} beside a log", otters)).toBe(
      `I came across these ${otters} beside a log`,
    );
    expect(fillName("This {name} looked my way", otters)).toBe(
      `These ${otters} looked my way`,
    );
    expect(fillName("Found a {name} beside a log", otters)).toBe(
      `Found ${otters} beside a log`,
    );
    expect(fillName("A {name} beside a log. So cool", otters)).toBe(
      "Two North American river otters (Lontra canadensis) beside a log. So cool",
    );
    expect(
      fillName("I caught a {name} in the reeds", "agami heron (Agamia agami)"),
    ).toBe("I caught an agami heron (Agamia agami) in the reeds");
    expect(
      fillName(
        "Saw an {name} on a post",
        "groove-billed ani (Crotophaga sulcirostris)",
      ),
    ).toBe("Saw a groove-billed ani (Crotophaga sulcirostris) on a post");
    expect(
      fillName("Spotted a {name}", "European robin (Erithacus rubecula)"),
    ).toBe("Spotted a European robin (Erithacus rubecula)");
  });

  it("spreads his habits out: openers, lol, such a, and phrases from other posts", () => {
    const text =
      "Saw this {name} munching on some insect in Bijagua. Such a goofy beak, almost looks like a horn lol";
    // The same start as one of the last four posts.
    expect(
      normaliseStory(text, {
        ...ani,
        recent: ["Saw these two coatis digging around in the leaves. So funny"],
      }),
    ).toBe("");
    expect(
      normaliseStory(text, {
        ...ani,
        recent: [
          "Saw these two coatis digging around. So funny",
          "One",
          "Two",
          "Three",
          "Four",
        ],
      }),
    ).not.toBe("");
    // "lol" comes off when one of the last three posts had it.
    expect(
      normaliseStory(text, {
        ...ani,
        recent: ["Pulled over for this view lol"],
      }),
    ).toMatch(/like a horn$/);
    // "such a" on two posts in a row is one too many.
    expect(
      normaliseStory(text, {
        ...ani,
        recent: ["Came across such a tiny frog on a leaf"],
      }),
    ).toBe("");
    // Never his examples' wording.
    expect(
      normaliseStory(
        "Spotted this {name} on a post. Such a unique bird, the beak goes so far up its head",
        { ...ani, avoid: HIS_STORIES },
      ),
    ).toBe("");
    expect(storyOpener("Saw these two coatis")).toBe(
      storyOpener("Saw this {name}"),
    );
    // He starts with "I" or a verb: "I" on two posts in a row is fine,
    // as long as the words after it differ...
    expect(
      normaliseStory(
        "I spotted this {name} munching on some insect in Bijagua. Such a goofy beak, almost looks like a horn",
        { ...ani, recent: ["I love how this frog sits on a leaf. So cool"] },
      ),
    ).not.toBe("");
    // ...but "Saw this", "I found this", "Got this view of" is how the
    // first hundred posts all started: one post in three at most.
    for (const recent of [
      ["I found this tiny frog on a leaf. So cool"],
      ["Got this view of the lake. So cool", "Gunn Peak from the lake"],
    ])
      expect(
        normaliseStory(
          "I spotted this {name} munching on some insect in Bijagua. Such a goofy beak, almost looks like a horn",
          { ...ani, recent },
        ),
      ).toBe("");
    // Opening a sentence with "Such a" is for one post in four...
    expect(
      normaliseStory(
        "Spotted this {name} munching on some insect in Bijagua. Such a goofy beak, almost looks like a horn",
        {
          ...ani,
          recent: ["Found a tiny frog. Such a funny face", "One", "Two"],
        },
      ),
    ).toBe("");
    // ...but mid-sentence it's back two posts later.
    expect(
      normaliseStory(
        "Spotted this {name} munching on some insect in Bijagua. It has such a goofy beak, almost looks like a horn",
        {
          ...ani,
          recent: ["Found a tiny frog. Such a funny face", "One", "Two"],
        },
      ),
    ).not.toBe("");
    // "Such a" on two posts in a row is the one thing too many.
    expect(
      normaliseStory(
        "I spotted this {name} munching on some insect in Bijagua. Such a goofy beak, almost looks like a horn",
        { ...ani, recent: ["Found such a tiny frog on a leaf. So cool"] },
      ),
    ).toBe("");
  });

  it("ends on the animal or the scene, never a face, heart or hand", () => {
    for (const e of ["🦋", " ☁️ ", "🐊", "⛰️", "🚗", "🏞️"])
      expect(cleanEmoji(e)).toBe(e.trim());
    for (const e of [
      "😍",
      "😅",
      "🤔",
      "🤯",
      "🥹",
      "💚",
      "🧡",
      "👽",
      "🙌",
      "✨",
      "🌿",
      "🔥",
      "📸",
      "🦋🐸",
      "bird",
      "",
    ])
      expect(cleanEmoji(e)).toBe("");
    // A face from the model gives way to the animal.
    expect(pickEmoji("😍", { group: "bird" })).toBe("🐦");
    expect(pickEmoji("😂", { group: "other" })).toBe("");
    // A different one from the last post when there's a choice...
    expect(
      pickEmoji("🐦", { group: "bird", recent: ["🐦"], alternatives: ["🦅"] }),
    ).toBe("🦅");
    // ...but two birds in a row beat a face.
    expect(pickEmoji("🐦", { group: "bird", recent: ["🐦"] })).toBe("🐦");
  });

  it("takes his own words as written, with the emoji he ended on", () => {
    expect(
      ownOpening(
        "I spotted this brown caiman peering from underwater at me hahaha. They camouflage so well it's crazy.🐊",
      ),
    ).toEqual({
      text: "I spotted this brown caiman peering from underwater at me hahaha. They camouflage so well it's crazy",
      emoji: "🐊",
    });
    expect(
      ownOpening("she seemed to be teaching them how to hunt! 🦦 "),
    ).toEqual({
      text: "she seemed to be teaching them how to hunt!",
      emoji: "🦦",
    });
    // Without an emoji his words stay exactly as typed, full stop and all.
    expect(ownOpening("Looks like he just finished a big meal.")).toEqual({
      text: "Looks like he just finished a big meal.",
      emoji: "",
    });
  });

  it("doesn't try to be clever: no quips about posture, attitude or plans", () => {
    const marmot = {
      named: true,
      name: "hoary marmot (Marmota caligata)",
      allowed: "Sauk Mountain",
      grounding: "Sauk Mountain rock",
    };
    for (const text of [
      "Spotted this {name} sitting up on a rock on Sauk Mountain. Looks like he is supervising the whole slope lol",
      "Spotted this {name} sitting up on a rock on Sauk Mountain. Better posture than me, so cool",
      "Spotted this {name} sitting up on a rock on Sauk Mountain. Takes his rock sitting very seriously, so cool",
    ])
      expect(normaliseStory(text, marmot)).toBe("");
    expect(
      normaliseStory(
        "Spotted this {name} sitting up on a rock on Sauk Mountain. He had such a big round belly, pretty cool to see one this close",
        marmot,
      ),
    ).not.toBe("");
    // "looks like he's..." is fine now and then, not post after post.
    expect(
      normaliseStory(
        "Spotted this {name} sitting up on a rock on Sauk Mountain. Looks like he's just woken up, pretty cool to see one this close",
        {
          ...marmot,
          recent: ["Looks like it's waiting for something. So cool"],
        },
      ),
    ).toBe("");
  });

  it("takes the first option that passes, with its emoji", () => {
    expect(
      normaliseVoice(
        {
          options: [
            { text: "Saw this ani on a post. So cool", emoji: "🐦" },
            {
              text: "Caught this {name} mid-snack on a mossy post in Bijagua. Such a goofy beak, almost looks like a horn",
              emoji: "🦏",
            },
          ],
        },
        { ...ani, group: "bird" },
      ),
    ).toEqual({
      text: "Caught this {name} mid-snack on a mossy post in Bijagua. Such a goofy beak, almost looks like a horn",
      emoji: "🦏",
    });
    // None passes: why, so the preview can say what it's waiting on.
    expect(normaliseVoice({ options: [{ text: "Nice." }] }, ani)).toEqual({
      problems: ["needs {name} once"],
    });
  });

  it("carries both skills into the prompt, not their maintainer notes", () => {
    const guide = loadVoiceGuide();
    expect(guide).toMatch(/^## How he writes/);
    expect(guide).toContain("## How a post reads");
    expect(guide).toContain("## His rewrites");
    expect(guide).toContain("likely (?) sucking nectar");
    expect(guide).not.toContain("## For maintainers");
    expect(guide).not.toContain("## Where it applies");
    const prompt = voicePrompt(
      [
        {
          id: "1",
          named: "Groove-billed ani",
          count: 1,
          subject: "Bird",
          scene: "perched on a mossy post holding an insect",
          place: "Bijagua, Costa Rica",
          trip: "Bijagua, Costa Rica, August 2026",
          notes: "Morning walk along the road.",
          description: "A black bird with a thick bill holds an insect.",
          fact,
        },
      ],
      guide,
      { recent: [HIS_STORIES.at(-1)] },
    );
    expect(prompt).toContain('named "Groove-billed ani" (write {name})');
    expect(prompt).toContain('his notes "Morning walk along the road."');
    expect(prompt).toContain(`fun fact "${fact}"`);
    expect(prompt).toContain(HIS_STORIES.at(-1));
    expect(HIS_EMOJI).toHaveLength(HIS_STORIES.length);
  });

  it("writes each post in the shape it was given", () => {
    const view = {
      allowed: "Edinburgh Scotland",
      grounding: "Edinburgh Scotland city buildings lit up at night",
    };
    // A few words: no reaction needed, but no "I" and no "Saw this".
    expect(
      normaliseStory("Edinburgh at night", { ...view, shape: "short" }),
    ).toBe("Edinburgh at night");
    expect(
      normaliseStory("A {name} in Bijagua", { ...ani, shape: "short" }),
    ).toBe("A {name} in Bijagua");
    for (const text of [
      "I love Edinburgh at night",
      "Got Edinburgh at night",
      "Edinburgh at night. So cool up there",
    ])
      expect(normaliseStory(text, { ...view, shape: "short" })).toBe("");
    // Not "Iceland at sunset" right after "Edinburgh at night".
    expect(
      normaliseStory("Edinburgh at night", {
        ...view,
        shape: "short",
        recent: ["Reykjavik at sunset"],
      }),
    ).toBe("");
    // One sentence with his reaction, and a story is two or three.
    expect(
      normaliseStory("I love how the old town lights up in Edinburgh", {
        ...view,
        shape: "line",
      }),
    ).not.toBe("");
    expect(
      normaliseStory("I love the old town in Edinburgh. So cool at night", {
        ...view,
        shape: "line",
      }),
    ).toBe("");
    expect(
      normaliseStory(
        "Saw this {name} munching on some insect in Bijagua, such a goofy beak on it lol",
        ani,
      ),
    ).toBe("");
  });

  it("spreads out the tics the model reached for next", () => {
    const frog = {
      named: true,
      name: "lemur leaf frog (Agalychnis lemur)",
      allowed: "Guayacán Costa Rica",
      grounding: "Guayacán frog on a leaf",
      shape: "line",
    };
    for (const [text, recent] of [
      [
        "Such a cool {name} in Guayacán, those dark eyes are my favorite part",
        ["The hair on his face is my favorite part. Pretty wild", "One", "Two"],
      ],
      [
        "Such a weird {name} in Guayacán, his eyes are so good",
        ["His antennae are so cool, almost like feathers", "One"],
      ],
      [
        "Such a weird {name} in Guayacán, love the colors on him",
        ["The colors on this spider are wild"],
      ],
    ])
      expect(normaliseStory(text, { ...frog, recent })).toBe("");
    // "Crazy how", "Pretty wild how", "So cool how" is one start.
    expect(
      normaliseStory("Pretty wild how this {name} sits on a leaf", {
        ...frog,
        recent: ["Crazy how round the eyes are on this tree frog"],
      }),
    ).toBe("");
    // The same species again isn't copied wording, and the trip's month is
    // a name he wrote.
    expect(
      normaliseStory("A {name} from Guayacán", {
        ...frog,
        shape: "short",
        recent: [
          "Saw this lemur leaf frog (Agalychnis lemur) on a leaf. Such a weird face",
        ],
      }),
    ).toBe("A {name} from Guayacán");
    expect(
      normaliseStory(
        "Such a weird {name}, Guayacán in August was full of them",
        {
          ...frog,
          grounding: "costa rica amphibian research center august 2026",
        },
      ),
    ).not.toBe("");
    // One sentence that opens "Saw a..." is the old template squeezed.
    expect(
      normaliseStory("Saw a {name} in Guayacán, those eyes are so weird", frog),
    ).toBe("");
    expect(
      normaliseStory("Such a weird {name}, those eyes almost glow", frog),
    ).not.toBe("");
  });

  it("keeps wishes, crazy and fur talk to once in a while", () => {
    const marmot = {
      named: true,
      name: "hoary marmot (Marmota caligata)",
      allowed: "Sauk Mountain",
      grounding: "Sauk Mountain rock",
      shape: "line",
    };
    const filler = (n) => Array.from({ length: n }, (_, i) => `Post ${i}`);
    for (const [text, recent] of [
      [
        "Would love to see this {name} on Sauk Mountain again",
        ["I'd love to climb that one day", ...filler(8)],
      ],
      [
        "Such a chill {name} on Sauk Mountain, it's crazy",
        ["They camouflage so well it's crazy", ...filler(3)],
      ],
      [
        "Such a round {name} on Sauk Mountain, that fur looks really soft",
        ["He looks so fluffy in the snow", ...filler(6)],
      ],
    ])
      expect(normaliseStory(text, { ...marmot, recent })).toBe("");
    // An animal's name isn't him talking about fur.
    expect(
      normaliseStory(
        "Such a round {name} on Sauk Mountain, that fur looks really soft",
        {
          ...marmot,
          recent: [
            "Saw this hairy woodpecker (Dryobates villosus) on a snag. Busy little bird",
          ],
        },
      ),
    ).not.toBe("");
  });

  it("names a view instead of describing how it's laid out", () => {
    const ridge = {
      allowed: "Olympic National Park Washington",
      grounding: "ridge snowy basin mountain",
    };
    for (const text of [
      "Managed to capture this ridge rising above a snowy basin. It has such a jagged top, hard to tell where you'd even walk",
      "I found this trail running along the ridge toward the headland. I love how the grass grows right to the edge",
      "Got this view of the fjord in the Olympics. I love how the mountains go right down to the water",
    ])
      expect(normaliseStory(text, ridge)).toBe("");
    // The North Cascades are a place, not a description.
    expect(
      normaliseStory(
        "This ridge in the North Cascades is so jagged. Hope to climb that one day",
        { allowed: "North Cascades Washington", grounding: "ridge" },
      ),
    ).not.toBe("");
  });

  it("never brings up people, and never the person in the frame", () => {
    const rainier = {
      allowed: "Mount Rainier Washington",
      grounding: "Mount Rainier rocky ridge with people on it",
    };
    for (const text of [
      "I got Mount Rainier from this rocky ridge. The people look so small, gives you an idea of how huge it is",
      "Saw Mount Rainier from the ridge with a hiker on it. So cool to see",
      "Mount Rainier from the ridge. So cool that everyone was out there",
    ])
      expect(normaliseStory(text, rainier)).toBe("");
    expect(
      normaliseStory("Man at Mount Rainier", { ...rainier, shape: "short" }),
    ).toBe("");
    const person = { ...rainier, person: true, shape: "line" };
    expect(
      normaliseStory(
        "He had such a good view of Mount Rainier up there",
        person,
      ),
    ).toBe("");
    expect(
      normaliseStory("Such a good spot to see Mount Rainier from", person),
    ).not.toBe("");
    // "On a sunny day" needs the record to show the sun.
    expect(
      normaliseStory("At Mount Rainier on a sunny day", {
        ...person,
        shape: "short",
      }),
    ).toBe("");
    expect(
      normaliseStory("At Mount Rainier on a sunny day", {
        ...person,
        shape: "short",
        grounding: `${rainier.grounding} under a clear blue sky`,
      }),
    ).toBe("At Mount Rainier on a sunny day");
    expect(
      personIn({ subject: "Person with a backpack", scene: "on wet rocks" }),
    ).toBe(true);
    expect(personIn({ subject: "Frog", scene: "held between fingers" })).toBe(
      false,
    );
  });

  it("fixes the grammar a model slips on", () => {
    expect(
      normaliseStory(
        "Captured this {name} carrying some stems. Looks like such a awkward thing to carry",
        { ...ani, grounding: "osprey stems" },
      ),
    ).toMatch(/such an awkward thing/);
    // A herd has no number in front of its name, and still isn't "this".
    expect(
      fillName(
        "Ran into this {name} grazing in Nagqu",
        "bharals (Pseudois nayaur)",
        {
          plural: true,
        },
      ),
    ).toBe("Ran into these bharals (Pseudois nayaur) grazing in Nagqu");
    for (const text of [
      "Such a cool looking {name}, so fluffy",
      "Funny how this {name} looks like it's falling apart at the edges",
    ])
      expect(
        normaliseStory(text, { ...ani, shape: "line", plural: true }),
      ).toBe("");
    for (const text of [
      "Crazy how much of this {name}'s face is beak",
      "So cool seeing this {name} flock grazing in Bijagua",
    ])
      expect(normaliseStory(text, { ...ani, shape: "line" })).toBe("");
  });

  it("mixes shapes, starts and emoji across a run of posts", () => {
    const shapes = [];
    const starts = [];
    const had = [];
    for (let i = 0; i < 600; i++) {
      const seed = `session/DSC${String(i).padStart(5, "0")}.JPG`;
      const shape = pickShape({ seed, appeal: 7 }, shapes);
      const start = pickStart({ seed, shape }, starts);
      const emoji = wantsEmoji({ seed, shape }, had);
      shapes.push(shape);
      starts.push(start || "subject");
      had.push(emoji);
    }
    const share = (list, value) =>
      list.filter((x) => x === value).length / list.length;
    expect(share(shapes, "short")).toBeGreaterThan(0.25);
    expect(share(shapes, "short")).toBeLessThan(0.4);
    expect(share(shapes, "line")).toBeGreaterThan(0.18);
    expect(share(had, true)).toBeGreaterThan(0.4);
    expect(share(had, true)).toBeLessThan(0.6);
    expect(share(starts, "came")).toBeLessThan(0.34);
    for (let i = 2; i < shapes.length; i++) {
      expect(shapes[i] === "short" && shapes[i - 1] === "short").toBe(false);
      expect(had[i] && had[i - 1] && had[i - 2]).toBe(false);
      expect(
        starts[i] === "came" &&
          (starts[i - 1] === "came" || starts[i - 2] === "came"),
      ).toBe(false);
    }
    // The same photo gets the same shape every run.
    expect(pickShape({ seed: "a/b.JPG", appeal: 7 }, ["story"])).toBe(
      pickShape({ seed: "a/b.JPG", appeal: 7 }, ["story"]),
    );
    // Less striking photos lean short, notes lean to a story.
    const count = (opts, value) =>
      Array.from({ length: 400 }, (_, i) =>
        pickShape({ seed: `x${i}`, ...opts }, ["story"]),
      ).filter((x) => x === value).length;
    expect(count({ appeal: 5 }, "short")).toBeGreaterThan(
      count({ appeal: 8 }, "short") * 2,
    );
    expect(count({ appeal: 7, notes: true }, "story")).toBeGreaterThan(
      count({ appeal: 7 }, "story"),
    );
    // A good wildlife photo is never cut down to its name; a view often is.
    expect(count({ appeal: 7, named: true }, "short")).toBe(0);
    expect(
      pickShape({ seed: "a/b.JPG", appeal: 8, named: true }, [
        "story",
        "line",
        "story",
        "line",
        "story",
      ]),
    ).not.toBe("short");
    expect(count({ appeal: 5, named: true }, "short")).toBeGreaterThan(0);
    expect(count({ appeal: 7, scene: true }, "short")).toBeGreaterThan(100);
  });

  it("leaves the emoji off when code says so", () => {
    expect(
      normaliseVoice(
        {
          options: [
            {
              text: "Caught this {name} mid-snack on a mossy post in Bijagua. Such a goofy beak, almost looks like a horn",
              emoji: "🐦",
            },
          ],
        },
        { ...ani, emoji: false },
      ),
    ).toEqual({
      text: "Caught this {name} mid-snack on a mossy post in Bijagua. Such a goofy beak, almost looks like a horn",
    });
  });

  it("has an offline stand-in that passes its own checks", () => {
    const items = [
      {
        id: "1",
        named: "Groove-billed ani",
        subject: "Bird",
        scene: "on a mossy post",
      },
      {
        id: "2",
        named: "",
        subject: "Waterfall",
        scene: "dropping into a pool",
      },
    ];
    const reply = mockVoice(items);
    expect(
      normaliseVoice(reply.items[0], { ...ani, grounding: "on a mossy post" })
        .text,
    ).toMatch(/\{name\}/);
    expect(normaliseVoice(reply.items[1], {}).text).toMatch(/waterfall/);
  });
});
