import { describe, expect, it } from "vitest";
import { openCommand } from "./open.mjs";

describe("opening a preview page", () => {
  it("hands a WSL file to Windows by its network path", () => {
    expect(
      openCommand("/home/me/site/.cache/social/preview.html", {
        WSL_DISTRO_NAME: "Ubuntu",
      }),
    ).toEqual([
      "explorer.exe",
      ["\\\\wsl$\\Ubuntu\\home\\me\\site\\.cache\\social\\preview.html"],
    ]);
  });

  it("uses the platform's own opener elsewhere", () => {
    expect(openCommand("/tmp/p.html", {}, "darwin")).toEqual([
      "open",
      ["/tmp/p.html"],
    ]);
    expect(openCommand("/tmp/p.html", {}, "linux")).toEqual([
      "xdg-open",
      ["/tmp/p.html"],
    ]);
  });
});
