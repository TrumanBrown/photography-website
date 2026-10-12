import { describe, expect, it } from "vitest";
import {
  HIS_REACTIONS,
  loadVoiceGuide,
  normaliseComment,
  normaliseVoice,
  voicePrompt,
} from "./voice.mjs";
import { compileLexicon } from "./text.mjs";
import { captionFor } from "./website.mjs";

const fact =
  "Groove-billed anis lay their eggs in one communal nest, and all group members incubate the eggs and care for the young.";

describe("post voice", () => {
  it("keeps reactions like Truman's own", () => {
    for (const c of [
      "Such an interesting, unique beak on it.",
      "I can't believe how they even mimic the punches and holes in natural leaves as well.",
      "I love when the wind dies down and allows these small ponds to reflect all that's around them.",
    ])
      expect(normaliseComment(c, { fact })).toBe(c);
    expect(normaliseComment("such a strange little face", { fact })).toBe(
      "Such a strange little face.",
    );
    expect(normaliseComment("I love those orange toes..", { fact })).toBe(
      "I love those orange toes.",
    );
  });

  it("wants a reaction, not a description of the photo", () => {
    for (const c of [
      "Yellow spots dot the brown abdomen.",
      "Snow covers broad patches of the surrounding slabs.",
      "The bigger one's coming out of the water.",
      "I love how that tail takes a bend to the left.",
    ])
      expect(normaliseComment(c, { fact })).toBe("");
  });

  it("drops reactions that tell a story, add facts, ask, repeat or sound like AI", () => {
    const lexicon = compileLexicon(["Smooth-billed Ani"]);
    for (const c of [
      "I waited two hours for this one.",
      "Finally caught one in the open.",
      "We found it on the way back to the car.",
      "They can eat 30 insects a day.",
      "Isn't that beak something?",
      "Truly a testament to nature's design.",
      "They lay their eggs in one communal nest, which still amazes me.",
      "It looks a lot like a smooth-billed ani up close.",
      "Easily my favourite bird from Monteverde.",
      "Nice.",
    ])
      expect(
        normaliseComment(c, { fact, lexicon, allowed: "Bijagua, Costa Rica" }),
      ).toBe("");
  });

  it("checks the first line like the website's, and keeps the reaction apart", () => {
    expect(
      normaliseVoice(
        {
          action: "Munching on an insect on a mossy post.",
          comment: "Such an interesting, unique beak on it.",
        },
        { named: true, fact },
      ),
    ).toEqual({
      action: "munching on an insect on a mossy post",
      comment: "Such an interesting, unique beak on it.",
    });
    expect(
      normaliseVoice(
        {
          line: "Mount Baker looming over a small, reflective alpine pond against a blue sky",
          comment: "I waited hours for the wind to stop.",
        },
        { named: false, fact },
      ),
    ).toEqual({
      text: "Mount Baker looming over a small, reflective alpine pond",
    });
  });

  it("takes the second reaction when the first breaks a rule, and never a phrase used on another post", () => {
    const reply = {
      action: "munching on an insect",
      comments: [
        "Those orange toes really stand out against the green leaf.",
        "Such an interesting, unique beak on it.",
      ],
    };
    expect(normaliseVoice(reply, { named: true, fact }).comment).toBe(
      "Such an interesting, unique beak on it.",
    );
    expect(
      normaliseVoice(reply, {
        named: true,
        fact,
        avoid: ["What an interesting, unique beak on that heron."],
      }).comment,
    ).toBeUndefined();
    // His own reactions are examples, never to be copied onto another post.
    expect(
      normaliseComment("Such an interesting, unique beak on it.", {
        avoid: HIS_REACTIONS,
      }),
    ).toBe("");
    // Saying the first line again.
    expect(
      normaliseComment("Low clouds hide the peaks completely.", {
        line: "Hairpin roads under low clouds",
      }),
    ).toBe("");
    // The same praise on a third post.
    const avoid = [
      "Such an impressive set of tails.",
      "I find that ridged head impressive.",
    ];
    expect(normaliseComment("Those claws are impressive.", { avoid })).toBe("");
    expect(normaliseComment("Those claws look so sharp to me.", {})).toBe("");
  });

  it("reads the skill's rules and examples into the prompt, not its maintainer notes", () => {
    const guide = loadVoiceGuide();
    expect(guide).toMatch(/^## How a post reads/);
    expect(guide).toContain("munching on an insect on a mossy post");
    expect(guide).toContain("## When unsure");
    expect(guide).not.toContain("## For maintainers");
    const prompt = voicePrompt(
      [
        {
          id: "1",
          named: "Groove-billed ani",
          subject: "Bird",
          scene: "perched on a mossy post holding an insect",
          conditions: "",
          place: "Bijagua, Costa Rica",
          description: "A black bird with a thick bill holds an insect.",
          fact,
        },
      ],
      guide,
    );
    expect(prompt).toContain('named "Groove-billed ani"');
    expect(prompt).toContain(`fun fact "${fact}"`);
    expect(prompt).toContain("Such an interesting, unique beak on it.");
  });

  it("falls back to the plain first line when the voiced one fails the caption checks", () => {
    const session = {
      slug: "mt-baker-fall-2026",
      title: "Yellow Aster Butte, Washington, October 2026",
      location: "North Cascades, Washington",
    };
    const analysis = {
      group: "mountain",
      subject: "Mount Baker",
      scene: "rising beyond a still pond",
      conditions: "",
      idCheck: "n/a",
    };
    // Mount Shuksan isn't written anywhere for this session.
    expect(
      captionFor({
        analysis,
        session,
        line: { text: "Mount Shuksan looming over a pond" },
        strict: true,
      }),
    ).toBe("");
    expect(
      captionFor({
        analysis,
        session,
        line: {
          text: "Mount Baker looming over a small, reflective alpine pond",
        },
        strict: true,
      }),
    ).toBe(
      "Mount Baker looming over a small, reflective alpine pond, Yellow Aster Butte",
    );
  });
});
