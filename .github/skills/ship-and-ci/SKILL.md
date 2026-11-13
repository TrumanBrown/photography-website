---
name: ship-and-ci
description: "Finishing and shipping a change in this repo: the checks CI runs (npm test, npm run lint, npm run check with check:csp, advisory Prettier), staging only your own files, the commit style, pushing to main and watching the runs, reading a failed GitHub Actions run, inline-script CSP hashes, working beside other Copilot sessions in the same checkout, and letting Truman try something locally before it goes live. Use when: Truman pastes an Actions run URL or asks why a build, deploy, lint or test failed; a deploy was cancelled; adding or editing an inline script or the CSP; a rebase or another session's changes collide with yours; he says preview first, host it locally, can I test, or asks for the localhost link; or before any commit and push."
argument-hint: 'a run URL, or "ship it"'
---

# Shipping and CI

Done means pushed and green. [copilot-instructions.md](../../copilot-instructions.md) has the short version; this is the long one, with what has gone wrong before. Workflow details are in [docs/cicd.md](../../../docs/cicd.md), local commands in [docs/local-dev.md](../../../docs/local-dev.md).

## Finish a change

1. `git status --short`. Files you didn't change may belong to another session working in the same checkout (below), so leave them alone.
2. Run what covers the change: `npm test` (vitest over the `src`, `api` and `scripts` tests), `npm run lint` (ESLint; errors under the gitignored `mocks/` are local only), `npm run check` (`check:csp` plus `astro check`; it needs a session JSON, so on a fresh clone run `node scripts/generate-fixtures.mjs` first) and `npx prettier --check <your files>`. Run `npm run build` when the build path changed.
3. Update the docs the change touches, in the same commit, in plain words someone rebuilding the site could follow ("so that if i ever have to redeploy this website or any user wants to do something similar, the docs explain all of it very clearly", 2026-10-10). No em dashes.
4. Stage explicit paths: `git add <files>`, or `git add -p` for files other sessions also edit (`docs/hobbies.md`, `staticwebapp.config.json`, `package.json`). Never `git add -A`.
5. Commit with a plain sentence-case subject that says what changed for a visitor or for Truman (read `git log` for the tone), a paragraph or two of what and why, and the `Co-authored-by: Copilot` trailer. The author must be `Truman Brown <trumanbrown@users.noreply.github.com>`; if `git config user.email` prints anything else (a new PC), fix it before committing (docs/local-dev.md).
6. `git pull --rebase`, since other sessions and the keepalive bot move `main`. Run `npm run check:csp` again if the rebase touched the config. Then `git push origin main` (from a worktree, `git push origin HEAD:main`).
7. `gh run list --limit 5`, then `gh run watch <id> --exit-status` for Build and Deploy and for Lint. A push that changes only Markdown runs Lint and doesn't deploy. An older run cancelled by a newer push or the hourly cron is normal; check that the newer run contains your commit.
8. Look at the live page (console, CSP errors), stop any server you started, and tell Truman the commit, the CI result and what's live, simply.

The built-in "commit" skill says never to push without approval. Here Truman's rule wins: push finished work straight to `main`, no pull requests, unless he asks to see it first (below).

## Read a failed run

He pastes `.../actions/runs/<id>` and asks why it failed.

1. `gh run view <id>`: the workflow, the event (`workflow_dispatch` is often his Rebuild Site button), the failed step and the commit.
2. Logs: `gh run view <id> --log-failed`. Some older `gh` versions print nothing for that; then list the jobs with `gh run view <id> --json jobs --jq '.jobs[]|"\(.databaseId) \(.name) \(.conclusion)"'` and read one with `gh api repos/TrumanBrown/photography-website/actions/jobs/<job-id>/logs | grep -E '##\[error\]|FAIL|Error:|ENOSPC'`. Logs expire after about 90 days.
3. Match the step:

