import { describe, expect, it } from "vitest";
import { SECURITY_TXT_DAYS, securityTxt } from "./security-txt";

const field = (text: string, name: string) =>
  text
    .split("\n")
    .find((line) => line.startsWith(`${name}: `))
    ?.slice(name.length + 2);

describe("securityTxt", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const text = securityTxt("https://example.com", now);

  it("has the fields RFC 9116 requires", () => {
    expect(field(text, "Contact")).toMatch(
      /^https:\/\/github\.com\/.+\/security\/advisories\/new$/,
    );
    expect(field(text, "Expires")).toBeDefined();
  });

  it("expires a fixed time after the build, under a year", () => {
    const expires = new Date(field(text, "Expires")!);
    const days = (expires.getTime() - now.getTime()) / 86_400_000;
    expect(days).toBe(SECURITY_TXT_DAYS);
    expect(days).toBeLessThan(365);
  });

  it("names its own address as canonical", () => {
    expect(field(text, "Canonical")).toBe(
      "https://example.com/.well-known/security.txt",
    );
  });

  it("ends with a newline and has no blank fields", () => {
    expect(text.endsWith("\n")).toBe(true);
    for (const line of text.trim().split("\n"))
      expect(line).toMatch(/^[A-Za-z-]+: \S/);
  });
});
