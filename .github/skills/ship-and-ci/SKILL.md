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
5. Commit with a plain sentence-case subject that says what changed for a visitor or for Truman (read `git log` for the tone), a paragraph or two of what and why, and the `Co-authored-by: Copilot` trailer.
6. `git pull --rebase`, since other sessions and the keepalive bot move `main`. Run `npm run check:csp` again if the rebase touched the config. Then `git push origin main` (from a worktree, `git push origin HEAD:main`).
7. `gh run list --limit 5`, then `gh run watch <id> --exit-status` for Build and Deploy and for Lint. A push that changes only Markdown runs Lint and doesn't deploy. An older run cancelled by a newer push or the hourly cron is normal; check that the newer run contains your commit.
8. Look at the live page (console, CSP errors), stop any server you started, and tell Truman the commit, the CI result and what's live, simply.

The built-in "commit" skill says never to push without approval. Here Truman's rule wins: push finished work straight to `main`, no pull requests, unless he asks to see it first (below).

## Read a failed run

He pastes `.../actions/runs/<id>` and asks why it failed.

1. `gh run view <id>`: the workflow, the event (`workflow_dispatch` is often his Rebuild Site button), the failed step and the commit.
2. Logs: `gh run view <id> --log-failed`. Some older `gh` versions print nothing for that; then list the jobs with `gh run view <id> --json jobs --jq '.jobs[]|"\(.databaseId) \(.name) \(.conclusion)"'` and read one with `gh api repos/TrumanBrown/photography-website/actions/jobs/<job-id>/logs | grep -E '##\[error\]|FAIL|Error:|ENOSPC'`. Logs expire after about 90 days.
3. Match the step:

| Failed step                   | Seen here                                                                                                                                 | Fix                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests                    | a test that depended on the time of day (`a52ccd6`, 2026-10-14); image tests timing out on a slow runner (`e00b520`)                      | fake `Date`; smaller fixtures and longer timeouts. A failing test blocks every deploy, including the hourly build and his Rebuild button |
| Install image tools           | apt exit 100, pip timeouts                                                                                                                | `gh run rerun <id> --failed`                                                                                                             |
| Run prebuild                  | a variable only the Blob path uses (`0cf49ff`); network aborts; a photo whose location can't be removed, which stops the build on purpose | fix the code; rerun; see photo-sessions                                                                                                  |
| Astro build                   | out of disk (`18ea907`); `Missing CSP token(s)` or `Stale CSP token(s)`; schema errors from session metadata                              | see image-delivery, the CSP section below, photo-sessions                                                                                |
| Deploy to Static Web Apps     | content over 250 MB (`3ef60eb`)                                                                                                           | see image-delivery                                                                                                                       |
| Azure login on a pull request | Dependabot and fork pull requests get no secrets                                                                                          | they build from fixtures by design (`29e1fb8`)                                                                                           |
| Prettier, in Lint             | advisory (`continue-on-error`), the run stays green                                                                                       | format only your own files                                                                                                               |
| Social post, Photo captions   |                                                                                                                                           | see instagram-posting and photo-captions                                                                                                 |

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
3. For files, give Windows paths: `\\wsl.localhost\Ubuntu\home\trumanbrown\projects\photography-website\<path>` (`wslpath -w <file>` prints it); he also opens `file://wsl$/Ubuntu/...`. Never a bare Linux path: "give file name full path so i can open from browser on main machine this is WSL remember this" (2026-10-08).
4. List what to try (click, click again, Escape, Back, reduced motion, phone width) and the calls you made that he may want changed.
5. Warn about things only the dev server does: processing images on first request, the Astro dev toolbar, a hidden VS Code browser panel pausing animation, and Windows "Animation effects" being off, which browsers report as reduced motion. Judge smoothness on `npm run build && npm run preview`. The camera (the birding selfie) needs HTTPS, so a phone can't use it from the dev server over the network. A pull request preview has an HTTPS address, but on 2026-06-27 he chose to test camera work on the live site.
6. When he says go: merge to `main`, run the checks, push, watch the runs, check the live site, and stop the server.

## Truman's verdicts

- 2026-06-27: "dont do prs just push directly unless that is bad idea? im the owner of the website not some contributor."
- 2026-06-29: "deploy live and dont open pr just commit directly to main repo that's how we've done it in the past. stop local server if not needed anymore."
- 2026-10-06: "Build this all out, test it locally, then push it to live... I expect if any build issues come up or anything, for you to fix them."
- 2026-10-11: on autopilot, "still ask if meaningful changes. just pign, make a system noise when input is needed" (the command is in copilot-instructions.md).
- 2026-10-13: "when i say to do something, you should push it, not just make it locally."
- 2026-10-14: the big animation batch went to localhost first; later that night, "push it to live since I am going to bed."

## Hard-won lessons

1. **A test that depended on the time of day blocked every deploy** from 10:05 one morning, including his admin edits. Fake `Date` in tests and check them at several dates (`a52ccd6`).
2. **Lint never actually ran ESLint** until the flat config existed. Prettier is advisory because the repo was never formatted as a whole (`671575b`). Never reformat the repo inside a feature commit; format only your own files (`18cb7fb`, `4668571`).
3. **A variable used only on the Blob path broke a deploy** that every local check had passed. ESLint's `no-undef` is now an error for `scripts/` and `api/` (`0cf49ff`).
4. **Closing a pull request once cancelled the production deploy of its merge**, because both runs grouped under main's ref. Pull request runs now group by their branch (`1d65fc2`).
5. **Shared checkout accidents.** `git add -A` swept another session's half-done feature into a commit (2026-10-08), a bulk revert of 18 files wiped about 3,000 committed lines from the working tree (2026-10-09), and a commit picked up another session's paragraph (`3a6fe10`). Stage explicit paths, use worktrees, and never revert files you didn't change.
6. **CSP hashes churn.** The landing script's hash changed five times in three days across sessions. Re-run `check:csp` after every rebase and keep other sessions' hashes.
7. **Docs-only commits used to run the full image build.** Markdown and `docs/` are now in `paths-ignore` (`3b48f75`).
8. **Dependabot and fork pull requests failed at Azure login** because they get no secrets. They build from fixtures now, and major version bumps are ignored until migrated deliberately (`29e1fb8`).

## Gotchas

- `npm run fixtures` writes fake sessions next to the real local copies in `src/content/sessions/`.
- Local `dist/` is gigabytes and says nothing about the deploy size, because variants only move to Blob in CI.
- The Lint run shows a Prettier annotation even when it's green; dozens of older files fail the check.
- The keepalive bot can push "Keep scheduled workflows enabled" to `main`, so pull before pushing.
- Builds take 3 to 7 minutes, not the 3 the docs promise.
- There's no browser test in the repo. Screenshots and smoothness checks have used Playwright from a scratch folder outside the repo, which won't exist on another machine.
- His screen recordings are Snipping Tool `.mp4` files under `/mnt/c/Users/<user>/AppData/Local/Packages/Microsoft.ScreenSketch_*/TempState/Recordings/`. There's no system ffmpeg and system pip is locked, so use npm's `ffmpeg-static` or `pip install --target`, then tile frames at about 5 fps with timestamps into contact sheets to judge the motion (2026-10-14).

Add new verdicts and lessons here, dated, in the commit that acts on them.
