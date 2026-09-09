# Journey e2e (J1–J4)

Real `datatug serve` agent, real demo project, no HTTP route interception — see
`journey.spec.ts`'s own header for why (contrast with `../root-and-login.spec.ts`,
which stubs the backend on purpose). `store-id-scheme.spec.ts` (same directory)
reuses the same `agentServer` fixture for the same reason.

Both specs `test.skip()` themselves — the whole `journey` project is skipped, not
failed — when the fixture below cannot resolve a demo project or a `datatug`
binary. That is what "run it instead of skipping it" (the specs' own header
comments) means: without the env vars below, this project simply does not run.

## Env vars (read directly by `fixtures/agent-server.ts`)

| Var | Meaning |
|---|---|
| `DATATUG_DEMO_DIR` | Path to a `datatug-demo-projects/demo-project-1` checkout. If unset, the fixture tries `../datatug-demo-projects/demo-project-1` one, two and three directories above the repo root (covers both a plain sibling-checkout layout and a nested `<repo>/.worktrees/<task>/...` worktree). |
| `DATATUG_BIN` | Path to an already-built `datatug` binary. Takes priority over `DATATUG_CLI_DIR` when both are set. |
| `DATATUG_CLI_DIR` | Path to a `datatug-cli` checkout; the fixture runs `go build -o <tmp>/datatug .` in it once per worker (needs `go` on `PATH`). Ignored if `DATATUG_BIN` is set. |

CI must set `DATATUG_BIN` (a released binary — the CLI repo publishes release
binaries; the Homebrew cask is `datatug`) or `DATATUG_CLI_DIR` (a `datatug-cli`
checkout with `go` available), plus `DATATUG_DEMO_DIR` unless the sibling-checkout
default layout already satisfies it.

## Local run recipe

```sh
# 1. Build datatug from the CLI repo root (main.go, not apps/datatugapp — that
#    path does not exist).
cd ~/projects/datatug/datatug-cli
go build -o /tmp/datatug .

# 2. datatug demo must run ONCE first, against ANY project, purely to fetch the
#    Chinook SQLite fixture into the shared ~/datatug/dbs/ path. serve --project
#    does not fetch this dependency itself — its absence surfaces as an
#    undocumented 500 INTERNAL ("unable to open database file") on the first
#    endpoint that touches it (semantic/columns, exec/run_query, ...), not a
#    documented api-contract.md error code.
/tmp/datatug demo &   # admin principal; Ctrl-C or kill once it has fetched the DB
# (only needed the first time on a given machine/user - ~/datatug/dbs/ persists)

# 3. Run the suite with the fixture's own env vars, from datatug-apps:
cd ~/projects/datatug/datatug-apps
DATATUG_BIN=/tmp/datatug \
DATATUG_DEMO_DIR=~/projects/datatug/datatug-demo-projects/demo-project-1 \
pnpm exec nx run datatug-app:e2e
```

The `agentServer` fixture spawns its own `datatug serve --project <DATATUG_DEMO_DIR>
--as admin ...` on a free port per worker — you do not start `serve` yourself for
the automated suite. (A manual `datatug serve --as support --role support --port
8989 --project <dir>` session, run separately and inspected by hand with `curl`,
is a different, non-automated way to sanity-check the agent directly; it is not
what this fixture uses.)

## Known blockers (see `journey.spec.ts`'s own header for the authoritative,
kept-current account)

J1–J4 are deliberately left un-skipped even while they fail, so CI reports the
real, current blocker rather than a false green. J4 (S100) now runs against
its own `supportAgentServer` fixture (`--as support --role support`) rather
than staying `test.fixme`, and currently fails at its first assertion on a
schema-prefix mismatch between the real browser's requests and the demo
policy fixture (see `journey.spec.ts`'s own header and J4 test comments for
the confirmed root cause and evidence). As of the header's own last update,
remaining blockers are server-side (`datatug-cli`/`datatug-core` contract or
`datatug-demo-projects` fixture issues), not this repo's own client code —
check the spec header before assuming a new failure here is client-side.
