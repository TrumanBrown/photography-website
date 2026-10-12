import { describe, expect, it } from "vitest";
import { escapeHtml, jsonForScript } from "./html";

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

describe("jsonForScript", () => {
  it("can't close the script block it sits in", () => {
    const value = {
      name: "Night walk</script><script>alert(1)</script>",
      caption: "<!-- a comment opener",
    };
    const json = jsonForScript(value);
    expect(json).not.toMatch(/<\/script/i);
    expect(json).not.toContain("<!--");
    expect(JSON.parse(json)).toEqual(value);
  });

  it("escapes the line separators JavaScript treats as newlines", () => {
    const json = jsonForScript({ text: "a\u2028b\u2029c" });
    expect(json).toBe('{"text":"a\\u2028b\\u2029c"}');
    expect(JSON.parse(json)).toEqual({ text: "a\u2028b\u2029c" });
  });

  it("matches JSON.stringify for ordinary text", () => {
    const value = { "@type": "Person", name: "Spring trip · 12 photos" };
    expect(jsonForScript(value)).toBe(JSON.stringify(value));
  });
});
