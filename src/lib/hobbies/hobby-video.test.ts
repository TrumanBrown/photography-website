import { describe, it, expect } from "vitest";
import { clockStart, embedSrc, playerState, EMBED_ORIGIN } from "./hobby-video";
import { SPECIES } from "./aquarium-species";
import aquarium from "../../content/hobbies/aquarium-keeping.json";

describe("clockStart", () => {
  it("is the seconds since local midnight", () => {
    expect(clockStart(new Date(2026, 9, 25, 0, 0, 0), 36012)).toBe(0);
    expect(clockStart(new Date(2026, 9, 25, 1, 2, 3), 36012)).toBe(3723);
  });

  it("wraps past the end of the video", () => {
    // 22:00 is 79,200 s, two lengths of 36,012 s plus 7,176.
    expect(clockStart(new Date(2026, 9, 25, 22, 0, 0), 36012)).toBe(7176);
  });

  it("starts at zero when the length is unknown", () => {
    expect(clockStart(new Date(2026, 9, 25, 15, 30, 0), 0)).toBe(0);
  });
});

describe("embedSrc", () => {
  it("uses the no-cookie player, muted and looping, when it autoplays", () => {
    const url = new URL(
      embedSrc("DVBmoPfp8n4", {
        start: 220.7,
        autoplay: true,
        origin: "https://example.com",
      }),
    );
    expect(url.origin).toBe(EMBED_ORIGIN);
    expect(url.pathname).toBe("/embed/DVBmoPfp8n4");
    const p = url.searchParams;
    expect(p.get("autoplay")).toBe("1");
    expect(p.get("mute")).toBe("1");
    expect(p.get("loop")).toBe("1");
    expect(p.get("playlist")).toBe("DVBmoPfp8n4");
    expect(p.get("start")).toBe("220");
    expect(p.get("enablejsapi")).toBe("1");
    expect(p.get("origin")).toBe("https://example.com");
  });

  it("keeps the sound when someone has to press play", () => {
    const p = new URL(embedSrc("DVBmoPfp8n4", { start: 0, autoplay: false }))
      .searchParams;
    expect(p.get("autoplay")).toBe("0");
    expect(p.get("mute")).toBe("0");
    expect(p.has("origin")).toBe(false);
  });
});

describe("playerState", () => {
  it("reads the state from the player's messages", () => {
    expect(
      playerState('{"event":"infoDelivery","info":{"playerState":1}}'),
    ).toBe(1);
    expect(
      playerState({ event: "infoDelivery", info: { playerState: 2 } }),
    ).toBe(2);
  });

  it("ignores anything else", () => {
    expect(playerState('{"event":"onReady"}')).toBeNull();
    expect(
      playerState('{"event":"infoDelivery","info":{"currentTime":3}}'),
    ).toBeNull();
    expect(playerState("not json")).toBeNull();
    expect(playerState(null)).toBeNull();
  });
});

describe("the aquarium video", () => {
  const video = aquarium.video;

  it("links only fish the picker has", () => {
    const ids = new Set(SPECIES.map((s) => s.id));
    for (const m of video.moments) expect(ids.has(m.species)).toBe(true);
  });

  it("puts every moment inside the video", () => {
    for (const m of video.moments) {
      expect(m.at).toBeGreaterThanOrEqual(0);
      expect(m.at).toBeLessThan(video.lengthSeconds);
    }
  });
});
