#!/usr/bin/env bash
# Offline test of deploy-gate.sh: bash .github/scripts/deploy-gate.test.sh
#
# `gh` is a stub that serves recorded-style JSON fixtures and honours `--jq`
# (through the real jq) and `--paginate` (the --jq filter runs once per page and
# the outputs are concatenated, exactly like gh), so the production filter and
# the pagination handling are exercised, not bypassed.
#   jobs:   $FIX/jobs_<runid>_<page>.json   (page 1 only without --paginate)
#   runs:   $FIX/runs.json                  (workflow_runs for ci.yml)
#   tip:    $TIP                            (main's current tip; TIP_FAIL=1 = API error)
# shellcheck disable=SC2086  # the $wr/$dp env lists are meant to word-split
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
command -v jq >/dev/null || { echo "jq is required"; exit 2; }
mkdir "$tmp/bin" "$tmp/fix"
cat >"$tmp/bin/gh" <<'STUB'
#!/usr/bin/env bash
[ "$1" = api ] || exit 1
endpoint="$2"; shift 2
paginate=0; jqf=.
while [ $# -gt 0 ]; do
  case "$1" in --paginate) paginate=1 ;; --jq) jqf="$2"; shift ;; esac
  shift
done
emit() { jq -r "$jqf"; }
case "$endpoint" in
*/commits/main)
  [ -z "${TIP_FAIL:-}" ] || exit 1
  printf '{"sha":"%s"}' "${TIP:-aaa}" | emit ;;
*/runs/*/jobs*)
  id="${endpoint#*/runs/}"; id="${id%%/*}"
  if [ "$paginate" = 1 ]; then
    for f in "$FIX/jobs_${id}"_*.json; do [ -f "$f" ] && emit <"$f"; done
  elif [ -f "$FIX/jobs_${id}_1.json" ]; then emit <"$FIX/jobs_${id}_1.json"; fi ;;
*/ci.yml/runs*) emit <"$FIX/runs.json" ;;
*) exit 1 ;;
esac
STUB
chmod +x "$tmp/bin/gh"
REAL_PYTHON="$(command -v python3)"
export REAL_PYTHON
cat >"$tmp/bin/python3" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  */workflow-baseline.py) printf '%s\n' "${DEPLOY_BASE:-}" ;;
  */classify-metadata-change.py) printf '%s\n' "${CLASSIFICATION:-full: application code changed}" ;;
  *) exec "$REAL_PYTHON" "$@" ;;
esac
STUB
chmod +x "$tmp/bin/python3"
export PATH="$tmp/bin:$PATH" REPO=o/r SHA=aaa TIP=aaa REF=refs/heads/main GH_TOKEN=x FIX="$tmp/fix"

