// Sends beacons through /api/track the way a browser would. The tables, the
// network lookup and the email client are fakes put in Node's module cache, so
// nothing reaches Azure and no email goes out.

const ENV = {
  AZURE_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
  CONTACT_EMAIL_CONNECTION_STRING:
    "endpoint=https://acs.example/;accesskey=a2V5",
  CONTACT_EMAIL_FROM: "DoNotReply@example.azurecomm.net",
  CONTACT_NOTIFY_TO: "me@example.com",
};
const BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0";

const tables = new Map();
const sent = [];
let place = null;

class FakeTableClient {
  static fromConnectionString(_connection, name) {
    if (!tables.has(name)) tables.set(name, new Map());
    return new FakeTableClient(tables.get(name));
  }
  constructor(rows) {
    this.rows = rows;
  }
  async createTable() {}
  async createEntity(entity) {
    const key = `${entity.partitionKey}/${entity.rowKey}`;
    if (this.rows.has(key))
      throw Object.assign(new Error("exists"), { statusCode: 409 });
    this.rows.set(key, { ...entity, etag: "1" });
  }
  async getEntity(partitionKey, rowKey) {
    const row = this.rows.get(`${partitionKey}/${rowKey}`);
    if (!row) throw Object.assign(new Error("missing"), { statusCode: 404 });
    return row;
  }
  async updateEntity(entity) {
    this.rows.set(`${entity.partitionKey}/${entity.rowKey}`, {
      ...entity,
      etag: String(Number(entity.etag) + 1),
    });
  }
  async *listEntities({ queryOptions }) {
    const partition = /PartitionKey eq '([^']+)'/.exec(queryOptions.filter)[1];
    const pvid = /pvid eq '([^']+)'/.exec(queryOptions.filter)[1];
    for (const row of this.rows.values()) {
      if (
        row.partitionKey === partition &&
        row.pvid === pvid &&
        row.type === "pv"
      )
        yield row;
    }
  }
}

class FakeEmailClient {
  async beginSend(message) {
    sent.push(message);
    return { pollUntilDone: async () => ({ status: "Succeeded" }) };
  }
}

const stubbed = [];
function stub(request, exports) {
  const file = require.resolve(request);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
  stubbed.push(file);
}

const saved = {};
let track;

beforeAll(() => {
  for (const [name, value] of Object.entries(ENV)) {
    saved[name] = process.env[name];
    process.env[name] = value;
  }
  stub("@azure/data-tables", { TableClient: FakeTableClient });
  stub("@azure/communication-email", { EmailClient: FakeEmailClient });
  stub("../shared/geo-service", {
    lookupPlace: async () => place,
    warmGeo: async () => {},
  });
  delete require.cache[require.resolve("./index")];
  track = require("./index");
});

afterAll(() => {
  for (const file of stubbed) delete require.cache[file];
  delete require.cache[require.resolve("./index")];
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

beforeEach(() => {
  tables.clear();
  sent.length = 0;
});

async function beacon(body) {
  const context = { log: Object.assign(() => {}, { warn: () => {} }) };
  await track(context, {
    method: "POST",
    headers: {
      "user-agent": BROWSER,
      host: "trumanbrown.com",
      "x-forwarded-for": "203.0.113.10:4321",
    },
    body,
  });
  return context.res;
}

function whole(email) {
  return `${email.content.subject}\n${email.content.plainText}`;
}

describe("/api/track resume alerts", () => {
  it("emails counts for a resume visit, never the copied text or its link", async () => {
    place = {
      org: "Comcast Cable Communications, LLC",
      orgKind: "home",
      city: "Seattle",
      region: "Washington",
      country: "US",
    };
    const copied = "SEC test, see https://example.com/login";
    await beacon({
      type: "pv",
      sid: "s1",
      pvid: "pv1",
      path: "/",
      via: "resume",
    });
    await beacon({
      type: "ev",
      sid: "s1",
      pvid: "pv1",
      events: [{ k: "copy", v: copied, s: "summary", t: 1200 }],
    });

    expect(sent).toHaveLength(1);
    const email = whole(sent[0]);
    expect(email).toContain("From: a link in your resume");
    expect(email).toContain("So far: copied 1 thing");
    expect(email).not.toContain("SEC test");
    expect(email).not.toContain("example.com");
    expect(email.match(/https?:\/\/\S+/g)).toEqual([
      "https://trumanbrown.com/admin",
    ]);

    const batch = [...tables.get("pageviews").values()].find(
      (row) => row.type === "ev",
    );
    expect(JSON.parse(batch.evs)[0].v).toBe(copied);
  });

  it("leaves out the tags, referrers and link names a browser sends", async () => {
    place = { org: "Contoso Ltd", orgKind: "org", city: "Redmond" };
    await beacon({
      type: "pv",
      sid: "s2",
      pvid: "pv2",
      path: "/",
      ref: "https://login.evil-example.net/reset",
    });
    await beacon({
      type: "ev",
      sid: "s2",
      pvid: "pv2",
      events: [{ k: "click", v: "login.evil-example.net", t: 900 }],
    });
    place = { ...place, city: "Bellevue" };
    await beacon({
      type: "pv",
      sid: "s3",
      pvid: "pv3",
      path: "/",
      via: "call-555-0100-now",
    });
    await beacon({
      type: "ev",
      sid: "s3",
      pvid: "pv3",
      events: [{ k: "click", v: "call-555-0100", t: 900 }],
    });

    expect(sent.map((email) => /^From: .*$/m.exec(whole(email))[0])).toEqual([
      "From: another site",
      "From: a tagged link",
    ]);
    const emails = sent.map(whole).join("\n");
    expect(emails).toContain("So far: clicked 1 link");
    expect(emails).not.toMatch(/evil-example|555-0100/);
  });
});
