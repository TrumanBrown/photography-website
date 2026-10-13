import { describe, expect, it } from "vitest";
import {
  LICENSING_ID,
  PRINTS_PATH,
  licenseFields,
  printInquiry,
} from "./prints";

describe("licenseFields", () => {
  it("points both fields at the licensing section of the prints page", () => {
    const fields = licenseFields("https://example.com", true);
    expect(fields).toEqual({
      license: `https://example.com${PRINTS_PATH}#${LICENSING_ID}`,
      acquireLicensePage: `https://example.com${PRINTS_PATH}#${LICENSING_ID}`,
    });
  });

  it("adds nothing when prints are off", () => {
    expect(licenseFields("https://example.com", false)).toEqual({});
  });

  it("accepts a URL origin, as Astro.site is", () => {
    const fields = licenseFields(new URL("https://example.com/"), true);
    expect(fields.license).toBe("https://example.com/prints/#licensing");
  });
});

describe("printInquiry", () => {
  it("names the photo by its own address", () => {
    const url = "https://example.com/sessions/tapir-valley/#photo-12";
    const message = printInquiry(url);
    expect(message).toContain(url);
    expect(message.startsWith("I'd like to ask about a print")).toBe(true);
  });

  it("stays in house style: no em dashes and no curly apostrophes", () => {
    const message = printInquiry("https://example.com/");
    expect(message).not.toMatch(/[\u2014\u2019]/);
  });
});
