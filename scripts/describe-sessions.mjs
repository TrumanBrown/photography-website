#!/usr/bin/env node
/**
 * Draft a title, location and description for any session that doesn't have
 * one yet, by showing a vision model a sample of that session's photographs.
 *
 * This is the review-first path. The build fills in missing descriptions on its
 * own (see scripts/prebuild.mjs); use this when you'd rather read and edit the
 * wording before any of it goes live.
 *
 * Usage:
 *   npm run prebuild:remote                  # pull sessions + images from Blob
 *   OPENAI_API_KEY=sk-... npm run describe
 *   # review and edit scripts/session-meta.json, drop the "draft": true flags
 *   npm run meta:apply
 *
 * Options:
 *   --force          Redraft sessions that already have an entry
 *   --only <slug>    Draft a single session (repeatable)
 *   --samples <n>    Photos to show the model per session (default: 8)
 *   --provider <p>   openai | anthropic | mock (default: inferred from keys)
 *   --dry-run        Print drafts without writing session-meta.json
 *
 * A generated description beats an empty one, but it's far worse than your own
 * words, so drafts land marked `"draft": true` and meta:apply holds them back
 * until you've read them.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { activeProvider, describeSession } from "./lib/describe.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SESSIONS_DIR = join(ROOT, "src/content/sessions");
const META_FILE = join(ROOT, "scripts/session-meta.json");

function parseArgs(argv) {
  const opts = {
    force: false,
    only: [],
    samples: 8,
    provider: undefined,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") opts.force = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--only") opts.only.push(argv[++i]);
    else if (arg === "--samples") opts.samples = Number(argv[++i]);
    else if (arg === "--provider") opts.provider = argv[++i];
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(opts.samples) || opts.samples < 1) {
    console.error("--samples must be a positive integer.");
    process.exit(2);
  }
  return opts;
}

async function loadSessions() {
  if (!existsSync(SESSIONS_DIR)) return [];
  const files = (await readdir(SESSIONS_DIR)).filter((f) =>
    f.endsWith(".json"),
  );
  const sessions = [];
  for (const file of files) {
    const slug = file.replace(/\.json$/, "");
    const data = JSON.parse(await readFile(join(SESSIONS_DIR, file), "utf8"));
    sessions.push({
      slug,
      data,
      imagesDir: join(SESSIONS_DIR, slug, "images"),
    });
  }
  return sessions.sort((a, b) => a.slug.localeCompare(b.slug));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const provider = opts.provider ?? activeProvider();
  if (!provider) {
    console.error(
      "No provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY,",
    );
    console.error(
      "or pass --provider mock to exercise the flow without an API.",
    );
    process.exit(1);
  }

  const sessions = await loadSessions();
  if (sessions.length === 0) {
    console.error(
      `No sessions found in ${SESSIONS_DIR}. Run "npm run prebuild:remote" first.`,
    );
    process.exit(1);
  }

  const meta = JSON.parse(await readFile(META_FILE, "utf8"));

  const targets = sessions.filter((s) => {
    if (opts.only.length > 0) return opts.only.includes(s.slug);
    if (opts.force) return true;
    // A session is "done" once it has copy here or a description of its own.
    return !meta[s.slug] && !s.data.description;
  });

  if (targets.length === 0) {
    console.log(
      "Every session already has a description. Use --force to redraft.",
    );
    return;
  }

  console.log(
    `Drafting ${targets.length} session(s) with provider "${provider}".\n`,
  );
  let drafted = 0;

  for (const session of targets) {
    try {
      const { title, location, description, sampled } = await describeSession({
        slug: session.slug,
        title: session.data.title,
        date: session.data.date,
        location: session.data.location,
        images: session.data.images,
        imagesDir: session.imagesDir,
        samples: opts.samples,
        provider,
      });
      meta[session.slug] = { title, location, description, draft: true };
      drafted++;
      console.log(`${session.slug}  (${sampled} photos shown)`);
      console.log(`  title:       ${title}`);
      console.log(`  location:    ${location || "(none)"}`);
      console.log(`  description: ${description}\n`);
    } catch (err) {
      console.error(`${session.slug}: ${err.message}\n`);
    }
  }

  if (drafted === 0) {
    console.error("Nothing drafted.");
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log(
      `${drafted} draft(s) generated. --dry-run, so session-meta.json was not written.`,
    );
    return;
  }

  await writeFile(META_FILE, JSON.stringify(meta, null, 2) + "\n");
  console.log(`${drafted} draft(s) written to scripts/session-meta.json.`);
  console.log(
    'Review them, edit the wording, remove the "draft": true flags, then run "npm run meta:apply".',
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
