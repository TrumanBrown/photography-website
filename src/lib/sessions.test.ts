import { describe, it, expect } from "vitest";
import type { CollectionEntry } from "astro:content";
import {
  sortSessions,
  sessionSlug,
  formatDate,
  isIsoDate,
  formatExif,
  cameraName,
  splitSessionTitle,
  copyrightLine,
} from "./sessions";
import { siteConfig } from "../../site.config";

type Session = CollectionEntry<"sessions">;

function mk(id: string, date: string, order?: number): Session {
  return { id, data: { date, order } } as unknown as Session;
}

describe("sortSessions (orderThenDateDesc, the shipped default)", () => {
  it("is the configured policy", () => {
    expect(siteConfig.sessionsSort).toBe("orderThenDateDesc");
  });

  it("puts explicit order first ascending, then the rest by date descending", () => {
    const a = mk("a.json", "2025-01-01", 2);
    const b = mk("b.json", "2025-01-01", 1);
    const c = mk("c.json", "2024-06-01"); // no order, older
    const d = mk("d.json", "2026-06-01"); // no order, newer
    const sorted = sortSessions([a, c, d, b]).map((s) => s.id);
    expect(sorted).toEqual(["b.json", "a.json", "d.json", "c.json"]);
  });

  it("does not mutate the input array", () => {
    const arr = [mk("a.json", "2025-01-01", 1), mk("b.json", "2025-01-02", 2)];
    const snapshot = [...arr];
    sortSessions(arr);
    expect(arr).toEqual(snapshot);
  });
});

describe("sessionSlug", () => {
  it("strips the .json extension", () => {
    expect(sessionSlug(mk("china-spring-2025.json", "2025-01-01"))).toBe(
      "china-spring-2025",
    );
  });
});

describe("session dates", () => {
  it("formats a date-only value without shifting calendar days", () => {
    expect(formatDate("2026-04-18", "en-US")).toBe("April 18, 2026");
  });

  it("accepts only real ISO calendar dates", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
    expect(isIsoDate("2026-04-18T12:00:00Z")).toBe(false);
    expect(isIsoDate("April 18, 2026")).toBe(false);
  });
});

describe("formatExif", () => {
  it("joins the present fields with a middot", () => {
    const exif = {
      camera: "ILCE-7M4",
      lens: "FE 70-200",
      focalLength: "135mm",
    } as unknown as Parameters<typeof formatExif>[0];
    expect(formatExif(exif)).toBe("Sony a7 IV · FE 70-200 · 135mm");
  });

  it("names cameras the way people do, not by Sony's model code", () => {
    expect(cameraName("ILCE-6700")).toBe("Sony a6700");
    expect(cameraName("ILCE-7M4")).toBe("Sony a7 IV");
    expect(cameraName("ILCE-7RM5")).toBe("Sony a7R V");
    expect(cameraName("ZV-E10")).toBe("Sony ZV-E10");
    expect(cameraName("iPhone 16 Pro")).toBe("iPhone 16 Pro");
    expect(cameraName("Canon EOS R100")).toBe("Canon EOS R100");
  });

  it("returns an empty string when there is no exif", () => {
    expect(formatExif(undefined)).toBe("");
  });
});

describe("copyrightLine", () => {
  it("names the owner and asserts the rights", () => {
    const line = copyrightLine();
    expect(line.startsWith("©")).toBe(true);
    expect(line).toContain(siteConfig.ownerName);
    expect(line).toContain("All rights reserved");
  });
});

describe('splitSessionTitle', () => {
  it('separates the period from a comma-written title', () => {
    expect(splitSessionTitle('El Zota Biological Station, Costa Rica, September 2026')).toEqual({
      label: 'El Zota Biological Station, Costa Rica',
      period: 'September 2026',
    });
  });

  it('still understands the older em-dashed titles', () => {
    expect(splitSessionTitle('Gunn Peak, Washington — June 2026')).toEqual({
      label: 'Gunn Peak, Washington',
      period: 'June 2026',
    });
  });

  it('leaves a title alone when it does not end in a month and year', () => {
    expect(splitSessionTitle('Tidepools, Spring 2026')).toEqual({
      label: 'Tidepools, Spring 2026',
      period: '',
    });
    expect(splitSessionTitle('Olympic winter')).toEqual({
      label: 'Olympic winter',
      period: '',
    });
  });
});
