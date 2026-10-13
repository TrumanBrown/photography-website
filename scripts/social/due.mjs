#!/usr/bin/env node
/**
 * Is a post (or the day's story) due right now?
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
import {
  IN_FLIGHT,
  decide,
  decideStory,
  localParts,
  previousDay,
} from "./schedule.mjs";

const settings = loadSettings();
const today = localParts(new Date(), settings.timezone).day;

function readDay(day, folder = "days") {
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
        `social/${folder}/${day}.json`,
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
const days = [day, readDay(previousDay(today))];
// The day's story, when stories are on.
const stories = settings.stories !== "off";
const storyDay = stories ? readDay(today, "story-days") : null;
if (stories) days.push(storyDay, readDay(previousDay(today), "story-days"));
// An unsettled post or story from today or yesterday needs a full run to settle it.
const inFlight = days.some((rec) =>
  (rec?.attempts ?? []).some((a) => IN_FLIGHT.has(a.state)),
);
const feed = decide({ now: new Date(), settings, day });
const story = stories
  ? decideStory({ now: new Date(), settings, day: storyDay })
  : { due: false };
const result = feed.due || story.due || inFlight;
console.log(
  feed.due
    ? "A post is due."
    : story.due
      ? "Today's story is due."
      : inFlight
        ? "Something from earlier needs settling."
        : `Nothing due: ${feed.reason}.`,
);
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `due=${result}\n`);
