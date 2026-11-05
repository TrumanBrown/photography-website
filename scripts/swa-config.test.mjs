import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* Static Web Apps refuses to deploy a config with two rules for the same
   route, and it counts "/about" and "/about/" as the same one. Nothing local
   catches that, so a deploy failed on it (2026-11-05). */
const config = JSON.parse(
  readFileSync(new URL("../staticwebapp.config.json", import.meta.url), "utf8"),
);

describe("staticwebapp.config.json", () => {
  it("has no two routes that differ only by a trailing slash or case", () => {
    const seen = new Map();
    for (const rule of config.routes ?? []) {
      const key = rule.route.toLowerCase().replace(/\/+$/, "") || "/";
      expect(seen.get(key), `${rule.route} repeats ${seen.get(key)}`).toBe(
        undefined,
      );
      seen.set(key, rule.route);
    }
  });

  it("sends About me to the front door's weekdays side", () => {
    const about = config.routes.find((rule) => rule.route === "/about");
    expect(about).toMatchObject({ redirect: "/#weekdays" });
  });
});
