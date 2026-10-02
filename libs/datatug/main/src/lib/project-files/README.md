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
- **Strings are text.** There is no markup field; the validators carry markup through unchanged and the page
  must render every string as text (3.6). Unknown keys are refused, never ignored.
- **The fixture** (`fixtures/chinook-demo/`, see `fixtures/chinook-demo.README.md`) is the project at the root
  of `datatug/chinook-demo` plus the new files. The three `web` files are under `web/`, not
  `environments/web/`, until the CLI accepts the new drivers: see that README for why and for the one CLI
  change that later moves them (a path change only).
