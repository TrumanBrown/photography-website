# Project guidelines

## Finishing a change

When Truman asks for a change, it isn't done until it's pushed. Don't stop at local edits, and don't
ask whether to push.

1. Run the checks that cover the change. CI runs `npm test`, `npm run lint` and `npm run check`
   ([lint.yml](workflows/lint.yml)). ESLint errors under `mocks/` are local only; that folder is
   gitignored.
2. Commit on the current branch (normally `main`) with only the files the change touched. Leave
   untracked scratch files out.
3. Push, then watch the runs it starts (`gh run list`, `gh run watch`) and fix anything that fails.

A push to `main` that touches more than Markdown and `docs/` deploys the site
([build-and-deploy.yml](workflows/build-and-deploy.yml), [docs/cicd.md](../docs/cicd.md)).

Commit messages follow the existing log: a plain sentence-case summary line, then a short paragraph
or two on what changed and why.

The one exception to pushing: when Truman asks to see it first ("host it locally", "preview
first"), commit on a branch or in a worktree, serve it on a free port, give him the links, and push
when he says so ([ship-and-ci](skills/ship-and-ci/SKILL.md)).

Other Copilot sessions often work in this checkout at the same time. Stage only your own files,
never restore, stash or reset files you didn't change, and `git pull --rebase` before pushing.

## Working with Truman

- He works from Windows into this WSL checkout. Give files as Windows paths
  (`\\wsl.localhost\Ubuntu\home\trumanbrown\projects\photography-website\...`) and servers as
  `http://localhost:<port>/` links, never bare Linux paths.
- Update the docs a change touches in the same commit, in plain words someone rebuilding the site
  could follow.
- The repo is public. No secrets, Azure ids, personal email or the Instagram account in code,
  docs, skills or logs.

## Skills

Each part of the site with a history has a skill in [skills/](skills/): how that part works, the
procedure that works for it, Truman's verdicts, and the lessons that cost a round of rework. Load
the matching skill before changing that part, even when the change looks small.

| Skill                                                                                                                                | For                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| [photo-sessions](skills/photo-sessions/SKILL.md)                                                                                     | uploading, splitting or renaming sessions, sidecars, the admin panel, builds broken by session data |
| [image-delivery](skills/image-delivery/SKILL.md)                                                                                     | full resolution, the lightbox, image sizes and priority, captions under photos, the Blob bill       |
| [session-globe](skills/session-globe/SKILL.md)                                                                                       | globe pins, the spin, the flight into a session                                                     |
| [hobby-pages](skills/hobby-pages/SKILL.md)                                                                                           | Things to try: adding or changing a hobby, species and facts, galleries, maps                       |
| [hobby-scenes](skills/hobby-scenes/SKILL.md)                                                                                         | the animation that plays when a hobby card is clicked                                               |
| [narrow-nature](skills/narrow-nature/SKILL.md)                                                                                       | the daily puzzle, its data and its map                                                              |
| [site-motion](skills/site-motion/SKILL.md)                                                                                           | every other animation and interaction, and ports from component libraries                           |
| [design-mocks](skills/design-mocks/SKILL.md)                                                                                         | mocks and design directions before anything is built                                                |
| [photo-captions](skills/photo-captions/SKILL.md)                                                                                     | the captions pipeline: species, descriptions, re-runs, rolling out changes                          |
| [instagram-posting](skills/instagram-posting/SKILL.md)                                                                               | the Instagram pipeline: planning, posts, stories, failures, the token                               |
| [ship-and-ci](skills/ship-and-ci/SKILL.md)                                                                                           | checks, commits, pushing, failed runs, CSP hashes, parallel sessions, local previews                |
| [azure-ops](skills/azure-ops/SKILL.md)                                                                                               | Bicep, identities, settings, API functions, cost, security                                          |
| [truman-voice](skills/truman-voice/SKILL.md), [caption-voice](skills/caption-voice/SKILL.md), [humanizer](skills/humanizer/SKILL.md) | anything in his voice, Instagram captions, text that sounds like AI                                 |
| [stipple-plates](skills/stipple-plates/SKILL.md)                                                                                     | the hobby card drawings                                                                             |

## Writing lessons down

Truman expects a lesson to be learned once. When he says to remember something, rejects a result,
approves one after rework, or a bug turns out to have a cause the next session could trip on, write
it into the matching skill in the same commit as the change.

- His verdicts go under "Truman's verdicts": his local date, his words, kept short.
- Lessons go under "Hard-won lessons": what went wrong, why, the rule now, and the commit.
- If a step in a procedure caused the problem, fix the step itself. Fix or delete anything a later
  change made untrue.
- A rule for every public page belongs in [instructions/](instructions/) (site-design or
  site-copy). How he writes belongs in the voice skills. Keep their headings as they are:
  `scripts/photos` reads sections of truman-voice, caption-voice and site-copy by exact heading.
- If no skill fits and the area will come up again, start one (a folder named like its `name`, and
  a description with "Use when" triggers) and add it to the table above.
- Skills are public too: no secrets, ids, account names or exact private locations.
