import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* When the front door moved the archive on 2026-11-05 and two Functions were
   added on 2026-11-09, the README's layout tree and seven "three Functions"
   in the docs stayed stale for a week (site review HM-5). These tests read
   both from the repo, so the next folder or Function fails here until the
   docs say so. */
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(path.join(root, file), "utf8");

// What git tracks, so node_modules, dist and other ignored folders don't count.
const trackedFiles = new Set(
  execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean),
);
const trackedDirs = new Set();
for (const file of trackedFiles) {
  const parts = file.split("/");
  for (let i = 1; i < parts.length; i++)
    trackedDirs.add(parts.slice(0, i).join("/"));
}

/** Entries of the README's "Repository layout" block, as repo paths. */
function layoutEntries(readme) {
  const section = readme.split(/^## Repository layout$/m)[1] ?? "";
  const block = section.match(/```\n([\s\S]*?)```/)?.[1];
  if (!block)
    throw new Error("README.md has no code block under ## Repository layout");
  const entries = [];
  const parents = [];
  for (const line of block.split("\n")) {
    const match = line.match(/^((?:│ {3}| {4})*)(?:├── |└── )(\S+)/u);
    if (!match) continue;
    const depth = match[1].length / 4;
    const name = match[2].replace(/\/$/, "");
    parents.length = depth;
    const isDir = match[2].endsWith("/");
    entries.push({
      path: [...parents, name].join("/"),
      parent: parents.join("/"),
      isDir,
    });
    if (isDir) parents.push(name);
  }
  return entries;
}

const NUMBERS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/** Every "<number> [small|managed|Azure|...] Functions" in a text. */
function functionCounts(text) {
  const found = [];
  const pattern =
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:(?:small|managed|azure|swa|http|api)\s+)*functions\b/gi;
  for (const match of text.matchAll(pattern)) {
    if (!match[0].endsWith("Functions")) continue; // Azure Functions, not "two pure functions"
    const word = match[1].toLowerCase();
    found.push({
      phrase: match[0],
      count: NUMBERS[word] ?? Number(word),
      index: match.index,
    });
  }
  return found;
}

function markdownFiles(dir) {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return markdownFiles(rel);
      return entry.name.endsWith(".md") ? [rel] : [];
    },
  );
}

describe("README layout tree", () => {
  const entries = layoutEntries(read("README.md"));

  it("names only folders and files git tracks", () => {
    expect(entries.length).toBeGreaterThan(10);
    for (const { path: entry, isDir } of entries) {
      const tracked = isDir ? trackedDirs.has(entry) : trackedFiles.has(entry);
      expect(
        tracked,
        `README.md's layout lists ${entry}, which git doesn't track`,
      ).toBe(true);
    }
  });

  it("lists every tracked folder inside each folder it opens", () => {
    const opened = new Set(["", ...entries.map((entry) => entry.parent)]);
    for (const dir of opened) {
      const listed = entries
        .filter((e) => e.isDir && e.parent === dir)
        .map((e) => e.path);
      const onDisk = [...trackedDirs].filter(
        (d) =>
          (path.posix.dirname(d) === "." ? "" : path.posix.dirname(d)) === dir,
      );
      const missing = onDisk.filter((d) => !listed.includes(d));
      expect(
        missing,
        `README.md's layout opens ${dir || "the repo root"} but leaves out ${missing.join(", ")}`,
      ).toEqual([]);
    }
  });
});

describe("Function counts in the docs", () => {
  const functions = readdirSync(path.join(root, "api"), { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        existsSync(path.join(root, "api", d.name, "function.json")),
    )
    .map((d) => d.name);

  it("finds the Functions", () => {
    expect(functions.length).toBeGreaterThan(0);
  });

  it("match api/*/function.json wherever README.md or docs/ give a number", () => {
    for (const file of ["README.md", ...markdownFiles("docs")]) {
      const text = read(file);
      for (const { phrase, count, index } of functionCounts(text)) {
        const line = text.slice(0, index).split("\n").length;
        expect(
          count,
          `${file}:${line} says "${phrase}", but api/ has ${functions.length} (${functions.join(", ")}). Say "the Functions in api/" instead of a number.`,
        ).toBe(functions.length);
      }
    }
  });

  it("catches a count in the shapes the docs have used", () => {
    expect(
      functionCounts(
        "runs three managed Functions and 3 Functions, then two pure functions",
      ).map((f) => f.count),
    ).toEqual([3, 3]);
    expect(functionCounts("the Functions in api/ handle it")).toEqual([]);
  });
});
