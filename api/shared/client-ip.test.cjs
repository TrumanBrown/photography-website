const { clientIp } = require("./client-ip");

// Headers as a managed function on Static Web Apps gets them, seen on a
// preview environment on 2026-11-12: whatever the browser sent comes first,
// then the edge appends the visitor, then App Service's front end appends the
// edge and names it in Client-IP.
const EDGE = "40.64.113.204:46632";

function request(forwarded, extra = {}, edge = EDGE) {
  return {
    headers: {
      ...(forwarded === undefined ? {} : { "x-forwarded-for": forwarded }),
      ...(edge ? { "client-ip": edge } : {}),
      ...extra,
    },
  };
}

describe("clientIp", () => {
  it("takes the address the edge saw and removes its port", () => {
    expect(clientIp(request(`198.51.100.23:62828, ${EDGE}`))).toBe(
      "198.51.100.23",
    );
  });

  it("ignores a forged X-Forwarded-For", () => {
    expect(clientIp(request(`203.0.113.7, 198.51.100.23:62921, ${EDGE}`))).toBe(
      "198.51.100.23",
    );
    expect(
      clientIp(request(`203.0.113.7, 192.0.2.9, 198.51.100.23:62856, ${EDGE}`)),
    ).toBe("198.51.100.23");
  });

  it("never reads the other client IP headers a browser can send", () => {
    expect(
      clientIp(
        request(`198.51.100.23:62847, ${EDGE}`, {
          "x-azure-clientip": "203.0.113.8",
          "x-azure-socketip": "203.0.113.9",
          "x-client-ip": "203.0.113.10",
          "x-real-ip": "203.0.113.12",
          "true-client-ip": "203.0.113.15",
          forwarded: "for=203.0.113.13",
        }),
      ),
    ).toBe("198.51.100.23");
  });

  it("takes the last entry when no edge is named", () => {
    expect(clientIp(request("203.0.113.7, 198.51.100.23:1", {}, ""))).toBe(
      "198.51.100.23",
    );
  });

  it("preserves a bare IPv6 address", () => {
    expect(clientIp(request(`2001:db8:85a3::8a2e:370:7334, ${EDGE}`))).toBe(
      "2001:db8:85a3::8a2e:370:7334",
    );
  });

  it("removes brackets and a port from an IPv6 endpoint", () => {
    expect(clientIp(request(`[2001:db8::1]:443, ${EDGE}`))).toBe("2001:db8::1");
  });

  it("returns a stable fallback when the proxy header is absent", () => {
    expect(clientIp(request())).toBe("unknown");
  });
});
