# Running DataTug locally

From this repository, start the full local stack in one foreground terminal:

```bash
scripts/local-stack.sh
```

Open <http://datatug.localhost:4200>. The dev server binds to loopback and
accepts this explicit local hostname. The browser calls the Sneat API directly
at `http://127.0.0.1:8090/v0/`; the backend's local development CORS allowlist
is set by the launcher through `KNOWN_HOSTS=datatug.localhost:4200`. This is a
per-process development setting; it does not change production host policy.
Press **Ctrl-C** in that terminal
to stop every service started by the script. It checks ports before starting and never kills
an existing listener. If a service exits, the supervisor stops the rest and
prints the relevant log tails.

Before the first run, install the workspace dependencies with `pnpm install`,
make the Firebase CLI and `datatug` CLI available on `PATH`, and install JDK
21 for the Firebase emulators. Set `JAVA_HOME` to that JDK and include its
`bin` directory on `PATH` before launching the script. Go is also needed when
`SNEAT_GO_BIN` is not set. The app's startup preparation downloads a private
Core browser artifact, so `gh` must be authenticated with read access to that
artifact. Pass its token only to this invocation:

```bash
GH_TOKEN="$(gh auth token)" scripts/local-stack.sh
```

This keeps the token in the process environment rather than writing it to the
repository or runtime files.

The stack uses these local services:

| Service | Address | Notes |
| --- | --- | --- |
| DataTug.app | `http://datatug.localhost:4200` | Angular dev server bound to loopback |
| Sneat API | `http://127.0.0.1:8090/v0/` | Runs the `sneat-go` checkout, or `SNEAT_GO_BIN` if set |
| DataTug agent | `http://127.0.0.1:8989` | Runs the installed `datatug serve` CLI against the demo project |
| Firebase Auth emulator | `127.0.0.1:9099` | Firebase project `demo-local-sneat-app` |
| Firestore emulator | `127.0.0.1:8180` | Uses Sneat's shared Firestore rules and indexes |
| Firebase Emulator UI | <http://127.0.0.1:8070> | Auth and Firestore views |

Firestore uses port **8180** to keep this stack separate from the shared
emulator setup on 8080. The DataTug development environment points at 8180;
keep that setting and the launcher's port aligned if you change either one.
The Firebase config is generated under the runtime directory with absolute paths
to `sneat-firebase/firebase/firestore.rules` and `firestore.indexes.json`. The
shared Firebase config and Sneat emulator scripts are not modified or run,
because their default project and ports belong to the Sneat.app stack.
The launcher sets the Sneat API's `PORT` to 8090 because the app's local
configuration calls that port; the backend's own default is 4300. The URL above
is the address the local browser app calls.

## Repositories and shared guidance

The launcher expects these sibling checkouts under `~/projects`:

- `sneat-co/sneat-go` for the Sneat API host.
- `sneat-co/sneat-firebase` for the common emulator config, rules and indexes.
- `datatug/datatug-demo-project` for the sample DataTug project.
- This `datatug/datatug-apps` checkout for the UI.

For the shared platform details, see the [Sneat local stack guide](https://github.com/sneat-co/sneat-apps/blob/main/docs/RUN-LOCAL.md) and its [`scripts/local-stack.sh`](https://github.com/sneat-co/sneat-apps/blob/main/scripts/local-stack.sh), the [sneat-go emulator instructions](https://github.com/sneat-co/sneat-go/blob/main/README.md#running-with-emulators), and the [Firebase emulator docs](https://github.com/sneat-co/sneat-firebase/blob/main/firebase/README.md). The shared Firebase repository also has [`scripts/serve_fb_emulators.sh`](https://github.com/sneat-co/sneat-firebase/blob/main/scripts/serve_fb_emulators.sh); that script uses Sneat.app's default project and ports, so this DataTug launcher reuses the checked-in rules/indexes while generating a project-specific config. This guide supplies the extra DataTug agent and its distinct ports and project setup.

If repositories are in another location, set `DATATUG_REPOS_DIR` to their
common parent. Individual paths can be overridden with `SNEAT_GO_DIR`,
`SNEAT_FIREBASE_DIR` (the `firebase` directory itself), and
`DATATUG_DEMO_PROJECT_DIR` (the `demo-project-1` directory). Use
`DATATUG_BIN` to select a DataTug CLI executable. Set `SNEAT_GO_BIN` to run a
prebuilt Sneat API binary instead of compiling with `go run .`.

## DataTug agent permissions and local state

By default the agent runs as `local-dev` with the sample project's `admin`
role, but project mutation routes remain disabled. To exercise those routes,
set `DATATUG_LOCAL_WRITES=1` before starting. The launcher copies the demo
project to its private runtime directory, then enables writes against that
copy; the canonical `datatug-demo-project` checkout is never used as a write
target. The copy persists across runs so local edits remain available.

`datatug serve` prints a one-time link for its hosted UI in
`$DATATUG_LOCAL_STACK_DIR/logs/agent.log` (or the default runtime directory's
`logs/agent.log`). Open that file locally, copy the link, and replace only its
origin with `http://datatug.localhost:4200`; preserve the full path and fragment so the
`/store` route and one-time code remain intact. Open the adjusted link in the
local app to exchange the code. The log contains a credential: do not paste the
link into chat, issues, or other shared output. The launcher sets a restrictive
umask and removes group/other access from the runtime directory and its files.
It does not open the browser automatically.

The runtime directory defaults to
`~/projects/.wb/local-stack/datatug-apps`. It contains the owner note, service
logs, Firebase emulator data, and (when writable mode is enabled) the private
project copy. Override it with `DATATUG_LOCAL_STACK_DIR`. Use the `pids` file
only to identify this stack's processes if its terminal was lost; inspect each
PID before manually stopping it. The normal teardown command is Ctrl-C in the
foreground supervisor.

The CLI itself is documented in the [DataTug repository](https://github.com/datatug/datatug-cli); run `datatug serve --help` for its current options.
