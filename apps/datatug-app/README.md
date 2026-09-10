# DataTug.app — an app for working with data.

## Build info

The side menu (`libs/datatug/main/src/lib/menu/build-info/`) has a
collapsed-by-default footer row at the bottom (the Sneat.Work copyright
line); tapping it reveals the app version, a short git hash, and the UTC
build timestamp. The same three values are written to a static `build-info.json`
at the root of the built app, so you can check which commit is actually live
without opening the app:

```sh
curl https://datatug.app/build-info.json
# {"version":"0.1.0+3","gitHash":"<40-char sha>","buildTimestamp":"<ISO 8601 UTC>"}
```

`version` comes from the nearest reachable release tag (`vX.Y.Z`, via
`git describe`): exactly on the tag it is `X.Y.Z`, N commits past it
`X.Y.Z+N`. When no tag is reachable (a shallow clone without tags, as some
hosted build environments produce), it falls back to the workspace root
`package.json`'s `"version"` field, which is bumped together with every
release tag so both agree (this repo has no separate
`apps/datatug-app/package.json`). Releases: bump `package.json`, merge, then
tag main `vX.Y.Z`.

Both values are produced by `tools/stamp-build-info.mjs`, wired as an Nx
dependency of the `datatug-app` `build` and `serve` targets
(`apps/datatug-app/project.json` — `targets.build.dependsOn` /
`targets.serve.dependsOn: ["stamp-build-info"]`), so it always runs
automatically; there is no manual step on either build path:

- **GitHub Actions CI** (`.github/workflows/ci.yml`'s `build`/`e2e`/`journey`
  jobs) — no Cloudflare env vars are present, so the script falls back to
  `git rev-parse HEAD` (a normal checkout via `actions/checkout`).
- **Cloudflare Workers Builds** (deploys `datatug.app` from `main` on every
  push, per `wrangler.jsonc`'s `assets.directory:
./dist/apps/datatug-app/browser`) — the script reads the commit SHA from
  the `WORKERS_CI_COMMIT_SHA` environment variable Cloudflare injects by
  default ([Cloudflare docs](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#environment-variables)),
  falling back to `CF_PAGES_COMMIT_SHA` and then `git rev-parse HEAD` if
  that's ever absent.

The script rewrites two placeholder values in
`libs/datatug/main/src/lib/menu/build-info/build-info.ts` **in the working
tree only** — that file's committed content must always keep the
placeholders (`gitHash: 'gitHash t0be$et'`, `buildTimestamp: 'timestamp
t0be$et'`); never `git add`/`git commit` after running the script by hand.
`build-info.spec.ts` guards this by reading the _committed_ blob via
`git show HEAD:...`, not the working copy. `apps/datatug-app/src/build-info.json`
(the file the `build-info.json` HTTP endpoint above is copied from) is
`.gitignore`d for the same reason.
