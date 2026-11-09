/**
 * Names for what the Weekdays side reports to the analytics beacon, shared by
 * the page's markup (data-track-section, data-track) and the admin panel,
 * which turns them back into words. A name is lowercase letters, digits and
 * : . _ - (api/track/payload.js checks the same pattern), at most 60 long.
 */
import { LINKS, PROJECTS, WORK, type Job, type Project } from "./about";

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cap(name: string): string {
  return name.slice(0, 60).replace(/-+$/, "");
}

export function jobSection(job: Job): string {
  return cap(`job:${slug(job.org)}-${slug(job.role)}`);
}

export function projectName(project: Project, part?: string): string {
  return cap(`project:${slug(project.repo)}${part ? `:${part}` : ""}`);
}

export function railName(label: string): string {
  return cap(`rail:${slug(label)}`);
}

const SECTIONS: Record<string, string> = {
  intro: "the opening line",
  summary: "the summary",
  projects: "Side projects",
  school: "School",
  skills: "Skills",
};

const CLICKS: Record<string, string> = {
  "resume-pdf": "Resume (PDF)",
  "write-to-me": "Write to me",
  linkedin: "LinkedIn",
  "github-profile": "More on GitHub",
  "rail:name": "my name (home)",
  "rail:photographs": "Photographs in the rail",
  "rail:things-to-try": "Things to try in the rail",
  "rail:about-me": "About me in the rail",
  "rail:everest-photo": "the Everest photo",
  "rail:resume-pdf": "Resume (PDF) in the rail",
  "rail:write-to-me": "Write to me in the rail",
};

const PROJECT_PARTS: Record<string, string> = {
  name: "name",
  code: "Code on GitHub",
  readme: "the panel's README",
  youtube: "Watch on YouTube",
  play: "the video",
  session: "the newest session",
  pause: "Pause",
};

/** Words for a section or click name, for the admin panel. */
export function trackLabel(name: string): string {
  if (SECTIONS[name]) return SECTIONS[name];
  if (CLICKS[name]) return CLICKS[name];
  const job = WORK.find((entry) => jobSection(entry) === name);
  if (job) return `${job.org}, ${job.role}`;
  for (const project of PROJECTS) {
    if (name === projectName(project)) return project.name;
    for (const [part, words] of Object.entries(PROJECT_PARTS)) {
      if (name === projectName(project, part))
        return `${project.name}: ${words}`;
    }
  }
  for (const link of LINKS) {
    if (name === railName(link.label)) return `${link.label} in the rail`;
  }
  if (name === railName("Instagram")) return "Instagram in the rail";
  return name;
}
