// Opens the resume the way a browser would. The PDF file, the table and the
// network lookup are fakes, so nothing reaches Azure.

const Module = require("node:module");
const fs = require("node:fs");

const BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0";
const PDF = Buffer.from("%PDF-1.7 fake");

const rows = [];
let release;

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
      lookupPlace: () =>
        new Promise((resolve) => {
          release = () => resolve({ org: "Example ISP", country: "US" });
        }),
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

describe("/api/resume", () => {
  it("serves the PDF without waiting for the open to be counted", async () => {
    const context = { log: Object.assign(() => {}, { warn: () => {} }) };
    const served = resume(context, {
      method: "GET",
      headers: { "user-agent": BROWSER, host: "trumanbrown.com" },
      query: { via: "resume" },
    }).then(() => "served");
    const waited = new Promise((resolve) =>
      setTimeout(() => resolve("waited"), 200),
    );

    expect(await Promise.race([served, waited])).toBe("served");
    expect(context.res.status).toBe(200);
    expect(context.res.body).toBe(PDF);
    expect(rows).toHaveLength(0);

    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    await vi.waitFor(() => expect(rows).toHaveLength(1));
    expect(rows[0]).toMatchObject({
      type: "pdf",
      via: "resume",
      org: "Example ISP",
    });
  });
});