# page RUN PAGE name:conclusion... -> one jobs page fixture (conclusion "null" = in progress).
page() {
  local run="$1" n="$2"; shift 2
  printf '%s\n' "$@" | jq -R -s '{total_count: 0, jobs: (split("\n") | map(select(length>0)
    | split(":") | {name: .[0], conclusion: (if .[1]=="null" then null else .[1] end)}))}' >"$FIX/jobs_${run}_${n}.json"
}
filler() { # RUN PAGE COUNT -> COUNT unrelated successful jobs
  local run="$1" n="$2" c="$3" i; local -a l=()
  for ((i = 0; i < c; i++)); do l+=("lane-$n-$i:success"); done
  page "$run" "$n" "${l[@]}"
}
reset() { rm -f "$FIX"/*.json; echo '{"workflow_runs":[]}' >"$FIX/runs.json"; }
runs() { printf '%s\n' "$@" | jq -R -s '{workflow_runs: (split("\n") | map(select(length>0) | {id: tonumber}))}' >"$FIX/runs.json"; }

fails=0
check() { # name expected-deploy expected-exit -- env...
  local name="$1" want="$2" wantrc="$3"; shift 4
  : >"$tmp/out"; : >"$tmp/sum"
  env "$@" GITHUB_OUTPUT="$tmp/out" GITHUB_STEP_SUMMARY="$tmp/sum" bash "$here/deploy-gate.sh" >"$tmp/stdout" 2>&1
  local rc=$? got; got="$(grep -o 'deploy=.*' "$tmp/out" | tail -1)"
  if [ "$got" = "deploy=$want" ] && [ "$rc" = "$wantrc" ]; then echo "PASS $name"; else echo "FAIL $name: got '${got:-<unset>}' rc=$rc, want deploy=$want rc=$wantrc"; fails=1; fi
}
# injection check: after a run, stdout may hold only our own ::notice/::error
# commands, the summary only our own lines, the output file only deploy=... lines.
assert_clean() { # name injected-marker
  local name="$1" marker="$2" bad=0
  grep '^::' "$tmp/stdout" | grep -qvE '^::(notice|error) title=Deploy [a-z -]+::' && bad=1
  grep -q "^$marker" "$tmp/stdout" && bad=1
  grep -q "^$marker" "$tmp/sum" && bad=1
  grep -qvE '^deploy=(true|false)$' "$tmp/out" && bad=1
  [ "$(wc -l <"$tmp/sum")" -le 2 ] || bad=1
  if [ $bad = 0 ]; then echo "PASS $name (no injection)"; else echo "FAIL $name: injected content reached output"; fails=1; fi
}

wr="EVENT_NAME=workflow_run WR_ID=7 WR_SHA=aaa WR_EVENT=push WR_BRANCH=main WR_HEAD_REPO=o/r"
g() { reset; page 7 1 "$@"; }

g "deploy-gate:success"; check "ci success"             true  0 -- $wr
g "deploy-gate:success"; check "metadata after actual deploy" false 0 -- $wr DEPLOY_BASE=bbb CLASSIFICATION=metadata-only
g "deploy-gate:success"; check "green code CI but code not deployed" true 0 -- $wr DEPLOY_BASE=bbb "CLASSIFICATION=full: application code changed"
g "deploy-gate:success"; check "missing actual deploy receipt" true 0 -- $wr DEPLOY_BASE= CLASSIFICATION=metadata-only
g "deploy-gate:failure";  check "ci failure"            false 0 -- $wr
g "deploy-gate:cancelled"; check "ci cancelled"         false 0 -- $wr
g "deploy-gate:skipped";  check "deploy-gate skipped"   false 0 -- $wr
g "deploy-gate:null";     check "deploy-gate in progress" false 0 -- $wr
g "other:success";        check "deploy-gate job missing" false 0 -- $wr
reset; check "run has no jobs fixture" false 0 -- $wr
g "deploy-gate:success" "deploy-gate:failure"
check "gate success + a failure"   false 0 -- $wr
g "deploy-gate:success" "deploy-gate:skipped"
check "gate success + a skipped duplicate" false 0 -- $wr
g "deploy-gate-extra:success" "x / deploy-gate:success" "Deploy-Gate:success" "deploy-gate :success"
check "name collisions are not the gate" false 0 -- $wr
g "deploy-gate:success" "x / deploy-gate:failure" "deploy-gate-extra:success"
check "collisions do not affect a real green gate" true 0 -- $wr

# pagination: >100 jobs, the gate job on page 2 / 3, and a failing duplicate on a later page
reset; filler 7 1 100; page 7 2 "deploy-gate:success"
check "gate on page 2 (needs --paginate)" true 0 -- $wr
reset; filler 7 1 100; filler 7 2 100; page 7 3 "deploy-gate:success"
check "gate on page 3"             true 0 -- $wr
reset; page 7 1 "deploy-gate:success"; filler 7 2 100; page 7 3 "deploy-gate:failure"
check "failure on a later page blocks" false 0 -- $wr
reset; filler 7 1 100; page 7 2 "deploy-gate:skipped"
check "skipped gate on page 2"     false 0 -- $wr
reset; filler 7 1 100; filler 7 2 5
check "gate missing across pages"  false 0 -- $wr

g "deploy-gate:success"
check "superseded (WR_SHA != SHA)" false 0 -- $wr SHA=bbb TIP=bbb
check "main moved: SHA no longer tip" false 0 -- $wr TIP=ccc
check "re-run of old run (attempt 2), tip moved" false 0 -- $wr TIP=ccc RUN_ATTEMPT=2
check "re-run (attempt 2), still tip" true 0 -- $wr RUN_ATTEMPT=2
if grep -q 'run_attempt=2' "$tmp/stdout"; then echo "PASS re-run is logged"; else echo "FAIL re-run is not logged"; fails=1; fi
check "tip lookup fails -> fail closed" false 1 -- $wr TIP_FAIL=1
check "tip lookup garbage -> fail closed" false 1 -- $wr "TIP=not a sha"
check "not a push"                 false 0 -- $wr WR_EVENT=pull_request
check "scheduled CI cannot deploy" false 0 -- $wr WR_EVENT=schedule
check "other branch"               false 0 -- $wr WR_BRANCH=feature
check "fork head repo"             false 0 -- $wr WR_HEAD_REPO=evil/r
check "gh unavailable is fail-closed" false 1 -- $wr PATH=/usr/bin:/bin

dp="EVENT_NAME=workflow_dispatch OVERRIDE=false REASON= ACTOR=alex"
reset; runs 9 8; page 9 1 "deploy-gate:failure"; page 8 1 "deploy-gate:success"
check "dispatch, green CI"         true  0 -- $dp
check "dispatch, tip moved (re-run of old dispatch)" false 1 -- $dp TIP=ccc RUN_ATTEMPT=2
reset; runs 9; page 9 1 "deploy-gate:failure"
check "dispatch, red CI"           false 1 -- $dp
reset; check "dispatch, no CI run" false 1 -- $dp
reset; runs 9; page 9 1 "deploy-gate:success"
check "dispatch from branch"       false 1 -- $dp REF=refs/heads/x
check "override with reason"       true  0 -- EVENT_NAME=workflow_dispatch OVERRIDE=true ACTOR=alex "REASON=hotfix prod down"
check "override, tip moved"        false 1 -- EVENT_NAME=workflow_dispatch OVERRIDE=true ACTOR=alex "REASON=hotfix" TIP=ccc
check "override, tip lookup fails" false 1 -- EVENT_NAME=workflow_dispatch OVERRIDE=true ACTOR=alex "REASON=hotfix" TIP_FAIL=1
check "override without reason"    false 1 -- EVENT_NAME=workflow_dispatch OVERRIDE=true "REASON=  "
check "override from branch"       false 1 -- EVENT_NAME=workflow_dispatch OVERRIDE=true REASON=r REF=refs/heads/x
check "unknown event"              false 1 -- EVENT_NAME=push

# Injection through the dispatch inputs (reason/actor) and CI-controlled fields.
od="EVENT_NAME=workflow_dispatch OVERRIDE=true"
nl=$'\n'; cr=$'\r'
check "reason with LF + ::set-output"  true 0 -- $od ACTOR=alex "REASON=ok${nl}::set-output name=deploy::false"
assert_clean "reason LF ::set-output" '::set-output'
check "reason with LF + ::error::"     true 0 -- $od ACTOR=alex "REASON=ok${nl}::error::pwned"
assert_clean "reason LF ::error::" '::error::pwned'
check "reason with CRLF"               true 0 -- $od ACTOR=alex "REASON=ok${cr}${nl}::warning::x"
assert_clean "reason CRLF" '::warning'
check "reason starts with ::"          true 0 -- $od ACTOR=alex "REASON=::add-mask::abc"
assert_clean "reason starting ::" '::add-mask'
check "reason with %0A and %0D"        true 0 -- $od ACTOR=alex "REASON=a%0A::error::b%0D"
assert_clean "reason %0A" '::error::b'
check "reason markdown injection"      true 0 -- $od ACTOR=alex 'REASON=`# [click](http://evil) <img src=x onerror=1> | a |'
if grep -qE '\[click\]|<img|\| a \||`#' "$tmp/sum"; then echo "FAIL markdown metacharacters survived"; fails=1; else echo "PASS markdown metacharacters neutralised"; fi
check "reason with ESC/BEL controls"   true 0 -- $od ACTOR=alex $'REASON=a\x1b[31mred\x07bell'
if LC_ALL=C grep -q $'\x1b' "$tmp/sum" "$tmp/stdout"; then echo "FAIL control chars survived"; fails=1; else echo "PASS control chars stripped"; fi
check "actor with LF + command"        true 0 -- $od REASON=r "ACTOR=bob${nl}::set-output name=x::y"
assert_clean "actor LF command" '::set-output'
long="$(printf 'x%.0s' $(seq 1 5000))"
check "very long reason is capped"     true 0 -- $od ACTOR=alex "REASON=$long"
if [ "$(wc -c <"$tmp/sum")" -lt 600 ]; then echo "PASS long reason capped"; else echo "FAIL long reason not capped"; fails=1; fi
check "newline-only reason is empty"   false 1 -- $od ACTOR=alex "REASON=${nl}${nl}"
g "deploy-gate:failure"
check "branch name injection"          false 0 -- $wr "WR_BRANCH=x${nl}::set-output name=deploy::true"
assert_clean "WR_BRANCH injection" '::set-output'
exit $fails
