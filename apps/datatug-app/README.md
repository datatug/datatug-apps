# DataTug.app — an app for working with data.

## Build info

The side menu's footer is the shared
[`AppVersionComponent`](https://github.com/sneat-co/sneat-libs/blob/main/libs/components/src/lib/app-version/README.md)
from `@sneat/components` (`<sneat-app-version />`, wired in
`libs/datatug/main/src/lib/menu/datatug-menu.component.html`) — a
collapsed-by-default row showing the Sneat.Work copyright line; tapping it
reveals the app version, a short git hash, and the UTC build timestamp. The
same three values are written to a static `build-info.json` at the root of
the built app, so you can check which commit is actually live without
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
`AppVersionComponent` (`@sneat/components`) reads through the shared
`BUILD_INFO` injection token — the same runtime contract every Sneat app
that mounts `<sneat-app-version />` consumes, so no app-specific wiring is
needed beyond `provideBuildInfo()`.

`@sneat/components@0.27.23` (this repo's pinned version — see the root
`package.json`/`pnpm-workspace.yaml`) ships `AppVersionComponent` with the
collapsed-by-default row, Sneat.Work copyright link, and the same
`data-testid` hooks (`build-info-toggle`, `build-info-chevron`,
`build-info-version`, `build-info-hash`) this app's e2e suite
(`apps/datatug-app/e2e/build-info.spec.ts`) asserts against, scoped under
the `sneat-app-version` element.

## DataTug API failover

`DatatugApiService` (`libs/datatug/main/src/lib/services/base/`) can send one DataTug API
request to an ordered list of base URLs for the same Cloud Run service: the primary
(`api.datatug.app`, behind Cloudflare) and a fallback (`api2.datatug.app`, DNS-only Cloud Run
domain mapping). It fails over by itself; nobody has to do anything while the primary is down.
`SneatApiService`, checkout and auth are untouched. Client code never contains a `run.app` URL.

**It is off in production today.** With the default, `DatatugApiBaseUrls` is just
`[DatatugApiBaseUrl]` (which mirrors `SneatApiBaseUrl`, `https://api.sneat.cloud/v0/`), and the client
behaves exactly as before.

### The one-line switch

Once both hosts exist, add this provider to `datatugEnvironmentProviders` in
`apps/datatug-app/src/environments/environment.prod.ts` (today `[]`), and change the
expectation in `environment.providers.spec.ts` that production adds no override:

```ts
{ provide: DatatugApiBaseUrls, useValue: ['https://api.datatug.app/v0/', 'https://api2.datatug.app/v0/'] },
```

Both URLs end with `/`, the primary first. `DatatugApiBaseUrls` and `DatatugApiFailoverConfig` are
exported by `@sneat/datatug-semantic`.

### What fails over

| Request | Retried on the next base URL after |
| --- | --- |
| GET, HEAD | network error (status 0), 8 s without an answer, 502, 503, 504, Cloudflare 520-523, 525, 526 |
| POST, PUT, PATCH, DELETE | only what proves the request never reached the server: network error (status 0), Cloudflare 521, 522, 523 |
| any | never on 4xx, on an application 5xx, or on Cloudflare 524 (the origin may have acted) |

The retry is the same request: same method, params, body and `Authorization` header.

### Circuit breaker (in memory, per page session)

After a request succeeded on the fallback following a failure on the primary, the fallback is
preferred for `breakerMinutes` (default 5). After that the next GET/HEAD tries the primary first and
switches back when it answers; if it fails again the fallback is held for another interval.
POST/PUT/PATCH/DELETE never probe the primary, they use whichever host is preferred.

### Timeout

Only GET/HEAD get a timeout, and only while another base URL is left to try (the last one waits as long
as the browser allows). `primaryTimeoutMs` defaults to 8000: a cold Cloud Run start and normal reads finish
in a few seconds, and a hard-down primary (DNS, TLS, connect, Cloudflare 52x) fails faster than that. A
timeout does not prove a write never happened, so writes get no timeout and are never retried on one:
`datatug/queries/run_query`, `datatug/detective/*` (AI calls) and other long writes run as long as they need.
GETs under `slowEndpointPrefixes` (detective, exec, run_query, `session-context/detective`,
`projects/query_activity_context`) use `slowEndpointTimeoutMs` (60000) instead. Override all of it with:

```ts
{ provide: DatatugApiFailoverConfig, useValue: { ...DEFAULT_DATATUG_API_FAILOVER_CONFIG, breakerMinutes: 10 } },
```

### Known limit

A browser reports a Cloudflare error page without CORS headers as status 0, so a POST that Cloudflare
answered with 524 may look like a network error and be sent again. DataTug write endpoints that cannot
tolerate that must be idempotent server-side.

### Logging

Each failover logs a warning (`DataTug API failover`) through `LOGGER_FACTORY` and an
`datatug_api_failover` analytics event with `method`, `fromHost`, `toHost` and `reason` only: no endpoint,
query string or body.

## Business project preview (port 18782)

The local Business project preview serves the app on `http://localhost:18782`,
the one origin datatug-cloud-preview admits. Its serve configuration
(`business-preview` in `apps/datatug-app/project.json`) swaps in
`environment.business-preview.ts`, which sends only DataTug API calls
(`DatatugApiBaseUrl`) to the datatug-cloud-preview origin. Sneat identity keeps
its normal origin, and checkout is forced to TEST (see below).

```sh
pnpm nx run datatug-app:serve:business-preview
```

In this build every checkout rail is TEST. `DATATUG_CHECKOUT_FORCE_TEST` is true
(`environment.business-preview.ts`), so `checkoutRail` selects TEST for every valid
Pro and Business selection, with or without `?checkout=test`. A LIVE return
session is refused rather than rebound to TEST. Business's LIVE origin is null and
LIVE is off in this build. `SneatApiBaseUrl` is unchanged, and production is unchanged
because the flag defaults to false.

datatug-cloud-preview answers 404 to everything except
the project read, save and create routes, so Detective, session context, GitHub
connection and AI eligibility pages will fail on this origin.
