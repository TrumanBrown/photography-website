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
  pickEmoji,
  storyOpener,
  voicePrompt,
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
    // as long as the words after it differ.
    expect(
      normaliseStory(
        "I spotted this {name} munching on some insect in Bijagua. Such a goofy beak, almost looks like a horn",
        { ...ani, recent: ["I found this tiny frog on a leaf. So cool"] },
      ),
    ).not.toBe("");
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
    expect(ownOpening("Looks like he just finished a big meal.")).toEqual({
      text: "Looks like he just finished a big meal",
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
    expect(normaliseVoice({ options: [{ text: "Nice." }] }, ani)).toEqual({});
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
