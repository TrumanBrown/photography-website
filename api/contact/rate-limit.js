function hasStatus(error, statusCode) {
  return Boolean(
    error && typeof error === "object" && error.statusCode === statusCode,
  );
}

async function consumeRateLimit(client, options) {
  const { partitionKey, rowKey, maxCount, updatedAt } = options;
  const maxAttempts = options.maxAttempts || 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let entity;
    try {
      entity = await client.getEntity(partitionKey, rowKey);
    } catch (error) {
      if (!hasStatus(error, 404)) throw error;

      try {
        await client.createEntity({
          partitionKey,
          rowKey,
          count: 1,
          updatedAt,
        });
        return false;
      } catch (createError) {
        if (hasStatus(createError, 409)) continue;
        throw createError;
      }
    }

    const count = Number(entity.count) || 0;
    if (count >= maxCount) return true;
    if (!entity.etag) throw new Error("Rate-limit entity is missing an ETag.");

    try {
      await client.updateEntity(
        { ...entity, count: count + 1, updatedAt },
        "Replace",
        { etag: entity.etag },
      );
      return false;
    } catch (updateError) {
      if (hasStatus(updateError, 409) || hasStatus(updateError, 412)) continue;
      throw updateError;
    }
  }

  // Heavy contention means this client is already issuing a burst. Do not
  // grant an unreserved slot merely because the optimistic retries ran out.
  return true;
}

// The address a visitor is limited by. An IPv6 home or phone connection gets
// a whole /64 and can pick a new address in it for every message, so IPv6
// counts by its first four groups. IPv4, and IPv4 written as IPv6, stay whole.
function rateLimitAddress(ip) {
  const value = String(ip ?? "")
    .trim()
    .toLowerCase();
  if (!value.includes(":")) return value;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped) return mapped[1];
  const halves = value.split("::");
  if (halves.length > 2) return value;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array(Math.max(fill, 0)).fill("0"), ...right];
  const prefix = groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""));
  return `${prefix.join(":")}::/64`;
}

module.exports = { consumeRateLimit, hasStatus, rateLimitAddress };
