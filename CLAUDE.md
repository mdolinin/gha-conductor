# gha-conductor

Probot 14 GitHub App (TypeScript ESM, Node 24 via `.nvmrc`, Postgres via `@databases/pg-typed`). Yarn 4 (`corepack enable`).

## Commands
- `yarn build` - tsc type-check + compile to `lib/`. **CI only runs `yarn test` (vitest), never tsc**, so always run `yarn build` locally before pushing.
- `yarn test --run` - unit tests (vitest; octokit and DB are mocked)
- `yarn db:migrate` - apply `migrations/` to `DATABASE_URL` from `.env` (idempotent)
- `node ./lib/main.js` - run the app locally; with `WEBHOOK_PROXY_URL` in `.env` it receives webhooks via smee
- `node lib/healthcheck.js` - same check as Docker HEALTHCHECK (`GET /api/health`)

## Probot 14 gotchas
- Only the `probot` package root is importable (`exports` map); never deep-import `probot/lib/...`.
- REST calls must go through `octokit.rest.<api>` (e.g. `octokit.rest.checks.create`); `octokit.checks` is undefined at runtime. Test mocks nest the same way: `{rest: {checks: {...}}, paginate}`.
- HTTP routes use `addHandler((req, res) => boolean)` (no Express/getRouter); `addHandler` throws "No server instance" outside `Server`, so wrap it.
- Webhook payload types come from `@octokit/openapi-webhooks-types` (`components["schemas"]["webhook-..."]`), and many fields are nullable or optional.
- `import "dotenv/config"` must stay the first import in `src/main.ts`, because `db/database.ts` reads `DATABASE_URL` at import time.
- Declare every package `src/` imports in `package.json`; don't rely on probot's transitive deps.

## Data model gotchas
- `gha_workflow_runs.pipeline_run_name` (`<hook>-<head sha>`) is NOT unique (re-triggered hooks); look rows up by `workflow_run_id`/`id`, and update by `id`.
- `runWorkflow` inserts the run row BEFORE dispatching, then binds `workflow_run_id` from the dispatch response (`return_run_details: true` -> 200); on a 204 (GHES) the `workflow_job.queued` handler binds it by name.
- pg-typed `findOne` throws on >1 match; for non-unique keys use `find(q).orderByDesc("id").first()`.

## Releases & PRs
- semantic-release on push to `main`: only `fix:`/`feat:`/`perf:` release (v1.22.x); `build:`/`ci:`/`chore:` don't. Squash-merge uses the PR title, so the PR title decides the release.
- Dependabot PRs intentionally never release: prefix pinned to `build(deps)` in `.github/dependabot.yml`.
- Dependabot auto-merge runs with `GITHUB_TOKEN`, so its merges trigger no Test/Release runs on `main` (by design).
- The `main` ruleset requires 1 approval; GitHub won't let you approve your own PR, so merge it with `gh pr merge <n> --squash --admin`.
- Auto-merge often stalls or gets disabled when `main` moves; if a PR is `CLEAN` and approved, merge it directly with `gh pr merge <n> --squash`.
- `publish.yaml` (multi-arch image to ghcr.io, tag `vX.Y.Z`) runs only on a published release, so Docker action bumps are untested until then.
