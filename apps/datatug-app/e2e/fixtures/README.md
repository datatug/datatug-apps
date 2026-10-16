# Context Bag provider journey fixture

Validated on macOS with CLI source `cd1468aff2a2ae13337624ac273efdead0f4ba98`, Core `v0.57.1`, and the PR-source app described below. Fresh fixture creation, stub and real DeepSeek journeys, and owned-service cleanup passed. This remains an opt-in local integration test; it does not establish a deployed hosted journey.

The journey uses a private synthetic Chinook project, a normal authenticated CLI agent, the Context Bag UI, and either the provider stub or an explicitly approved real DeepSeek request. It does not use production account data. The fixture generator starts no listener, makes no source query, and contains no provider credential.

## Prerequisites

- `datatug-cli` source using Core `v0.57.1` or later, with the proof-only `contextnativefixture` build tag available. This tag is for the isolated fixture binary; do not enable it in a release build.
- A DataTug Apps checkout containing the Context Bag change from PR #326 and the normal agent authentication change from PR #327. Until those changes are merged, this is a PR-source setup, not a `main`-branch procedure.
- Go and the Apps workspace dependencies installed.
- The public Chinook SQLite fixture at an explicit local path. The generator accepts only a regular file of 1,007,616 bytes with SHA-256 `7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15`.
- For the real-provider run only, `DEEPSEEK_API_KEY` already present in the test process environment. Never put the key in a command argument, fixture, exported browser state, screenshot, trace, or log.

## Prepare the isolated fixture

Run the following from the `datatug-cli` module root so Go resolves the repository modules. Set `chinook_sqlite` to the explicit path of the public fixture. Use a new private temporary directory for each run; the helper refuses an existing root and removes a partially-created root if setup fails.

```sh
fixture_parent="$(mktemp -d "${TMPDIR:-/tmp}/context-browser-fixture.XXXXXX")"
chmod 700 "$fixture_parent"
fixture_root="$fixture_parent/browser-fixture"
native_bin="$fixture_parent/datatug-native-fixture"
chinook_sqlite="/absolute/path/to/chinook.sqlite"
apps_checkout="/absolute/path/to/datatug-apps"

GOWORK=off go build -tags=contextnativefixture -o "$native_bin" .
GOWORK=off go run "$apps_checkout/apps/datatug-app/e2e/fixtures/prepare-browser-fixture.go" \
  --root "$fixture_root" --sqlite "$chinook_sqlite"
```

The helper creates the project, local SQLite catalog, invoice query, private evidence directory, one session and selected invoice entry, plus the local Check/Case inputs. It prints the fixture root and fixed synthetic IDs only. Do not reuse the directory for valuable data.

## Start the owned local services

Keep each service in a named, visible terminal owned by the operator running this recipe. Record the exact process/terminal IDs. Do not reuse or stop a listener owned by another task. The app checkout must be the PR-source checkout described above.

In the Apps workspace, start the UI:

```sh
pnpm nx run datatug-app:serve:development --host 127.0.0.1 --port 8181 --allowed-hosts datatug.localhost
```

In a second terminal, start the normal authenticated CLI agent using the private project and evidence directory:

```sh
DATATUG_TELEMETRY=0 \
DATATUG_UI_BASE=http://datatug.localhost:8181 \
DATATUG_DAEMON_DIR="$fixture_root/agent-state" \
"$native_bin" serve --host 127.0.0.1 --port 8989 \
  --project "$fixture_root/project" --as context-fixture-owner \
  --allow-writes --evidence-dir "$fixture_root/private"
```

Use the normal one-time link exchange in the browser. Do not disable authentication or inject a token. Confirm the UI and agent are the expected owned services before running the journey.

## Run stub, then real provider

From the Apps workspace, run the opt-in Playwright test in stub mode first:

```sh
DATATUG_CONTEXT_BAG_PROVIDER_TEST=1 \
DATATUG_CONTEXT_BAG_PROVIDER_DRY_RUN=1 \
DATATUG_BIN="$native_bin" \
DATATUG_DAEMON_DIR="$fixture_root/agent-state" \
./node_modules/.bin/nx run datatug-app:e2e-context-bag-provider
```

Only after the stub journey passes, run the real provider journey with the already-configured key inherited by the process. This sends a real DeepSeek request; do not automatically retry after dispatch.

```sh
test -n "${DEEPSEEK_API_KEY:-}" || { echo "DEEPSEEK_API_KEY is not configured in this shell" >&2; exit 1; }
DATATUG_CONTEXT_BAG_PROVIDER_TEST=1 \
DATATUG_CONTEXT_BAG_PROVIDER_DRY_RUN=0 \
DATATUG_BIN="$native_bin" \
DATATUG_DAEMON_DIR="$fixture_root/agent-state" \
./node_modules/.bin/nx run datatug-app:e2e-context-bag-provider
```

The test is expected to prove the synthetic Invoice ID context is pinned to the provider request, the SQLite-backed result reflects that selection, and editing/clearing the bag followed by reload does not cause an implicit provider or source rerun. Record exact request counts and test revision/commit with the result; do not include credentials or full prompts in receipts.

## Cleanup

Stop only the two exact service processes started in this run, using Ctrl-C in their owned terminals. Confirm ports 8181 and 8989 have no listener before removing fixture files. Graceful CLI shutdown should remove its agent access key; verify `$fixture_root/agent-state/access-8989.key` is absent. If it remains, remove only that exact fixture-owned key after confirming the owned CLI process is stopped. Then remove only the newly-created `$fixture_parent` directory. Never delete or modify the original Chinook SQLite input.

The successful real run made one provider POST (HTTP 200), returned two InvoiceLine rows for Invoice ID 1, then edited/applied Invoice ID 2 and cleared the bag. Reload retained the original pinned input and rows with no additional provider POST or SQL worker dispatch. Traces and videos stay disabled; the final screenshot is taken after the test removes its provider configuration and is written beneath Playwright's ignored output directory. Provider test retries are disabled.
