/**
 * Private state for the social auto-poster.
 *
 * Everything the poster remembers (catalog, queue, ledger, day records, the
 * sealed token) lives under one prefix in a PRIVATE container, never in the
 * repository, so nothing public says which account it posts to.
 *
 * Two backends share one interface:
 *   blobStore  - Azure Blob (CI and `az login` locally)
 *   localStore - a folder on disk, for dry runs and tests
 *
 * Writes can be conditional (ifMatch / ifNoneMatch "*"), which is what makes
 * "claim this posting slot" safe when two runs overlap: the loser gets a
 * ConflictError instead of silently overwriting the winner.
 */
import { mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export class ConflictError extends Error {
  constructor(name) {
    super(`State changed underneath us: ${name}`);
    this.name = "ConflictError";
  }
}

const etagOf = (text) => createHash("sha1").update(text).digest("hex");

export function localStore(dir) {
  const path = (name) => join(dir, name);
  return {
    kind: "local",
    async readJson(name) {
      try {
        const text = await readFile(path(name), "utf8");
        return { data: JSON.parse(text), etag: etagOf(text) };
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    },
    async writeJson(name, data, { ifMatch, ifNoneMatch } = {}) {
      const current = await this.readJson(name);
      if (ifNoneMatch === "*" && current) throw new ConflictError(name);
      if (ifMatch && (!current || current.etag !== ifMatch))
        throw new ConflictError(name);
      const text = JSON.stringify(data, null, 2);
      await mkdir(dirname(path(name)), { recursive: true });
      const tmp = `${path(name)}.${randomUUID()}.tmp`;
      await writeFile(tmp, text);
      await rename(tmp, path(name));
      return etagOf(text);
    },
    async putMedia(name, buffer) {
      await mkdir(dirname(path(name)), { recursive: true });
      await writeFile(path(name), buffer);
    },
    async mediaUrl(name) {
      return pathToFileURL(path(name)).href;
    },
    async remove(name) {
      await rm(path(name), { force: true });
    },
  };
}

export async function blobStore({
  account,
  container = "metadata",
  prefix = "social/",
}) {
  if (!account) throw new Error("AZURE_STORAGE_ACCOUNT is required.");
  const {
    BlobServiceClient,
    BlobSASPermissions,
    SASProtocol,
    generateBlobSASQueryParameters,
  } = await import("@azure/storage-blob");
  const { DefaultAzureCredential } = await import("@azure/identity");

  const service = new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    new DefaultAzureCredential(),
  );
  const client = service.getContainerClient(container);
  const blob = (name) => client.getBlockBlobClient(prefix + name);
  let delegationKey;

  const isConflict = (e) =>
    e?.statusCode === 412 ||
    e?.statusCode === 409 ||
    e?.code === "ConditionNotMet" ||
    e?.code === "BlobAlreadyExists";

  return {
    kind: "blob",
    async readJson(name) {
      try {
        const res = await blob(name).download();
        const text = (await streamToBuffer(res.readableStreamBody)).toString(
          "utf8",
        );
        return { data: JSON.parse(text), etag: res.etag };
      } catch (e) {
        if (e?.statusCode === 404) return null;
        throw e;
      }
    },
    async writeJson(name, data, { ifMatch, ifNoneMatch } = {}) {
      const text = JSON.stringify(data);
      try {
        const res = await blob(name).upload(text, Buffer.byteLength(text), {
          blobHTTPHeaders: {
            blobContentType: "application/json",
            blobCacheControl: "no-store",
          },
          conditions: {
            ...(ifMatch ? { ifMatch } : {}),
            ...(ifNoneMatch ? { ifNoneMatch } : {}),
          },
        });
        return res.etag;
      } catch (e) {
        if (isConflict(e)) throw new ConflictError(name);
        throw e;
      }
    },
    async putMedia(name, buffer) {
      await blob(name).uploadData(buffer, {
        blobHTTPHeaders: {
          blobContentType: "image/jpeg",
          blobCacheControl: "no-store",
        },
      });
    },
    /**
     * A read-only link that expires, signed with a user delegation key so no
     * account key is involved. The image is never publicly hosted; Meta fetches
     * it through this link while the post is being created, then it's deleted.
     */
    async mediaUrl(name, minutes = 120) {
      const startsOn = new Date(Date.now() - 5 * 60 * 1000);
      const expiresOn = new Date(Date.now() + minutes * 60 * 1000);
      if (
        !delegationKey ||
        new Date(delegationKey.signedExpiresOn) < expiresOn
      ) {
        delegationKey = await service.getUserDelegationKey(
          startsOn,
          new Date(Date.now() + 6 * 60 * 60 * 1000),
        );
      }
      const sas = generateBlobSASQueryParameters(
        {
          containerName: container,
          blobName: prefix + name,
          permissions: BlobSASPermissions.parse("r"),
          startsOn,
          expiresOn,
          protocol: SASProtocol.Https,
        },
        delegationKey,
        account,
      ).toString();
      return `${blob(name).url}?${sas}`;
    },
    async remove(name) {
      await blob(name).deleteIfExists();
    },
    /** Read any blob in the account (used for the prebuild's admin index). */
    async readOther(containerName, blobName) {
      const res = await service
        .getContainerClient(containerName)
        .getBlobClient(blobName)
        .download();
      return (await streamToBuffer(res.readableStreamBody)).toString("utf8");
    },
  };
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Read-modify-write with optimistic concurrency. `mutate` receives a copy of
 * the current value (or `fallback` when absent) and returns the new value.
 */
export async function updateJson(
  store,
  name,
  mutate,
  { fallback = {}, retries = 5 } = {},
) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const current = await store.readJson(name);
    const base = current ? current.data : structuredClone(fallback);
    const next = await mutate(base);
    try {
      const etag = await store.writeJson(
        name,
        next,
        current ? { ifMatch: current.etag } : { ifNoneMatch: "*" },
      );
      return { data: next, etag };
    } catch (e) {
      if (!(e instanceof ConflictError) || attempt === retries) throw e;
    }
  }
  throw new Error("unreachable");
}
