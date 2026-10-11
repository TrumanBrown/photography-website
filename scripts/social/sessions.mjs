/**
 * Where the photos come from.
 *
 * In CI the poster reads the same resolved index the admin panel uses
 * (metadata/admin-index.json, written by prebuild) and fetches originals from
 * their public URLs, so it never needs the multi-gigabyte prebuild cache.
 * Locally (--local) it reads the sessions prebuild already wrote to
 * src/content/sessions, which is handy for dry runs.
 */
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export async function loadSessionsFromIndex(store) {
  const index = JSON.parse(
    await store.readOther("metadata", "admin-index.json"),
  );
  return (index.sessions ?? []).map((s) => ({
    slug: s.slug,
    title: s.title ?? s.slug,
    date: s.date ?? "",
    location: s.location ?? "",
    description: s.description ?? "",
    photos: (s.images ?? []).map((file) => ({
      id: `${s.slug}/${file}`,
      session: s.slug,
      file,
      url: s.urls?.[file] ?? null,
    })),
  }));
}

export async function loadSessionsLocal(root) {
  const dir = join(root, "src/content/sessions");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const out = [];
  for (const f of files.sort()) {
    const slug = f.replace(/\.json$/, "");
    const s = JSON.parse(await readFile(join(dir, f), "utf8"));
    out.push({
      slug,
      title: s.title ?? slug,
      date: s.date ?? "",
      location: s.location ?? "",
      description: s.description ?? "",
      photos: (s.images ?? []).map((img) => ({
        id: `${slug}/${img.file}`,
        session: slug,
        file: img.file,
        url: img.fullUrl ?? null,
        localPath: join(dir, slug, "images", img.file),
      })),
    });
  }
  return out;
}

export async function readPhoto(photo, fetchImpl = fetch) {
  if (photo.localPath && existsSync(photo.localPath))
    return readFile(photo.localPath);
  if (!photo.url) throw new Error("photo has no local copy or URL");
  const res = await fetchImpl(photo.url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
