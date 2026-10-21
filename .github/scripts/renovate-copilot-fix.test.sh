#!/usr/bin/env bash
# Offline test of renovate-copilot-fix.sh: bash .github/scripts/renovate-copilot-fix.test.sh
#
# `gh` is a stub that serves JSON fixtures from $FIX and honours `--jq` (through
# the real jq), so the production filters run unchanged. Writes are appended to
# $FIX/posts as "<method> <token> <endpoint> <fields...>" instead of reaching GitHub.
#   pulls/<n>.json, comments_<n>.json, jobs_<run>.json, runs_<sha>.json,
#   open.json (every open pull request), head.json (pulls?head=...)
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
command -v jq >/dev/null || { echo "jq is required"; exit 2; }
mkdir "$tmp/bin"
cat >"$tmp/bin/gh" <<'STUB'
#!/usr/bin/env bash
[ "$1" = api ] || exit 1
shift
method=GET; jqf=.; endpoint=; fields=()
while [ $# -gt 0 ]; do
  case "$1" in
    --method) method="$2"; shift ;;
    --jq) jqf="$2"; shift ;;
    --paginate) ;;
    -f) fields+=("$2"); shift ;;
    *) endpoint="$1" ;;
  esac
  shift
done
if [ "$method" != GET ]; then
  body="${fields[*]}"
  printf '%s %s %s %s\n' "$method" "$GH_TOKEN" "$endpoint" "${body//$'\n'/\\n}" >>"$FIX/posts"
  exit 0
fi
emit() { jq -r "$jqf" <"$FIX/$1"; }
case "$endpoint" in
  */pulls\?state=open\&head=*) emit head.json ;;
  */pulls\?state=open*) emit open.json ;;
  */pulls/*) emit "pulls/${endpoint##*/}.json" ;;
  */issues/*/comments) n="${endpoint%/comments}"; emit "comments_${n##*/}.json" ;;
  */runs/*/jobs) r="${endpoint%/jobs}"; emit "jobs_${r##*/}.json" ;;
  */ci.yml/runs\?head_sha=*) s="${endpoint#*head_sha=}"; emit "runs_${s%%&*}.json" ;;
  *) echo "unexpected endpoint $endpoint" >&2; exit 1 ;;
esac
STUB
chmod +x "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH" REPO=o/r GH_TOKEN=read-token MAX_ATTEMPTS=2 GITHUB_STEP_SUMMARY=/dev/null

failures=0
fail() { echo "FAIL: $*"; failures=$((failures + 1)); }

# reset: fresh fixtures with one failing Renovate PR #7 at head aaa1.
reset() {
  export FIX="$tmp/fix"
  rm -rf "$FIX"; mkdir -p "$FIX/pulls"; : >"$FIX/posts"
  unset RUN_ID HEAD_BRANCH HEAD_SHA INPUT_PR
  export COPILOT_TRIGGER_TOKEN=trigger-token
  pr 7 'renovate[bot]' aaa1
  echo '[]' >"$FIX/comments_7.json"
  echo '[{"number":7}]' >"$FIX/head.json"
  echo '{"jobs":[{"name":"build","conclusion":"failure","html_url":"https://x/build"},{"name":"test","conclusion":"success","html_url":"https://x/test"}]}' >"$FIX/jobs_100.json"
}
TITLE='chore(deps): update dependency x to v2'
# pr N AUTHOR SHA [STATE] [TITLE]
pr() { jq -n --arg u "$2" --arg s "$3" --arg st "${4:-open}" --arg t "${5:-$TITLE}" '{state:$st,title:$t,user:{login:$u},head:{sha:$s,repo:{full_name:"o/r"}}}' >"$FIX/pulls/$1.json"; }
ver() { printf '%s' "${1:-$TITLE}" | git hash-object --stdin | cut -c1-12; }
# markers N SHA[@TITLE]... -> earlier requests on #N (TITLE defaults to the current one),
# plus one ordinary comment and one with a null body, which must be ignored.
markers() {
  local n="$1" m; shift
  for m in "$@"; do
    case "$m" in *@*) printf '%s %s\n' "$(ver "${m#*@}")" "${m%%@*}" ;; *) printf '%s %s\n' "$(ver)" "$m" ;; esac
  done | jq -R -s 'split("\n") | map(select(length>0) | split(" ") | {body: ("asked\n<!-- renovate-copilot-fix ver:" + .[0] + " sha:" + .[1] + " -->")})
    + [{body: "LGTM"}, {body: null}]' >"$FIX/comments_$n.json"
}
failed_run() { export RUN_ID=100 HEAD_BRANCH=renovate/x HEAD_SHA="${1:-aaa1}"; }
run() { bash "$here/renovate-copilot-fix.sh" >/dev/null 2>"$FIX/err" || fail "$1: exited non-zero: $(cat "$FIX/err")"; }
posts() { grep -c '/comments body=' "$FIX/posts"; }

