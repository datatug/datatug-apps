# DataTug.app — an app for working with data.

## Build info

The side menu's footer
(`libs/datatug/main/src/lib/menu/build-info/menu-build-info.component.ts`)
is a collapsed-by-default row showing the Sneat.Work copyright line; tapping
it reveals the app version, a short git hash, and the UTC build timestamp.
The same three values are written to a static `build-info.json` at the root
of the built app, so you can check which commit is actually live without
opening the app:

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

All three values are produced by `sneat-stamp-build-info`
(`@sneat/build-info`'s published bin — see
[sneat-co/sneat-libs' `libs/build-info/README.md`](https://github.com/sneat-co/sneat-libs/blob/main/libs/build-info/README.md)
for the generic contract every Sneat app wires up the same way), run via the
`stamp-build-info` Nx target and wired as a dependency of the `datatug-app`
`build` and `serve` targets (`apps/datatug-app/project.json` —
`targets.build.dependsOn` / `targets.serve.dependsOn: ["stamp-build-info"]`),
so it always runs automatically; there is no manual step on either build
path:

- **GitHub Actions CI** (`.github/workflows/ci.yml`'s `build`/`e2e`/`journey`
  jobs) — no Cloudflare env vars are present, so the bin falls back to
  `GITHUB_SHA` (set by GitHub Actions itself).
- **Cloudflare Workers Builds** (deploys `datatug.app` from `main` on every
  push, per `wrangler.jsonc`'s `assets.directory:
./dist/apps/datatug-app/browser`, running this repo's own `pnpm nx build
  datatug-app` — see the root `README.md` "Quick start") — the bin reads the
  commit SHA from the `WORKERS_CI_COMMIT_SHA` environment variable Cloudflare
  injects by default
  ([Cloudflare docs](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#environment-variables)),
  falling back to `CF_PAGES_COMMIT_SHA`, then `GITHUB_SHA`, then
  `git rev-parse HEAD` if all of those are absent.

Unlike the previous local `tools/stamp-build-info.mjs`, the shared bin never
touches a tracked file: `apps/datatug-app/src/build-info.ts` stays committed
with its placeholders (`version: 'version t0be$et'`, `gitHash: 'gitHash
t0be$et'`, `buildTimestamp: 'timestamp t0be$et'`) at all times, and the
`stamp-build-info` target stamps a gitignored copy instead —
`apps/datatug-app/src/build-info.generated.ts` — which an Angular
`fileReplacements` config (`apps/datatug-app/project.json`'s `build` and
`serve` configurations) swaps in for `./build-info` at build time. So `git
status` stays clean after `pnpm nx build datatug-app` or `pnpm nx serve
datatug-app`, and a fresh clone that has never been built still compiles
fine, showing the committed placeholders.

`build-info.spec.ts` guards the committed file by reading its _committed_
blob via `git show HEAD:...` (never the working copy — see that spec for
why). The same placeholders can also be checked directly:

```sh
pnpm nx run datatug-app:check-build-info
# sneat-stamp-build-info --check --ts apps/datatug-app/src/build-info.ts
```

`apps/datatug-app/src/build-info.generated.ts` and
`apps/datatug-app/src/build-info.json` (the file the `build-info.json` HTTP
endpoint above is copied from) are both `.gitignore`d — neither is ever
committed.

The side menu wires this up via `provideBuildInfo(buildInfo)`
(`apps/datatug-app/src/main.ts`, `@sneat/core-public`), which
`MenuBuildInfoComponent` reads through the `BUILD_INFO` injection token —
the same runtime contract
[sneat-libs' `AppVersionComponent`](https://github.com/sneat-co/sneat-libs/blob/main/libs/components/src/lib/app-version/README.md)
(`<sneat-app-version />`) consumes.

**Not yet swapped for `<sneat-app-version />` itself.** sneat-libs' own repo
has redesigned that component to match this one exactly (collapsed by
default, Sneat.Work copyright link, same `data-testid` hooks), but as of this
change that redesign is only in sneat-libs' source tree — the published
`@sneat/components` (0.27.22, the latest on npm; 0.27.23 doesn't exist for
that package yet even though its own `package.json` already reads 0.27.23)
still ships the *old* shape: an always-expanded "App version" card with no
collapse, no copyright line, and none of the `data-testid` hooks this app's
e2e suite depends on. Swapping today would be a real UI regression and would
break `apps/datatug-app/e2e/build-info.spec.ts`. `MenuBuildInfoComponent`
(`libs/datatug/main/src/lib/menu/build-info/menu-build-info.component.ts`)
is deliberately written so that swap is a pure deletion once sneat-libs
publishes a `@sneat/components` release containing the redesign — no
provider wiring changes needed, since `provideBuildInfo()`/`BUILD_INFO`
already come from the shared `@sneat/core-public` package.
