const { clientIp } = require("./client-ip");

function request(forwarded) {
  return {
    headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded },
  };
}

describe("clientIp", () => {
  it("uses the first forwarded IPv4 address and removes its port", () => {
    expect(clientIp(request("203.0.113.10:4321, 10.0.0.1"))).toBe(
      "203.0.113.10",
    );
  });

  it("preserves a bare IPv6 address", () => {
    expect(clientIp(request("2001:db8:85a3::8a2e:370:7334"))).toBe(
      "2001:db8:85a3::8a2e:370:7334",
    );
  });

  it("removes brackets and a port from an IPv6 endpoint", () => {
    expect(clientIp(request("[2001:db8::1]:443, 10.0.0.1"))).toBe(
      "2001:db8::1",
    );
  });

  it("returns a stable fallback when the proxy header is absent", () => {
    expect(clientIp(request())).toBe("unknown");
  });
});