| Failed step                        | Seen here                                                                                                                                 | Fix                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests                         | a test that depended on the time of day (`a52ccd6`, 2026-10-14); image tests timing out on a slow runner (`e00b520`)                      | fake `Date`; smaller fixtures and longer timeouts. A failing test blocks every deploy, including the hourly build and his Rebuild button |
| Install image tools                | apt exit 100, `Temporary failure resolving` a Ubuntu mirror (2026-11-11), pip timeouts                                                    | it installs from a cache (`.github/actions/image-tools`); a failure means an empty cache and five failed downloads, so rerun it          |
| Run prebuild                       | a variable only the Blob path uses (`0cf49ff`); network aborts; a photo whose location can't be removed, which stops the build on purpose | fix the code; rerun; see photo-sessions                                                                                                  |
| Astro build                        | out of disk (`18ea907`); `Missing CSP token(s)` or `Stale CSP token(s)`; schema errors from session metadata                              | see image-delivery, the CSP section below, photo-sessions                                                                                |
| Deploy to Static Web Apps          | content over 250 MB (`3ef60eb`)                                                                                                           | see image-delivery                                                                                                                       |
| Deploy to Static Web Apps          | "A rule was already processed with a duplicate route": `/about` and `/about/` both in `routes` (2026-11-05)                               | keep one; `scripts/swa-config.test.mjs` now catches it                                                                                   |
| Azure login on a pull request      | Dependabot and fork pull requests get no secrets                                                                                          | they build from fixtures by design (`29e1fb8`)                                                                                           |
| Azure login, on `main`             | `Failed to fetch federated token from GitHub` from GitHub's token service, with the permission in place (2026-10-26)                      | the shared login action retries twice; if all three fail, check `id-token: write` and the federated credential (azure-ops)               |
| Prettier, in Lint                  | advisory (`continue-on-error`), the run stays green                                                                                       | format only your own files                                                                                                               |
| No jobs, `startup_failure`         | "likely failed because of a workflow file issue", yet the same commit ran fine before and after: a GitHub outage (2026-11-11)             | check githubstatus.com, nothing to fix; the next run catches up                                                                          |
| Build Azure/static-web-apps-deploy | fails in about 15 seconds, before any repo step, pulling the deploy image from Microsoft's registry: 401, then 429 (2026-06-16)           | the registry, not the repo; rerun or let the next run take it                                                                            |
| Social post, Photo captions        |                                                                                                                                           | see instagram-posting and photo-captions                                                                                                 |

4. Fix it, push, watch the next run, then tell him the cause, the fix, the commit, and whether he has to redo anything. His admin edits are safe in Blob; the next green build ships them.

## Inline scripts and the CSP

`script-src` allows `'self'`, `'wasm-unsafe-eval'` and four SHA-256 hashes: `themeBootstrap` (`src/lib/theme.ts`), `landingBootstrap` (`src/lib/landing.ts`), and the inline scripts in `ThemeToggle.astro` and `LeadPhoto.astro`. `npm run check:csp` (`scripts/csp-hash.mjs`, also run by `check` and `build`) checks all four, and that the CSP's storage host matches `blobHost` in `site.config.ts`.

1. Prefer a normal bundled `<script>`, which is served from `/_astro/` and covered by `'self'`. Inline only what must run before first paint.
2. Edit, run `npm run check:csp`, replace the stale `'sha256-...'` token in `staticwebapp.config.json`, and run it again until it matches.
3. Whitespace counts. The ThemeToggle and LeadPhoto scripts are hashed byte for byte, so a Prettier reflow of the `.astro` file changes the hash.
4. A fifth inline script needs its own extractor in `csp-hash.mjs`. Without one the check passes and production blocks the script. Update docs/security.md and the count in docs/session-handoff.md lesson 11.
5. Never add `'unsafe-inline'` to `script-src`. A new host goes in the narrowest directive, with no wildcards.
6. The dev server and `npm run preview` don't send the SWA headers, so CSP problems show only in production or a PR preview. Dark mode broke this way once (`51e5884`).

## Other sessions in the same checkout

Truman often runs several Copilot sessions in this repo at once.

- Before editing, look for changes you didn't make. Never `git restore`, `git checkout --`, `git stash` or `git reset` files you didn't change.
- Long or overlapping work goes in a worktree: `git worktree add ../photography-website.worktrees/<name> -b agents/<name>`, push with `git push origin HEAD:main`, then remove the worktree. A worktree has no `staging/`, `mocks/`, `.env` or downloaded sessions, because they're gitignored. Read those from the main checkout.
- Tell the other session which files you touch and which you won't, stage only yours, and `git pull --rebase` before pushing. Whoever pushes second rebases. If docs/hobbies.md conflicts, keep both sides. If your commit changed a CSP hash, say so, and never revert theirs.
- After pushing, say which run deploys both commits; the older one gets cancelled.
- If your commit picked up someone else's hunk, take just that hunk back out in a follow-up (`3a6fe10`) and leave their working tree alone.
- Don't stop a dev server you didn't start.

## Let Truman try it first

The default is to push. The exception is when he asks: "because these are a lot of changes with a lot animation, don't push it live when you are done. insteadm just host it locally so I can play around" (2026-10-14), "preview first" (2026-06-29), "can i test?".

