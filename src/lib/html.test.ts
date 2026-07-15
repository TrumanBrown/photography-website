import { describe, expect, it } from "vitest";
import { escapeHtml } from "./html";

describe("escapeHtml", () => {
  it("escapes text and quoted attribute delimiters", () => {
    expect(escapeHtml(`A & <tag data-x="quoted">'value'</tag>`)).toBe(
      "A &amp; &lt;tag data-x=&quot;quoted&quot;&gt;&#39;value&#39;&lt;/tag&gt;",
    );
  });

  it("leaves ordinary display text unchanged", () => {
    expect(escapeHtml("Spring trip · 12 photos")).toBe(
      "Spring trip · 12 photos",
    );
  });
});
