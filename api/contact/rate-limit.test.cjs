const { consumeRateLimit } = require("./rate-limit");

function storageError(statusCode) {
  return Object.assign(new Error(`Storage returned ${statusCode}`), {
    statusCode,
  });
}

class MemoryTableClient {
  entity = null;
  version = 0;

  async getEntity() {
    await Promise.resolve();
    if (!this.entity) throw storageError(404);
    return { ...this.entity };
  }

  async createEntity(entity) {
    await Promise.resolve();
    if (this.entity) throw storageError(409);
    this.version += 1;
    this.entity = { ...entity, etag: String(this.version) };
  }

  async updateEntity(entity, _mode, options) {
    await Promise.resolve();
    if (!this.entity || options.etag !== this.entity.etag)
      throw storageError(412);
    this.version += 1;
    this.entity = { ...entity, etag: String(this.version) };
  }
}

function consume(client) {
  return consumeRateLimit(client, {
    partitionKey: "2026-07-14T12",
    rowKey: "visitor",
    maxCount: 5,
    updatedAt: "2026-07-14T12:00:00.000Z",
    maxAttempts: 20,
  });
}

describe("consumeRateLimit", () => {
  it("atomically caps a concurrent burst", async () => {
    const client = new MemoryTableClient();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => consume(client)),
    );

    expect(results.filter((limited) => !limited)).toHaveLength(5);
    expect(results.filter(Boolean)).toHaveLength(7);
    expect(client.entity.count).toBe(5);
  });

  it("does not update an entity already at the cap", async () => {
    const client = new MemoryTableClient();
    client.entity = { count: 5, etag: "1" };

    await expect(consume(client)).resolves.toBe(true);
    expect(client.entity.count).toBe(5);
  });

  it("surfaces storage failures to the endpoint availability policy", async () => {
    const client = {
      getEntity: async () => {
        throw storageError(503);
      },
    };
    await expect(consume(client)).rejects.toMatchObject({ statusCode: 503 });
  });
});