1. Commit on a local branch or in a worktree, so `main` and the live site stay untouched.
2. Start the dev server on a free port as a background service: `npm run dev -- --port 4411` (his own server may hold 4321). WSL forwards localhost to Windows, so give him `http://localhost:4411/<path>/` links.
3. For files, give Windows paths printed by `wslpath -w <file>`, not typed from memory: the Linux user differs between his PCs, so it's `\\wsl.localhost\Ubuntu\home\<user>\projects\photography-website\<path>`, and a file on the Windows side is `C:\Users\<user>\...`. He also opens `file://wsl$/Ubuntu/...`. Print the whole path as text he can copy, in a code block when there are several. A link that shows only the file name, or a `file:///C:/...` link, doesn't open from his WSL VS Code window (lesson 15). Never a bare Linux path: "give file name full path so i can open from browser on main machine this is WSL remember this" (2026-10-08).
4. List what to try (click, click again, Escape, Back, reduced motion, phone width) and the calls you made that he may want changed.
5. Warn about things only the dev server does: processing images on first request, the Astro dev toolbar, a hidden VS Code browser panel pausing animation, and Windows "Animation effects" being off, which browsers report as reduced motion. Judge smoothness on `npm run build && npm run preview`. The camera (the birding selfie) needs HTTPS, so a phone can't use it from the dev server over the network. A pull request preview has an HTTPS address, but on 2026-06-27 he chose to test camera work on the live site.
6. When he says go: merge to `main`, run the checks, push, watch the runs, check the live site, and stop the server.

## Truman's verdicts

- 2026-06-08: "dont make changes and waste a build until you are very confident that it will work", after several deploys in a row guessed at the /admin 404 (lesson 12).
- 2026-06-27: "dont do prs just push directly unless that is bad idea? im the owner of the website not some contributor."
- 2026-06-29: "deploy live and dont open pr just commit directly to main repo that's how we've done it in the past. stop local server if not needed anymore."
- 2026-07-20: "just push it no local reviews." When he says push, run the checks, push and watch the runs, without another screenshot round.
- 2026-10-06: "Build this all out, test it locally, then push it to live... I expect if any build issues come up or anything, for you to fix them."
- 2026-10-11: on autopilot, "still ask if meaningful changes. just pign, make a system noise when input is needed" (the command is in copilot-instructions.md).
- 2026-10-13: "when i say to do something, you should push it, not just make it locally."
- 2026-10-14: the big animation batch went to localhost first; later that night, "push it to live since I am going to bed."
- 2026-10-26: getting the repo "ready to show off on a resume". He kept direct pushes to `main` (the ruleset only blocks force pushes and deleting `main`), wanted CodeQL as a workflow with a README badge, and "loading pages" meant loading and failure states where something fetches, not a loading screen in front of pages.
- 2026-10-26, on the README: "i think you put the instagram stuff a bit too high. I like the examples of correcting the speech and showing the impact of it (increased views) but I think it overhadows everythign else. balance it a bit more." Instagram is one item in "Photo pipeline" plus a short section after "Tech at a glance", with both caption rewrites and the visit numbers (`d1b45b1`).
- 2026-11-12, setting up the desktop when `sudo` needed a password: "whatever you need as long as this pc behaves the same as the other when working on this project." Root commands went through `wsl.exe -u root` (session-handoff, "Setting up on a new machine").
- 2026-11-12: "give file path, clearly you didnt learn that lesson from the other machine. i cant open them from wsl vs code window", after the desktop handed him a report as a `file:///C:/` link that showed only the file name (lesson 15).

## Hard-won lessons