reset; failed_run; run "first failure"
[ "$(posts)" = 1 ] || fail "first failure: expected 1 post, got $(posts)"
grep -q '^POST trigger-token repos/o/r/issues/7/comments body=@copilot' "$FIX/posts" || fail "first failure: comment not posted with the trigger token"
grep -q "ver:$(ver) sha:aaa1 -->" "$FIX/posts" || fail "first failure: marker missing"
grep -q 'https://x/build' "$FIX/posts" || fail "first failure: failing job link missing"
grep -q 'https://x/test' "$FIX/posts" && fail "first failure: passing job listed"
grep -q 'Attempt 1 of 2' "$FIX/posts" || fail "first failure: attempt count missing"

reset; markers 7 aaa1; failed_run; run "same commit"
[ "$(posts)" = 0 ] || fail "same commit: asked twice"

reset; markers 7 bbb2; failed_run; run "second commit"
grep -q 'Attempt 2 of 2' "$FIX/posts" || fail "second commit: expected attempt 2"

reset; markers 7 bbb2 ccc3; failed_run; run "limit"
[ "$(posts)" = 0 ] || fail "limit: commented past the limit"
grep -q '^POST read-token repos/o/r/issues/7/labels labels\[\]=renovate-needs-human' "$FIX/posts" || fail "limit: not labelled"

reset; markers 7 bbb2@old-title ccc3@old-title; failed_run; run "new version"
grep -q 'Attempt 1 of 2' "$FIX/posts" || fail "new version: attempts were not reset"
grep -q '^DELETE read-token repos/o/r/issues/7/labels/renovate-needs-human' "$FIX/posts" || fail "new version: limit label not removed"

reset; pr 7 'renovate[bot]' aaa1 closed; failed_run; run "closed pull request"
[ "$(posts)" = 0 ] || fail "closed pull request: commented"

reset; failed_run old0; run "stale run"
[ "$(posts)" = 0 ] || fail "stale run: acted on an old commit"

reset; pr 7 someone aaa1; failed_run; run "human pull request"
[ "$(posts)" = 0 ] || fail "human pull request: acted on a non-Renovate pull request"

reset; COPILOT_TRIGGER_TOKEN=; failed_run; run "no secret"
[ "$(posts)" = 0 ] || fail "no secret: posted without the trigger token"

reset; pr 8 'renovate[bot]' ddd4; pr 9 someone eee5
echo '[{"number":7,"user":{"login":"renovate[bot]"}},{"number":8,"user":{"login":"renovate[bot]"}},{"number":9,"user":{"login":"someone"}}]' >"$FIX/open.json"
echo '{"workflow_runs":[{"id":100,"conclusion":"failure"}]}' >"$FIX/runs_aaa1.json"
echo '{"workflow_runs":[{"id":101,"conclusion":"success"}]}' >"$FIX/runs_ddd4.json"
run "sweep"
if [ "$(posts)" != 1 ] || ! grep -q 'issues/7/comments' "$FIX/posts"; then fail "sweep: expected exactly one request, for #7"; fi

# #6 cannot be read: the sweep reports it, still serves #7, and exits non-zero.
reset; echo '[{"number":6,"user":{"login":"renovate[bot]"}},{"number":7,"user":{"login":"renovate[bot]"}}]' >"$FIX/open.json"
echo '{"workflow_runs":[{"id":100,"conclusion":"failure"}]}' >"$FIX/runs_aaa1.json"
bash "$here/renovate-copilot-fix.sh" >/dev/null 2>&1 && fail "broken sweep: exited zero"
[ "$(posts)" = 1 ] || fail "broken sweep: one failing pull request stopped the rest"

reset; export INPUT_PR='7;x'
bash "$here/renovate-copilot-fix.sh" >/dev/null 2>"$FIX/err" && fail "bad input: accepted a non-numeric pull request"
grep -q 'must be a number' "$FIX/err" || fail "bad input: not refused as a non-numeric pull request"
[ "$(posts)" = 0 ] || fail "bad input: posted"

reset; echo '{"workflow_runs":[{"id":100,"conclusion":"failure"}]}' >"$FIX/runs_aaa1.json"; export INPUT_PR=7; run "one pull request"
[ "$(posts)" = 1 ] || fail "one pull request: expected 1 post, got $(posts)"

reset; echo '{"workflow_runs":[]}' >"$FIX/runs_aaa1.json"; export INPUT_PR=7; run "no CI run"
[ "$(posts)" = 0 ] || fail "no CI run: acted without a failed run"

if [ "$failures" = 0 ]; then echo "renovate-copilot-fix: all tests passed"; else echo "renovate-copilot-fix: $failures failure(s)"; exit 1; fi
