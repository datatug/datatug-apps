#!/usr/bin/env bash
# Offline test of deploy-gate.sh with a stubbed `gh`: bash .github/scripts/deploy-gate.test.sh
# shellcheck disable=SC2086  # the $wr/$dp env lists are meant to word-split
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# Stub: `gh api .../runs/<id>/jobs` prints $GATE_<id> (the deploy-gate conclusions);
# `gh api .../workflows/ci.yml/runs?...` prints $CI_RUN_IDS.
mkdir "$tmp/bin"
cat >"$tmp/bin/gh" <<'STUB'
#!/usr/bin/env bash
case "$2" in
*/jobs*) id="${2#*/runs/}"; id="${id%%/*}"; var="GATE_$id"; printf '%s' "${!var:-}" ;;
*/ci.yml/runs*) printf '%s' "${CI_RUN_IDS:-}" ;;
*) exit 1 ;;
esac
STUB
chmod +x "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH" REPO=o/r SHA=aaa REF=refs/heads/main GH_TOKEN=x

fails=0
check() { # name expected-deploy expected-exit -- env...
  local name="$1" want="$2" wantrc="$3"; shift 4
  : >"$tmp/out"
  env "$@" GITHUB_OUTPUT="$tmp/out" bash "$here/deploy-gate.sh" >/dev/null 2>&1
  local rc=$? got; got="$(grep -o 'deploy=.*' "$tmp/out" | tail -1)"
  if [ "$got" = "deploy=$want" ] && [ "$rc" = "$wantrc" ]; then echo "PASS $name"; else echo "FAIL $name: got '${got:-<unset>}' rc=$rc, want deploy=$want rc=$wantrc"; fails=1; fi
}
wr="EVENT_NAME=workflow_run WR_ID=7 WR_SHA=aaa WR_EVENT=push WR_BRANCH=main WR_HEAD_REPO=o/r"
check "ci success"                 true  0 -- $wr GATE_7=success
check "ci failure"                 false 0 -- $wr GATE_7=failure
check "ci cancelled"               false 0 -- $wr GATE_7=cancelled
check "deploy-gate skipped"        false 0 -- $wr GATE_7=skipped
check "deploy-gate job missing"    false 0 -- $wr GATE_7=
check "gate success + a failure"   false 0 -- $wr "GATE_7=success
failure"
check "superseded (main moved)"    false 0 -- $wr GATE_7=success SHA=bbb
check "not a push"                 false 0 -- $wr GATE_7=success WR_EVENT=pull_request
check "other branch"               false 0 -- $wr GATE_7=success WR_BRANCH=feature
check "fork head repo"             false 0 -- $wr GATE_7=success WR_HEAD_REPO=evil/r
check "gh unavailable is fail-closed" false 0 -- $wr GATE_7=success PATH=/usr/bin:/bin
dp="EVENT_NAME=workflow_dispatch OVERRIDE=false REASON="
check "dispatch, green CI"         true  0 -- $dp CI_RUN_IDS="9 8" GATE_9=failure GATE_8=success
check "dispatch, red CI"           false 1 -- $dp CI_RUN_IDS="9" GATE_9=failure
check "dispatch, no CI run"        false 1 -- $dp CI_RUN_IDS=
check "dispatch from branch"       false 1 -- $dp REF=refs/heads/x CI_RUN_IDS=9 GATE_9=success
check "override with reason"       true  0 -- EVENT_NAME=workflow_dispatch OVERRIDE=true "REASON=hotfix prod down"
check "override without reason"    false 1 -- EVENT_NAME=workflow_dispatch OVERRIDE=true "REASON=  "
check "override from branch"       false 1 -- EVENT_NAME=workflow_dispatch OVERRIDE=true REASON=r REF=refs/heads/x
check "unknown event"              false 1 -- EVENT_NAME=push
exit $fails
