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
