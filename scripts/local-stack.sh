#!/usr/bin/env bash
# Run DataTug.app, the Sneat API, Firebase emulators and the local DataTug agent.
# See docs/RUN-LOCAL.md for service ownership, ports and teardown.
set -euo pipefail
umask 077

main() {
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  REPOS_DIR="${DATATUG_REPOS_DIR:-$HOME/projects}"
  SNEAT_GO_DIR="${SNEAT_GO_DIR:-$REPOS_DIR/sneat-co/sneat-go}"
  FIREBASE_DIR="${SNEAT_FIREBASE_DIR:-$REPOS_DIR/sneat-co/sneat-firebase/firebase}"
  DEMO_PROJECT_DIR="${DATATUG_DEMO_PROJECT_DIR:-$REPOS_DIR/datatug/datatug-demo-project/demo-project-1}"
  DATATUG_BIN="${DATATUG_BIN:-$(command -v datatug || true)}"
  FIREBASE_BIN="${FIREBASE_BIN:-$(command -v firebase || true)}"
  PROJECT_ID="demo-local-sneat-app"
  AUTH_PORT=9099
  FIRESTORE_PORT=8180
  EMULATOR_UI_PORT=8070
  API_PORT=8090
  AGENT_PORT=8989
  WEB_PORT=4200
  RUNTIME_DIR="${DATATUG_LOCAL_STACK_DIR:-$HOME/projects/.wb/local-stack/datatug-apps}"
  LOG_DIR="$RUNTIME_DIR/logs"

  fail() { printf 'local-stack: %s\n' "$*" >&2; exit 1; }
  for path in "$ROOT/node_modules" "$SNEAT_GO_DIR" "$FIREBASE_DIR/firebase.json" \
      "$FIREBASE_DIR/firestore.rules" "$FIREBASE_DIR/firestore.indexes.json" "$DEMO_PROJECT_DIR"; do
    [ -e "$path" ] || fail "required path is missing: $path (set DATATUG_REPOS_DIR or the corresponding *_DIR override)"
  done
  [ -n "$DATATUG_BIN" ] || fail "datatug CLI not found; install it or set DATATUG_BIN"
  [ -n "$FIREBASE_BIN" ] || fail "Firebase CLI not found"
  command -v pnpm >/dev/null 2>&1 || fail "pnpm not found"
  command -v lsof >/dev/null 2>&1 && command -v nc >/dev/null 2>&1 || fail "lsof and nc are required for port checks and readiness"

  for port in "$AUTH_PORT" "$FIRESTORE_PORT" "$EMULATOR_UI_PORT" "$API_PORT" "$AGENT_PORT" "$WEB_PORT"; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      fail "port $port is already in use; inspect it with 'lsof -nP -iTCP:$port -sTCP:LISTEN', then stop its owner or override the port in this script and app config together"
    fi
  done

  mkdir -p "$LOG_DIR" "$RUNTIME_DIR/firebase-data"
  chmod -R go-rwx "$RUNTIME_DIR"
  cat >"$RUNTIME_DIR/OWNER.md" <<EOF
# DataTug local stack runtime

Owner: this local-stack.sh invocation (started by $(id -un)).
Started from: $ROOT
Stop: press Ctrl-C in its foreground terminal; if the terminal is gone, inspect the recorded PIDs in $RUNTIME_DIR/pids and stop only those processes.
Persistent emulator data: $RUNTIME_DIR/firebase-data
Logs: $LOG_DIR
EOF

  # Build a private emulator config that reuses Sneat's checked-in rules/indexes,
  # while changing only the Firestore port to avoid the DALgo emulator on 8080.
  node - "$FIREBASE_DIR/firebase.json" "$RUNTIME_DIR/firebase.json" "$FIRESTORE_PORT" "$EMULATOR_UI_PORT" <<'NODE'
const fs = require('node:fs');
const [source, target, firestorePort, uiPort] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(source, 'utf8'));
config.firestore.rules = `${source.slice(0, source.lastIndexOf('/'))}/${config.firestore.rules}`;
config.firestore.indexes = `${source.slice(0, source.lastIndexOf('/'))}/${config.firestore.indexes}`;
config.emulators = {
  auth: { host: '127.0.0.1', port: 9099 },
  firestore: { host: '127.0.0.1', port: Number(firestorePort) },
  ui: { enabled: true, host: '127.0.0.1', port: Number(uiPort) },
};
fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
NODE

  SERVED_PROJECT="$DEMO_PROJECT_DIR"
  if [ "${DATATUG_LOCAL_WRITES:-0}" = 1 ]; then
    # Never grant writes against the canonical demo checkout. Keep a local copy
    # under the explicitly owned runtime directory and preserve it across runs.
    SERVED_PROJECT="$RUNTIME_DIR/demo-project-1"
    if [ ! -d "$SERVED_PROJECT" ]; then
      mkdir -p "$SERVED_PROJECT"
      tar -C "$DEMO_PROJECT_DIR" --exclude=.git --exclude=.codegraph -cf - . | tar -C "$SERVED_PROJECT" -xf -
    fi
  fi
  SERVE_ARGS=(serve --host 127.0.0.1 --port "$AGENT_PORT" --project "$SERVED_PROJECT" --as local-dev --role admin)
  if [ "${DATATUG_LOCAL_WRITES:-0}" = 1 ]; then
    SERVE_ARGS+=(--allow-writes)
  fi

  pids=""
  EMULATOR_PID=""
  stop_tree() {
    local pid child
    pid="$1"
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do stop_tree "$child"; done
    kill -TERM "$pid" 2>/dev/null || true
  }
  shutdown() {
    local pid state attempt
    trap - EXIT INT TERM
    # Let Firebase handle SIGINT and finish its configured export before we
    # force-stop its process tree. The remaining services can stop immediately.
    if [ -n "$EMULATOR_PID" ]; then
      kill -INT "$EMULATOR_PID" 2>/dev/null || true
      for attempt in {1..20}; do
        state="$(ps -o stat= -p "$EMULATOR_PID" 2>/dev/null | tr -d ' ' || true)"
        case "$state" in ''|Z*) break ;; esac
        sleep 1
      done
    fi
    for pid in $pids; do
      [ "$pid" = "$EMULATOR_PID" ] || stop_tree "$pid"
    done
    if [ -n "$EMULATOR_PID" ]; then
      state="$(ps -o stat= -p "$EMULATOR_PID" 2>/dev/null | tr -d ' ' || true)"
      case "$state" in ''|Z*) ;; *) stop_tree "$EMULATOR_PID" ;; esac
    fi
    for pid in $pids; do wait "$pid" 2>/dev/null || true; done
    rm -f "$RUNTIME_DIR/pids"
  }
  on_signal() { shutdown; exit "$1"; }
  trap shutdown EXIT
  trap 'on_signal 130' INT
  trap 'on_signal 143' TERM

  start_service() {
    local name="$1"; shift
    (exec "$@") >"$LOG_DIR/$name.log" 2>&1 &
    SERVICE_PID="$!"
    pids="$pids $SERVICE_PID"
  }
  if [ -f "$RUNTIME_DIR/firebase-data/firebase-export-metadata.json" ]; then
    start_service emulators "$FIREBASE_BIN" emulators:start --only auth,firestore --project "$PROJECT_ID" --config "$RUNTIME_DIR/firebase.json" --import "$RUNTIME_DIR/firebase-data" --export-on-exit "$RUNTIME_DIR/firebase-data"
  else
    start_service emulators "$FIREBASE_BIN" emulators:start --only auth,firestore --project "$PROJECT_ID" --config "$RUNTIME_DIR/firebase.json" --export-on-exit "$RUNTIME_DIR/firebase-data"
  fi
  EMULATOR_PID="$SERVICE_PID"

  wait_for_port() {
    local port="$1" attempt pid state
    for attempt in {1..90}; do
      for pid in $pids; do
        state="$(ps -o stat= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
        case "$state" in
          ''|Z*)
            for log in "$LOG_DIR"/*.log; do [ ! -f "$log" ] || { echo "--- $log" >&2; tail -n 40 "$log" >&2; }; done
            fail "a local-stack service exited while waiting for port $port"
            ;;
        esac
      done
      nc -z 127.0.0.1 "$port" >/dev/null 2>&1 && return 0
      sleep 1
    done
    fail "timed out waiting for port $port; see $LOG_DIR/emulators.log"
  }
  wait_for_port "$AUTH_PORT"
  wait_for_port "$FIRESTORE_PORT"

  export SNEAT_GO_DIR
  start_service backend env GOOGLE_CLOUD_PROJECT="$PROJECT_ID" \
    FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:$AUTH_PORT" \
    FIRESTORE_EMULATOR_HOST="127.0.0.1:$FIRESTORE_PORT" \
    PORT="$API_PORT" \
    bash -c 'if [ -n "${SNEAT_GO_BIN:-}" ]; then exec "$SNEAT_GO_BIN"; else cd "$SNEAT_GO_DIR" && exec go run .; fi'
  wait_for_port "$API_PORT"
  start_service agent "$DATATUG_BIN" "${SERVE_ARGS[@]}"
  wait_for_port "$AGENT_PORT"
  start_service frontend bash -c 'cd "$DATATUG_APP_ROOT" && exec pnpm nx serve datatug-app --configuration=development --host=127.0.0.1 --port=4200' _
  wait_for_port "$WEB_PORT"
  printf '%s\n' $pids >"$RUNTIME_DIR/pids"
  echo "DataTug: http://127.0.0.1:$WEB_PORT"
  echo "Sneat API: http://127.0.0.1:$API_PORT/v0/"
  echo "DataTug agent: http://127.0.0.1:$AGENT_PORT"
  echo "Firebase UI: http://127.0.0.1:$EMULATOR_UI_PORT"
  echo "Logs: $LOG_DIR (Ctrl-C stops all services; runtime owner: $RUNTIME_DIR/OWNER.md)"

  while :; do
    local pid
    for pid in $pids; do
      state="$(ps -o stat= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
      case "$state" in
        ''|Z*)
        wait "$pid" || true
        echo "Service process $pid exited; stopping the local stack." >&2
        for log in "$LOG_DIR"/*.log; do echo "--- $log" >&2; tail -n 30 "$log" >&2; done
        return 1
        ;;
      esac
    done
    sleep 1
  done
}

export DATATUG_APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
main "$@"
