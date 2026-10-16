#!/usr/bin/env bash
# Decide whether a Deploy (Cloudflare) run may publish. Fail-closed: the only
# way to get `deploy=true` is to reach the final `allow` call; every other
# path (including a crash, because of `set -e`) leaves the output unset, and
# deploy.yml's deploy job requires the literal string "true".
#
# A deploy is allowed only when the CI run for the SAME commit has a green
# `deploy-gate` job (defined in ci.yml). The reusable cf-deploy workflow checks
# out GITHUB_SHA, so that is the commit that gets built and published; this
# script proves it is the commit CI validated.
#
# Inputs (env): EVENT_NAME REPO REF SHA GH_TOKEN, and for workflow_run:
# WR_ID WR_SHA WR_EVENT WR_BRANCH WR_HEAD_REPO; for workflow_dispatch:
# OVERRIDE (true|false) REASON. Output: `deploy=true|false` to $GITHUB_OUTPUT.
set -euo pipefail

OUT="${GITHUB_OUTPUT:-/dev/stdout}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

# skip: a benign non-deploy (CI red, superseded, not main). Green job, no deploy.
skip() { echo "deploy=false" >>"$OUT"; echo "::notice title=Deploy skipped::$1"; echo "Deploy skipped: $1" >>"$SUMMARY"; exit 0; }
# refuse: an explicit manual request that cannot be honoured. Red job, no deploy.
refuse() { echo "deploy=false" >>"$OUT"; echo "::error title=Deploy refused::$1"; echo "Deploy refused: $1" >>"$SUMMARY"; exit 1; }
allow() { echo "$1" >>"$SUMMARY"; echo "::notice title=Deploy allowed::$1"; echo "deploy=true" >>"$OUT"; exit 0; }

# gate_green RUN_ID: true only when that run's latest attempt has a
# `deploy-gate` job whose conclusion is exactly `success`.
gate_green() {
  local conclusions
  conclusions="$(gh api "repos/$REPO/actions/runs/$1/jobs?per_page=100" --paginate \
    --jq '.jobs[] | select(.name == "deploy-gate") | .conclusion')"
  [ -n "$conclusions" ] && [ "$(printf '%s\n' "$conclusions" | sort -u)" = "success" ]
}

case "$EVENT_NAME" in
workflow_run)
  [ "$WR_EVENT" = push ] || skip "CI run was a '$WR_EVENT' event, not a push to main."
  [ "$WR_BRANCH" = main ] || skip "CI run was for branch '$WR_BRANCH', not main."
  [ "$WR_HEAD_REPO" = "$REPO" ] || skip "CI run came from '$WR_HEAD_REPO', not this repository."
  # cf-deploy checks out GITHUB_SHA (main's tip when this run was triggered).
  # If main moved past the validated commit, publishing would ship code CI
  # never saw (and an older commit finishing late would overwrite a newer
  # deploy): skip, the newer commit's own CI run deploys it.
  [ "$SHA" = "$WR_SHA" ] || skip "main moved on: CI validated $WR_SHA but this run would build $SHA. The newer commit deploys after its own CI."
  gate_green "$WR_ID" || skip "CI run $WR_ID has no green deploy-gate job for $WR_SHA (failed, cancelled, skipped or still missing)."
  allow "Deploying $SHA: CI run $WR_ID deploy-gate passed."
  ;;
workflow_dispatch)
  [ "$REF" = refs/heads/main ] || refuse "Manual deploys run only from main (got $REF)."
  if [ "${OVERRIDE:-false}" = true ]; then
    [ -n "${REASON// /}" ] || refuse "override_ci_gate requires override_reason."
    allow "CI GATE OVERRIDDEN by ${ACTOR:-unknown} for $SHA. Reason: $REASON"
  fi
  ids="$(gh api "repos/$REPO/actions/workflows/ci.yml/runs?head_sha=$SHA&event=push&status=completed&per_page=20" \
    --jq '.workflow_runs[].id')"
  for id in $ids; do
    if gate_green "$id"; then allow "Deploying $SHA: CI run $id deploy-gate passed."; fi
  done
  refuse "No completed CI push run for $SHA has a green deploy-gate. Wait for CI, re-run it, or use override_ci_gate with a reason."
  ;;
*)
  refuse "Unsupported event '$EVENT_NAME'."
  ;;
esac
