import { describe, expect, it } from "vitest";
import {
  firstYear,
  LINKS,
  monthLabel,
  periodLabel,
  PROJECTS,
  SCHOOL,
  SKILLS,
  SUMMARY,
  WEEKDAYS,
  WEEKENDS,
  WORK,
} from "./about";

const everything = () =>
  [
    WEEKENDS,
    WEEKDAYS,
    SUMMARY,
    ...WORK.flatMap((job) => [job.role, job.org, job.where, ...job.lines]),
    ...SCHOOL.lines,
    ...SKILLS.flat(),
    ...PROJECTS.flatMap((p) => [p.name, p.blurb]),
  ].join("\n");

describe("about me", () => {
  it("never carries my phone number or personal email", () => {
    const text = everything() + JSON.stringify(LINKS);
    expect(text).not.toMatch(/\d{3}[-. ]\d{3}[-. ]\d{4}/);
    expect(text).not.toMatch(/@gmail|mailto:/i);
  });

  it("has no em dashes or semicolons in anything a visitor reads", () => {
    expect(everything()).not.toMatch(/[—;]/);
  });

  it("lists jobs newest first with real months", () => {
    const starts = WORK.map((job) => job.from);
    expect([...starts].sort().reverse()).toEqual(starts);
    for (const job of WORK) {
      expect(() => monthLabel(job.from)).not.toThrow();
      if (job.to) expect(job.to >= job.from).toBe(true);
    }
    expect(WORK.filter((job) => job.to === null)).toHaveLength(1);
  });

  it("shows exactly the three pinned projects", () => {
    expect(PROJECTS.map((p) => p.repo)).toEqual([
      "photography-website",
      "cozy-vibe-vids-public",
      "balcFlights-LED",
    ]);
    expect(new Set(PROJECTS.map((p) => p.media)).size).toBe(3);
  });

  it("writes dates the way the page shows them", () => {
    expect(monthLabel("2025-09")).toBe("Sep 2025");
    expect(periodLabel("2025-09", null)).toBe("Since Sep 2025");
    expect(periodLabel("2024-02", "2025-09")).toBe("Feb 2024 to Sep 2025");
    expect(() => monthLabel("2025-13")).toThrow();
    expect(firstYear(WORK)).toBe(2021);
  });
});
