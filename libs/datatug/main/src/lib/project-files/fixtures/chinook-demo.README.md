# Fixture: the demo project in the new file formats (task G-K1)

A recorded copy of the files a cold demo run reads (design `demo-as-github-project.md`, 4.3),
laid out as the root of the repo `datatug/chinook-demo`, with the two new formats of 5.2a. Later
tasks (G-A3b, G-A4a to G-A4c, and the repo lane's `web-files` CI job) test against it instead of
the network. It is a copy, not a sample: every row the saved query can reach is here.
`chinook-demo.manifest.json` lists every file with its size, SHA-256 and origin;
`chinook-demo-fixture.spec.ts` fails if a file is added, removed or changed without the manifest.

## Where each file comes from

| Files                                                                                                                                                                                            | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `datatug-project.json`, `queries/sales/chinook-sales-per-capita.query.{json,dtql}`, `entities/Country/Country.entity.json`, `dbmodels/chinook/main/tables/<T>/main.<T>.columns.json` (11 tables) | `datatug/datatug-demo-projects` at `0e5b98f86f37f00a3c3be5bbbb515d15620c63c6`, under `demo-project-1/`, byte for byte (CC0-1.0). The same files are at the root of `datatug/chinook-demo` at `0aca65379f49b9c270514fb8b522b1bddca057ff`, which was populated from that commit.                                                                                                                                                                                                                                                                             |
| `data/geo/.web/country_aliases.json`, `data/geo/.web/population_wb.json`                                                                                                                         | The same commit's `demo-project-1/data/geo/<collection>/$records/*.json`, one file per collection: an array of `{ "key", "data" }` in key order, `data` verbatim. 24 and 216 records. This is the one-file layout design 4.3 asks for (`data/geo/.web/<collection>.json`); the format is the one the existing `queries/fixtures/chinook-sales-per-capita` files use.                                                                                                                                                                                       |
| `ai/prepared-questions.json`                                                                                                                                                                     | New. The design's example, with the five wordings PR #173's scenario table has for the one scenario this release can answer.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `web/web.env.json`, `web/catalogs/chinook/chinook.db.json`, `web/catalogs/geo/geo.db.json`                                                                                                       | New. Design 4.8 and 5.2a, verbatim. `geo.db.json` is the same as the `local` environment's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `external/chinookdb.com/data/json/chinook.Invoice.json`                                                                                                                                          | `https://chinookdb.com/data/json/chinook.Invoice.json`, taken from `datatug/chinookdb` `public/data/json/chinook.Invoice.json` (the repo that site is built from) at `0b6bb6ba22f680c9fb2fea9ec8107a8638dd8dc4`, the commit the mirror address pins. 115,781 bytes, SHA-256 `88eb7faede360988e9c0f8f8d107e5093db5e712141de14d868f8947b43c373c`, 412 rows. It is not a project file: the project only declares where to read it. The path under `external/chinookdb.com/` is the URL's, so a file server standing in for the host can serve that directory. |

## Why the three `web` files are under `web/`, not `environments/web/`

Orchestrator decision, following the design's own fallback in 5.2a. **MEASURED** on 2026-10-02 with the
CLI released as v0.52.0 (and 0.51.0): `datatug validate`, which is what `datatug/datatug-action` runs
on every push, and the project loader behind it, refuse an environment whose server entry names a driver
other than `sqlite3`, `sqlserver`, `mysql` or `oracle`:

    invalid env db server at index 0: bad value for field [driver]: unexpected value: https-json.

(`ingitdb` is refused the same way.) The cause is `datatug-core` `pkg/datatug/server.go:86`, the
`default` branch of `ServerRef.Validate`. Under `web/` at the project root the same files validate
(`DataTug project is valid.`, exit 0), because the loader looks only in `environments/`.

A later CLI task moves them. It must teach `ServerRef.Validate` (`datatug-core`
`pkg/datatug/server.go:86`) the file-like drivers `https-json` and `ingitdb`: no host, no port, like
`sqlite3` (today's `case "sqlite3"` returns nil after rejecting a host or a port), then release
`datatug-core` and the CLI. After that release the three files move to `environments/web/` with a change of
path and nothing else: the schemas and validators in this directory describe each document, not where it
is stored, and `web.env.json` already says `https-json` and `ingitdb` as the design shows. Until then the
app's loader looks for the three files in `web/`, and in `environments/web/` once it exists.

## What the fixture proves

`chinook-demo-fixture.spec.ts` recomputes the saved query from these files alone, with no network:
24 countries from 412 invoices, Ireland 45.62 / 5,484,367 = 8.32 first, Czech Republic 8.29, Finland 7.37,
USA 1.53 at rank 17 (design 4.8, finding 1). It also checks that the catalog's checksum equals the
Invoice file's, that the prepared question points at the saved query, and that both new files pass their
schemas and validators.

## Attribution

- Project files: CC0-1.0, as `datatug-demo-projects`.
- **World Bank Open Data** (`data/geo/.web/population_wb.json`): indicator SP.POP.TOTL, "Population,
  total", (c) The World Bank, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Modified: the
  most recent observation per country, re-keyed by ISO 3166-1 alpha-2 code, and merged into one file. The
  World Bank does not endorse this data or its changes. Each record's `source_url` is the API call that
  returns it.
- **GeoNames** (behind the alias table): CC BY 4.0, derived and modified; see `data/geo/DATA-LICENSE.md` in
  `datatug/chinook-demo`.
- **Chinook Database** (`external/chinookdb.com/data/json/chinook.Invoice.json`): MIT, Copyright Luis Rocha;
  upstream `lerocha/chinook-database` at `7f67772503d71ba90f19283c38e93923addb43fa`. ChinookDB.com is an
  independent hosted resource and is not the official upstream project.

## Changing it

Edit the files, then regenerate `chinook-demo.manifest.json`: for every file under `chinook-demo/`, one
entry `{ path, bytes, sha256, origin }`, sorted by path. The spec prints the expected values when it fails.
