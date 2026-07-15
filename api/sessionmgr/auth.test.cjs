const { allowedUsers, principalUserId } = require("./auth");

describe("admin authentication helpers", () => {
  it("fails closed when the setting is absent or empty", () => {
    expect([...allowedUsers(undefined)]).toEqual([]);
    expect([...allowedUsers("")]).toEqual([]);
  });

  it("normalizes usernames and discards empty comma-separated entries", () => {
    expect([...allowedUsers(" TrumanBrown,OtherUser, ,")]).toEqual([
      "trumanbrown",
      "otheruser",
    ]);
    expect(allowedUsers("TrumanBrown,").has("")).toBe(false);
  });

  it("decodes and normalizes a valid SWA principal", () => {
    const header = Buffer.from(
      JSON.stringify({
        identityProvider: "github",
        userDetails: "TrumanBrown",
      }),
    ).toString("base64");
    expect(principalUserId(header)).toBe("trumanbrown");
  });

  it("rejects a matching user detail from a different identity provider", () => {
    const header = Buffer.from(
      JSON.stringify({ identityProvider: "aad", userDetails: "trumanbrown" }),
    ).toString("base64");
    expect(principalUserId(header)).toBe("");
  });

  it("maps absent or malformed principals to the denied empty identity", () => {
    expect(principalUserId(undefined)).toBe("");
    expect(principalUserId("not base64 json")).toBe("");
    expect(principalUserId(Buffer.from("{}").toString("base64"))).toBe("");
  });
});
