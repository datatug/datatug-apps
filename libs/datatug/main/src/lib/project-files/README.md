# Project files: the two formats of the demo project

Schemas, types and validators for the two files the demo project adds (design
`demo-as-github-project.md` 5.2a, written by the repo `datatug/chinook-demo`, read by the app), and a
recorded fixture of the project in the new layout. Added by task G-K1. Nothing here is imported by shipped
code yet; none of it is exported from the library barrel.

| File                                              | Schema                                   | Types and validator     |
| ------------------------------------------------- | ---------------------------------------- | ----------------------- |
| `ai/prepared-questions.json`                      | `schemas/prepared-questions.schema.json` | `prepared-questions.ts` |
| `<catalog>.db.json` with `"driver": "https-json"` | `schemas/https-json-catalog.schema.json` | `https-json-catalog.ts` |

- **Schemas** are JSON Schema 2020-12 and say everything a schema can: shapes, sizes, patterns, unknown keys
  refused, https-only addresses without credentials or ports. The repo lane's CI validates against them,
  fetched from this repository **at a pinned commit** (a tag can be moved):
  `https://raw.githubusercontent.com/datatug/datatug-apps/<commit>/libs/datatug/main/src/lib/project-files/schemas/<name>.schema.json`.
- **Validators** are what the app runs: hand-written, no dependency, no `eval` (a schema compiler would need
  one under the content-security policy planned in G-H1). They add what a schema cannot state:
  loopback, private and link-local hosts by name and by number (`project-address-rules.ts`); the allow-list of
  address prefixes for a **trusted** project (`ProjectTrust`, always passed by the caller, never defaulted);
  unique question ids; a question's `query` existing in the project (pass `knownQueryIds`); a checksum for
  every keyed table when a fallback address is given. `project-file-schemas.spec.ts` feeds both the same
  documents and fails if they disagree.
- **A URL is fetched only through `expandUrlTemplate`.** A catalog holds URL _templates_. A template is held to
  a fixed pattern (`checkUrlTemplate`): `{table}` exactly once, in a path segment that starts with a letter or
  digit; no `%`, `?` or `#` anywhere; no empty segment and no segment that starts with a dot; for a trusted
  project, an allowed prefix. `expandUrlTemplate(template, table, trust)` validates the table name (a letter,
  then letters, digits and underscores), fills the placeholder, parses the result, and checks the parsed URL
  (the one the browser requests) again against the general rules and, for a trusted project, the prefix list.
  It returns a `CheckedDataUrl` (`.href`), which nothing else makes; `tableUrls(catalog, table, trust)` does it for
  both templates of a catalog. A bare string must never reach `fetch`.
- **The size cap is the caller's to enforce on the stream.** `parse*` measure text that is already in memory
  (256 KB, in bytes, a leading byte order mark counted and then dropped). The fetching code (G-A2) must stop
  reading a response once it has more than the cap, and refuse redirects; downloading the whole body and
  measuring afterwards would not bound memory.
- **A jsDelivr pin is only as trustworthy as the trusted project's own file.** The allow-list accepts any
  40-hex commit under `datatug/chinookdb`, and GitHub serves a fork's commits through the parent
  repository's address (design 3.6). That is why the prefix is accepted for a trusted project only, whose
  own catalog file names the commit, and why a mirror's rows count only when their SHA-256 equals the
  project's (4.8).
- **Strings are text.** There is no markup field; the validators carry markup through unchanged and the page
  must render every string as text (3.6). Unknown keys are refused, never ignored.
- **The fixture** (`fixtures/chinook-demo/`, see `fixtures/chinook-demo.README.md`) is the project at the root
  of `datatug/chinook-demo` plus the new files. The three `web` files are under `web/`, not
  `environments/web/`, until the CLI accepts the new drivers: see that README for why and for the one CLI
  change that later moves them (a path change only).
