// Opens the resume the way a browser would. The PDF file, the table and the
// network lookup are fakes, so nothing reaches Azure.

const Module = require("node:module");
const fs = require("node:fs");

const BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0";
const PDF = Buffer.from("%PDF-1.7 fake");
// The count starts a second after the response.
const WAIT = { timeout: 3000 };

const rows = [];
const lookups = [];
const release = () =>
  lookups
    .splice(0)
    .forEach((resolve) => resolve({ org: "Example ISP", country: "US" }));

class FakeTableClient {
  static fromConnectionString() {
    return new FakeTableClient();
  }
  async createEntity(entity) {
    rows.push(entity);
  }
}

const fakeFs = {
  ...fs,
  readFileSync: (file, ...rest) =>
    String(file).endsWith("resume.pdf") ? PDF : fs.readFileSync(file, ...rest),
};
const load = Module._load;
const geoService = require.resolve("../shared/geo-service");
const shared = ["../shared/rows", "./index"].map((name) =>
  require.resolve(name),
);
let savedConnection;
let resume;

beforeAll(() => {
  savedConnection = process.env.AZURE_STORAGE_CONNECTION_STRING;
  process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
  Module._load = function (request, ...rest) {
    if (request === "@azure/data-tables")
      return { TableClient: FakeTableClient };
    if (request === "node:fs") return fakeFs;
    return load.call(this, request, ...rest);
  };
  // A cold lookup: it answers only when the test lets it.
  require.cache[geoService] = {
    id: geoService,
    filename: geoService,
    loaded: true,
    exports: {
      lookupPlace: () => new Promise((resolve) => lookups.push(resolve)),
    },
  };
  for (const file of shared) delete require.cache[file];
  resume = require("./index");
});

afterAll(() => {
  Module._load = load;
  delete require.cache[geoService];
  for (const file of shared) delete require.cache[file];
  if (savedConnection === undefined)
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  else process.env.AZURE_STORAGE_CONNECTION_STRING = savedConnection;
});

function open(headers = {}) {
  const context = { log: Object.assign(() => {}, { warn: () => {} }) };
  const done = resume(context, {
    method: "GET",
    headers: { "user-agent": BROWSER, host: "trumanbrown.com", ...headers },
    query: { via: "resume" },
  });
  return { context, done };
}

beforeEach(() => {
  rows.length = 0;
  lookups.length = 0;
});

describe("/api/resume", () => {
  it("serves the PDF without waiting for the open to be counted", async () => {
    const { context, done } = open();
    const served = done.then(() => "served");
    const waited = new Promise((resolve) =>
      setTimeout(() => resolve("waited"), 200),
    );

    expect(await Promise.race([served, waited])).toBe("served");
    expect(context.res.status).toBe(200);
    expect(context.res.body).toBe(PDF);
    expect(rows).toHaveLength(0);

    await vi.waitFor(() => expect(lookups).toHaveLength(1), WAIT);
    release();
    await vi.waitFor(() => expect(rows).toHaveLength(1));
    expect(rows[0]).toMatchObject({
      type: "pdf",
      via: "resume",
      org: "Example ISP",
    });
  });

  it("answers a repeat open with 304 and still counts it", async () => {
    const first = open();
    await first.done;
    const { ETag } = first.context.res.headers;
    expect(ETag).toMatch(/^"[\w-]+"$/);

    const again = open({ "if-none-match": `W/${ETag}` });
    await again.done;
    expect(again.context.res.status).toBe(304);
    expect(again.context.res.body).toBeUndefined();

    await vi.waitFor(() => expect(lookups).toHaveLength(2), WAIT);
    release();
    await vi.waitFor(() => expect(rows).toHaveLength(2));
  });

  it("serves another site's frame or image tag but doesn't count it as an open", async () => {
    for (const dest of ["iframe", "image"]) {
      const { context, done } = open({
        "sec-fetch-dest": dest,
        "sec-fetch-site": "cross-site",
      });
      await done;
      expect(context.res.status).toBe(200);
    }
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(lookups).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });
});
