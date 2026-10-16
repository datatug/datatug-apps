#!/usr/bin/env bash
# Decide whether a Deploy (Cloudflare) run may publish. Fail-closed: the only
# way to get `deploy=true` is to reach the final `allow` call; every other
# path (including a crash, because of `set -e`) leaves the output unset, and
# deploy.yml's deploy job requires the literal string "true".
#
# What is guaranteed (and what is not):
#  - A deploy is allowed only when the commit being deployed (SHA, which the
#    reusable cf-deploy workflow checks out) is, AT THE TIME THIS SCRIPT RUNS,
#    the current tip of main (read live from the GitHub API), and CI for that
#    same commit has a green `deploy-gate` job (defined in ci.yml).
#  - So "Re-run jobs" on an old deploy run (which keeps its old SHA, with
#    run_attempt > 1) is refused once main has moved on: an older commit can
#    not overwrite a newer one through this gate. A re-run while the commit is
#    still main's tip is a legitimate redeploy and is allowed (and logged).
#  - NOT guaranteed: a race inside the window between this check and the
#    publish step (a push landing in those minutes). The newer commit's own CI
#    then triggers its own deploy, serialised after this one by the workflow's
#    concurrency group, so the newer commit still wins; the tip is not
#    re-checked immediately before publish.
#  - The emergency override (workflow_dispatch) skips only the CI check, never
#    the main-tip check.
#
# Inputs (env): EVENT_NAME REPO REF SHA GH_TOKEN, optional RUN_ATTEMPT; for
# workflow_run: WR_ID WR_SHA WR_EVENT WR_BRANCH WR_HEAD_REPO; for
# workflow_dispatch: OVERRIDE (true|false) REASON ACTOR.
# Output: `deploy=true|false` to $GITHUB_OUTPUT.
set -euo pipefail

OUT="${GITHUB_OUTPUT:-/dev/stdout}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

# clean VALUE: make an untrusted value safe to echo into a workflow command or
# the markdown step summary: one line, allowlisted characters only (anything
# else, including control chars, CR/LF, `::`-forming colons, %, backticks and
# markdown/HTML metacharacters, becomes '?'), capped at 200 characters.
clean() {
  printf '%s' "${1-}" | LC_ALL=C tr '\r\n\t' '   ' | LC_ALL=C tr -c 'A-Za-z0-9 ._/@#+=,()-' '?' | LC_ALL=C cut -c1-200 | head -n1
}
# Untrusted values, sanitised once and only the sanitised copies are echoed.
C_ACTOR="$(clean "${ACTOR:-unknown}")"
C_REASON="$(clean "${REASON-}")"

# say KIND TITLE MSG: one workflow command + one summary line. MSG is forced to
# a single line (defence in depth; untrusted parts are already clean()ed).
say() {
  local msg; msg="$(printf '%s' "$3" | LC_ALL=C tr '\r\n' '  ')"
  echo "::$1 title=$2::$msg"
  printf '%s\n' "$2: $msg" >>"$SUMMARY"
}
# skip: a benign non-deploy (CI red, superseded, not main). Green job, no deploy.
skip() { echo "deploy=false" >>"$OUT"; say notice "Deploy skipped" "$1"; exit 0; }
# refuse: an explicit manual request that cannot be honoured. Red job, no deploy.
refuse() { echo "deploy=false" >>"$OUT"; say error "Deploy refused" "$1"; exit 1; }
allow() { say notice "Deploy allowed" "$1"; echo "deploy=true" >>"$OUT"; exit 0; }

# gate_green RUN_ID: true only when that run's latest attempt has a
# `deploy-gate` job whose conclusion is exactly `success` (all pages).
gate_green() {
  local conclusions
  conclusions="$(gh api "repos/$REPO/actions/runs/$1/jobs?per_page=100" --paginate \
    --jq '.jobs[] | select(.name == "deploy-gate") | .conclusion')"
  [ -n "$conclusions" ] && [ "$(printf '%s\n' "$conclusions" | sort -u)" = "success" ]
}