1. **A test that depended on the time of day blocked every deploy** from 10:05 one morning, including his admin edits. Fake `Date` in tests and check them at several dates (`a52ccd6`).
2. **Lint never actually ran ESLint** until the flat config existed. Prettier is advisory because the repo was never formatted as a whole (`671575b`). Never reformat the repo inside a feature commit; format only your own files (`18cb7fb`, `4668571`).
3. **A variable used only on the Blob path broke a deploy** that every local check had passed. ESLint's `no-undef` is now an error for `scripts/` and `api/` (`0cf49ff`).
4. **Closing a pull request once cancelled the production deploy of its merge**, because both runs grouped under main's ref. Pull request runs now group by their branch (`1d65fc2`).
5. **Shared checkout accidents.** `git add -A` swept another session's half-done feature into a commit (2026-10-08), a bulk revert of 18 files wiped about 3,000 committed lines from the working tree (2026-10-09), and a commit picked up another session's paragraph (`3a6fe10`). Stage explicit paths, use worktrees, and never revert files you didn't change.
6. **CSP hashes churn.** The landing script's hash changed five times in three days across sessions. Re-run `check:csp` after every rebase and keep other sessions' hashes.
7. **Docs-only commits used to run the full image build.** Markdown and `docs/` are now in `paths-ignore` (`3b48f75`).
8. **Dependabot and fork pull requests failed at Azure login** because they get no secrets. They build from fixtures now, and major version bumps are ignored until migrated deliberately (`29e1fb8`).
9. **One hourly build failed at its second Azure sign-in** because GitHub's token service didn't hand out the OIDC token (2026-10-26). Nothing in the repo had changed. Workflows sign in through `.github/actions/azure-login`, which retries, and actions are pinned to commit SHAs on a fixed `ubuntu-24.04` runner so an upstream change can't break a build unannounced. A new workflow that signs in to Azure should use that action, never `azure/login` directly.
10. **A new PC published his personal Gmail.** Its `~/.gitconfig` still had the Gmail, so `694b542` (2026-11-05) went out with it, the same way the first 20 commits did in May and June. Scrubbing it would change every later commit ID the docs and skills cite, so history stays as it is (2026-11-05). New-machine setup now sets the noreply address, and step 5 checks it before every commit.
11. **The apt cache never worked, so a Ubuntu mirror outage stopped builds** (2026-08-29, 2026-10-01, 2026-11-11). The old step cached `/var/cache/apt/archives`, but the save failed on every run because its `lock` and `partial/` are root-only, and that failure is only a warning. `.github/actions/image-tools` now keeps the `.deb` files and pillow-heif wheels in a runner-owned folder, installs from it with no network, and retries downloads when the cache is empty. Given a local `.deb`, apt still downloads the same version from the mirror while the runner's package lists are there, so the cached install points `Dir::State::Lists` at an empty folder. When adding a cache, check a green run's post step says it saved, and that the next run's log has no downloads.
12. **Guessing through deploys wasted builds** (2026-06-08). The /admin API answered 404 and each theory went out as its own deploy. A bare test function deployed beside it found the cause in one build (`594ae79`). Isolate a fault with the smallest test first, and push a fix only when you're confident it works.
13. **Every build re-encoded every photo** until `7018ee3` (2026-06-23). Astro kept its image cache under `node_modules`, and `npm ci` deletes that folder at the start of each run. `cacheDir` is now `./.cache/astro` and the workflow caches it, which took builds from about 13 minutes to 3. Keep that cache outside `node_modules`.
14. **A fix that never left the machine** (2026-10-14). The globe spin rewrite of the night before was reported done but never committed or pushed, and the next day he found the live globe "still completely broken". It shipped in `d85892e`. Before saying a change is done, check that `git log origin/main` has the commit and its Build and Deploy run finished.
15. **A report link that didn't open** (2026-11-12). The desktop handed him an HTML report in `C:\Users\<user>\Documents` as a `file:///C:/...` link that showed only the file name, because `~/.copilot/copilot-instructions.md` said to link reports that way. From his WSL VS Code window the link opened nothing, and the path he needed wasn't on screen. The rule on 2026-10-08 already asked for the full path. That file and step 3 above now say to print the full Windows path as text and never let a link stand in for it.

## Gotchas

- `npm run fixtures` writes fake sessions next to the real local copies in `src/content/sessions/`.
- Local `dist/` is gigabytes and says nothing about the deploy size, because variants only move to Blob in CI.
- The Lint run shows a Prettier annotation even when it's green; dozens of older files fail the check.
- The keepalive bot can push "Keep scheduled workflows enabled" to `main`, so pull before pushing.
- Builds take 3 to 7 minutes, not the 3 the docs promise.
- There's no browser test in the repo. Screenshots and smoothness checks have used Playwright from a scratch folder outside the repo, which won't exist on another machine.
- His screen recordings are Snipping Tool `.mp4` files under `/mnt/c/Users/<user>/AppData/Local/Packages/Microsoft.ScreenSketch_*/TempState/Recordings/`. There's no system ffmpeg and system pip is locked, so use npm's `ffmpeg-static` or `pip install --target`, then tile frames at about 5 fps with timestamps into contact sheets to judge the motion (2026-10-14).
- Live page URLs without the trailing slash answer a 301 with an empty body, so `curl -s .../sessions/x | grep og:image` finds nothing even when the tag is there. Use `curl -sL` or the slash URL (2026-06-10).
- WSL puts Windows programs from `/mnt/c/...` on PATH. Node must be the Linux one: in a shell where nvm isn't loaded, or on a fresh install, the Windows `node` and `npx` win and tests or Playwright run under Windows. Check `which node npm` points into `~/.nvm` (2026-06-03, 2026-10-15). The desktop also keeps NodeSource's Node 22 in `/usr/bin`, a Linux fallback where nvm isn't loaded, so leave it. The laptop's `az` is the Windows one, which works with the quirks in azure-ops (lesson 9 and the gotchas); the Linux Azure CLI avoids them. A reboot also clears `/tmp`, so keep scratch tooling elsewhere.
- Pushing a commit that changes `.github/workflows/` needs the `workflow` scope on `gh`'s token, and a plain `gh auth login` doesn't ask for it. Git then refuses the push ("refusing to allow an OAuth App to create or update workflow ... without `workflow` scope"). `gh auth refresh -h github.com -s workflow` adds it, and Truman types the code on Windows (2026-11-12).

Add new verdicts and lessons here, dated, in the commit that acts on them.
