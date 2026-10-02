# The `/demo` route

`datatug.app/demo?scenario=<id>&q=<question>&lang=<en|ru>` is where datatug.ai and datatug.io send a
visitor. She sees DataTug answer "Which countries buy the most music relative to their population?" from a
real run in her browser: the investigation trace builds step by step, then the grid and chart appear, then
a computed follow-up. No sign-in, no AI. Behaviour is specified in
[`spec/features/demo-investigation`](../spec/features/demo-investigation/README.md).

## Run it locally

```sh
pnpm demo:up        # starts or attaches to everything, prints the demo URL
pnpm demo:down      # stops only what demo:up started
pnpm demo:e2e       # demo:up, the Playwright `demo` project, demo:down
```

`demo:up` needs `ovdb` (>= 0.19), `python3` and `git` on `PATH`, plus checkouts of
`datatug/datatug-demo-projects` and the pinned `datatug/chinook-database` (found beside this repository's
ancestors, or set `DATATUG_DEMO_PROJECTS_DIR` and `CHINOOK_SQLITE`). Nothing in those checkouts is written:
the pinned files are extracted into `tmp/demo-stack` (git-ignored).

| Process | Port | Mode |
| --- | --- | --- |
| OVDB serving the demo project's `chinook` and `geo` databases | 50511 | always its own |
| CORS shim in front of it (`tools/demo-stack/cors-proxy.mjs`) | 50501 | always its own; the port the saved query names |
| Web dev server | `DEMO_WEB_PORT` (4200) | attached when it serves this checkout, else started; any other process on the port is an error |

The shim exists because `ovdb` 0.19.0 answers the CORS preflight with `Authorization,Content-Type` only, so
a browser refuses the `OVDB-Page-Size`/`-Token`/`-Close` headers the federated executor sends. Remove it when
OVDB allows those headers (hosted OVDB needs the same fix).

## Where the demo's knowledge and data come from

`tools/demo-bundle/pin.json` pins one commit of `datatug/datatug-demo-projects`. `pnpm demo:bundle`
regenerates

- `libs/datatug/main/src/lib/demo/bundle/demo-project.bundle.json`: the saved query, the Chinook schema, the
  `Country` entity mappings, attribution, the data files' hashes and the blob ids of every source file read;
- `apps/datatug-app/src/assets/demo-data/ovdb/<db>/<collection>.json`: the rows the three sources serve
  (412 invoices projected to the columns the query declares, 24 aliases, 216 World Bank population records).

`pnpm demo:bundle:check` (run in CI) fails when the bundle, its data files and the pin disagree; add
`--source` to rebuild from the pinned commit and fail on any difference. To move the pin, change `commit`
and run `pnpm demo:bundle`.

Attribution travels with the data and is shown on the page: World Bank Open Data (CC BY 4.0, modified),
Chinook (MIT), GeoNames (CC BY 4.0, derived).

## Data source per environment

`datatugDemoConfig` in `apps/datatug-app/src/environments/` decides whether the route exists (`enabled`, the
`demoRoute` flag) and where the rows come from:

| Environment | `enabled` | Data source |
| --- | --- | --- |
| development, e2e | `true` | the demo project's OVDB at `http://127.0.0.1:50501` |
| production | `false` (one line to change) | `static`: the JSON published with the app under `/assets/demo-data/ovdb` |

In development a visitor-invisible override is available for tests: `localStorage['datatug.demo.dataSource']`
set to `static` or to another OVDB base URL.

The static adapter (`libs/datatug/main/src/lib/demo/data/static-ovdb-fetch.ts`) answers the OVDB wire protocol
from those files inside the query worker, so the join, grouping and arithmetic still run in the browser
engine through `runFederatedQuery`. The result is the same 24 rows (a unit test and an e2e test compare them
with the Go CLI's).

### Switching to hosted OVDB

Needed before the static adapter can be dropped: a public read-only OVDB database `geo` serving
`country_aliases` and `population_wb` (and `countries` for the later "Only Europe" follow-up) beside the
public Chinook database; CORS for `https://datatug.app` that includes the `OVDB-Page-Size`,
`OVDB-Page-Token` and `OVDB-Page-Close` request headers; a base URL for the saved query (the bundle ships the
demo project's `http://127.0.0.1:50501`, which the loader replaces). Then set production's
`dataSource` to `{ kind: 'ovdb', baseUrl }`; nothing else changes.

## Tests

- Unit: `libs/datatug/main/src/lib/demo/**` (trace model, loader, observations, engine, store, components),
  `apps/datatug-app/src/app/demo-handoff-capture.spec.ts`, `tools/__tests__/demo-bundle.test.mjs`.
- E2E: `apps/datatug-app/e2e/demo/` (see its README). Tests that need the OVDB server skip with the command
  to start it; the rest read the static files and run anywhere.
