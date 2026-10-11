#!/usr/bin/env node
/**
 * Is a post due right now?
 *
 * The posting workflow fires every half hour because GitHub drops scheduled
 * runs. This check uses no npm packages, so it runs before `npm ci` and the
 * runs with nothing to do finish in seconds. It reads today's private day
 * record with the Azure CLI (already signed in by the workflow) and writes
 * due=true|false to $GITHUB_OUTPUT. Any doubt resolves to "due": the full run
 * makes the real decision.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "./settings.mjs";
import { IN_FLIGHT, decide, localParts, previousDay } from "./schedule.mjs";

const settings = loadSettings();
const today = localParts(new Date(), settings.timezone).day;

function readDay(day) {
  if (!settings.storageAccount) return null;
  const dir = mkdtempSync(join(tmpdir(), "social-"));
  const file = join(dir, "day.json");
  try {
    execFileSync(
      "az",
      [
        "storage",
        "blob",
        "download",
        "--account-name",
        settings.storageAccount,
        "--container-name",
        "metadata",
        "--name",
        `social/days/${day}.json`,
        "--file",
        file,
        "--auth-mode",
        "login",
        "--only-show-errors",
        "--no-progress",
        "-o",
        "none",
      ],
      { stdio: "ignore" },
    );
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const day = readDay(today);
// An unsettled post from today or yesterday needs a full run to settle it.
const inFlight = [day, readDay(previousDay(today))].some((rec) =>
  (rec?.attempts ?? []).some((a) => IN_FLIGHT.has(a.state)),
);
const { due, reason } = decide({ now: new Date(), settings, day });
const result = due || inFlight;
console.log(result ? "A post is due." : `Nothing due: ${reason}.`);
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `due=${result}\n`);