# A green metadata CI run does not prove that earlier application code reached
# production. Only a receipt uploaded after a successful deploy can anchor a
# metadata-only gap. An unknown receipt or classifier error takes the normal
# deployment path.
skip_if_already_deployed() {
  local deployed result
  deployed="$(python3 .github/scripts/workflow-baseline.py deploy)" || return 0
  [ -n "$deployed" ] || return 0
  result="$(python3 .github/scripts/classify-metadata-change.py "$deployed" "$SHA")" || return 0
  if [ "$result" = metadata-only ]; then
    skip "Only verified SpecScore status metadata changed since successful application deploy $(clean "$deployed"); application deployment not applicable."
  fi
}

# fetch_tip: SHA (what would be built and published) must be main's
# current tip. Fails closed (refuse) when the tip cannot be determined.
# Prints nothing on success. Sets TIP.
fetch_tip() {
  TIP="$(gh api "repos/$REPO/commits/main" --jq .sha)" || refuse "Could not read main's current tip; refusing to deploy."
  [[ "$TIP" =~ ^[0-9a-f]{3,64}$ ]] || refuse "Could not read main's current tip (unexpected API answer); refusing to deploy."
}

ATTEMPT="${RUN_ATTEMPT:-1}"
if [[ "$ATTEMPT" =~ ^[0-9]+$ ]] && [ "$ATTEMPT" -gt 1 ]; then
  echo "::notice title=Deploy re-run::run_attempt=$ATTEMPT (a re-run keeps its original commit $(clean "$SHA"); it is only allowed while that commit is still main's tip)"
fi

case "$EVENT_NAME" in
workflow_run)
  [ "$WR_EVENT" = push ] || skip "CI run was a '$(clean "$WR_EVENT")' event, not a push to main."
  [ "$WR_BRANCH" = main ] || skip "CI run was for branch '$(clean "$WR_BRANCH")', not main."
  [ "$WR_HEAD_REPO" = "$REPO" ] || skip "CI run came from '$(clean "$WR_HEAD_REPO")', not this repository."
  # cf-deploy checks out SHA. It must be the commit CI validated...
  [ "$SHA" = "$WR_SHA" ] || skip "CI validated $(clean "$WR_SHA") but this run would build $(clean "$SHA"). The newer commit deploys after its own CI."
  # ...and main's CURRENT tip, so a late run or a 'Re-run jobs' of an old
  # deploy run can never overwrite a newer deploy with an older commit.
  fetch_tip
  [ "$SHA" = "$TIP" ] || skip "$(clean "$SHA") is no longer main's tip ($(clean "$TIP")); not deploying an older commit (run_attempt=$ATTEMPT). The tip deploys after its own CI."
  gate_green "$WR_ID" || skip "CI run $(clean "$WR_ID") has no green deploy-gate job for $(clean "$WR_SHA") (failed, cancelled, skipped or still missing)."
  skip_if_already_deployed
  allow "Deploying $(clean "$SHA") (main's tip): CI run $(clean "$WR_ID") deploy-gate passed."
  ;;
workflow_dispatch)
  [ "$REF" = refs/heads/main ] || refuse "Manual deploys run only from main (got $(clean "$REF"))."
  fetch_tip
  [ "$SHA" = "$TIP" ] || refuse "Manual deploys are limited to main's tip: $(clean "$SHA") is not it ($(clean "$TIP")). Start a new run from main."
  if [ "${OVERRIDE:-false}" = true ]; then
    [ -n "${C_REASON// /}" ] || refuse "override_ci_gate requires override_reason."
    allow "CI GATE OVERRIDDEN by \`$C_ACTOR\` for $(clean "$SHA") (run_attempt=$ATTEMPT). Reason: \`$C_REASON\`"
  fi
  ids="$(gh api "repos/$REPO/actions/workflows/ci.yml/runs?head_sha=$SHA&event=push&status=completed&per_page=20" \
    --jq '.workflow_runs[].id')"
  for id in $ids; do
    if gate_green "$id"; then allow "Deploying $(clean "$SHA") (main's tip): CI run $(clean "$id") deploy-gate passed."; fi
  done
  refuse "No completed CI push run for $(clean "$SHA") has a green deploy-gate. Wait for CI, re-run it, or use override_ci_gate with a reason."
  ;;
*)
  refuse "Unsupported event '$(clean "$EVENT_NAME")'."
  ;;
esac
