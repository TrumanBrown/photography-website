import { gzipSync } from "node:zlib";
import {
  blobName,
  isMaxMindGzip,
  monthKey,
  previousMonth,
  staleBlobs,
} from "./sync-geo-db.mjs";

describe("sync-geo-db", () => {
  it("names months in UTC", () => {
    expect(monthKey(new Date("2026-11-30T23:59:59Z"))).toBe("2026-11");
    expect(monthKey(new Date("2026-12-01T00:00:00Z"))).toBe("2026-12");
  });

  it("steps back across a year", () => {
    expect(previousMonth("2026-11")).toBe("2026-10");
    expect(previousMonth("2027-01")).toBe("2026-12");
  });

  it("names the blobs under geo/", () => {
    expect(blobName("city", "2026-11")).toBe(
      "geo/dbip-city-lite-2026-11.mmdb.gz",
    );
    expect(blobName("asn", "2026-11")).toBe(
      "geo/dbip-asn-lite-2026-11.mmdb.gz",
    );
  });

  it("recognises a gzipped MaxMind database", () => {
    const marker = Buffer.from([
      0xab,
      0xcd,
      0xef,
      ...Buffer.from("MaxMind.com"),
    ]);
    const db = Buffer.concat([
      Buffer.alloc(1_100_000),
      marker,
      Buffer.alloc(200),
    ]);
    expect(isMaxMindGzip(gzipSync(db))).toBe(true);
    expect(isMaxMindGzip(gzipSync(Buffer.alloc(1_100_000)))).toBe(false);
    expect(isMaxMindGzip(Buffer.from("<html>not found</html>"))).toBe(false);
  });

  it("deletes only old database files", () => {
    const names = [
      "geo/current.json",
      "geo/dbip-city-lite-2026-09.mmdb.gz",
      "geo/dbip-asn-lite-2026-09.mmdb.gz",
      "geo/dbip-city-lite-2026-10.mmdb.gz",
      "geo/dbip-asn-lite-2026-10.mmdb.gz",
      "geo/dbip-city-lite-2026-11.mmdb.gz",
      "geo/dbip-asn-lite-2026-11.mmdb.gz",
    ];
    expect(staleBlobs(names, ["2026-11", "2026-10"])).toEqual([
      "geo/dbip-city-lite-2026-09.mmdb.gz",
      "geo/dbip-asn-lite-2026-09.mmdb.gz",
    ]);
  });
});
