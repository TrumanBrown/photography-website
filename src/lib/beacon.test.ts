import { describe, expect, it } from "vitest";
import { cleanCopy, cleanVia, createVisibleTimer } from "./beacon";
import { jobSection, projectName, railName, trackLabel } from "./track-names";
import { PROJECTS, WORK } from "./about";

describe("createVisibleTimer", () => {
  it("counts only the time it's switched on", () => {
    let now = 0;
    const timer = createVisibleTimer(() => now);
    timer.set(true);
    now = 5000;
    timer.set(false);
    now = 60_000;
    expect(timer.total()).toBe(5000);
    timer.set(true);
    now = 62_000;
    expect(timer.total()).toBe(7000);
  });

  it("ignores repeated calls", () => {
    let now = 0;
    const timer = createVisibleTimer(() => now);
    timer.set(true);
    now = 1000;
    timer.set(true);
    now = 3000;
    timer.set(false);
    timer.set(false);
    expect(timer.total()).toBe(3000);
  });
});

describe("cleanVia", () => {
  it("keeps short tags and drops the rest", () => {
    expect(cleanVia("resume")).toBe("resume");
    expect(cleanVia("LinkedIn")).toBe("linkedin");
    expect(cleanVia(null)).toBe("");
    expect(cleanVia("a b")).toBe("");
  });
});

describe("cleanCopy", () => {
  it("makes one short line", () => {
    expect(cleanCopy("  Led\n\nmigration   work ")).toBe("Led migration work");
    expect(cleanCopy("x".repeat(300))).toHaveLength(100);
  });
});

describe("track names", () => {
  const NAME = /^[a-z0-9][a-z0-9:._-]{0,59}$/;

  it("fit the endpoint's pattern", () => {
    for (const job of WORK) expect(jobSection(job)).toMatch(NAME);
    for (const project of PROJECTS) {
      for (const part of [
        undefined,
        "name",
        "code",
        "readme",
        "youtube",
        "play",
        "session",
        "pause",
      ]) {
        expect(projectName(project, part)).toMatch(NAME);
      }
    }
    expect(railName("iNaturalist")).toBe("rail:inaturalist");
  });

  it("are unique across jobs", () => {
    const names = WORK.map(jobSection);
    expect(new Set(names).size).toBe(names.length);
  });

  it("turn back into words", () => {
    expect(trackLabel(jobSection(WORK[0]))).toBe(
      `${WORK[0].org}, ${WORK[0].role}`,
    );
    expect(trackLabel(projectName(PROJECTS[0], "code"))).toBe(
      `${PROJECTS[0].name}: Code on GitHub`,
    );
    expect(trackLabel("rail:resume-pdf")).toBe("Resume (PDF) in the rail");
    expect(trackLabel(railName("LinkedIn"))).toBe("LinkedIn in the rail");
    expect(trackLabel("something-new")).toBe("something-new");
  });
});
