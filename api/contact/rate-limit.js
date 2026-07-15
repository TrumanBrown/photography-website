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

module.exports = { consumeRateLimit, hasStatus };
