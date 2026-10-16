#!/usr/bin/env python3
"""Find the latest verified successful CI or actual deploy SHA, or return none."""

import io
from datetime import datetime
import json
import os
import re
import sys
import urllib.request
from urllib.parse import urlsplit
import zipfile


def https_origin(url):
    parts = urlsplit(url)
    if parts.scheme.lower() != "https" or not parts.hostname or parts.username or parts.password:
        raise ValueError("artifact redirect must use HTTPS without URL credentials")
    return parts.hostname.lower(), parts.port or 443


class ScopedAuthorizationRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        redirected = super().redirect_request(request, response, code, message, headers, newurl)
        if redirected is None:
            return None
        source_origin = https_origin(request.full_url)
        target_origin = https_origin(redirected.full_url)
        if source_origin != target_origin:
            redirected.remove_header("Authorization")
        return redirected


def api(path, accept="application/vnd.github+json"):
    request = urllib.request.Request(
        "https://api.github.com/repos/" + os.environ["GITHUB_REPOSITORY"] + path,
        headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"], "Accept": accept},
    )
    with urllib.request.build_opener(ScopedAuthorizationRedirectHandler()).open(request, timeout=15) as response:
        return response.read()


def pages(path, key):
    items = []
    joiner = "&" if "?" in path else "?"
    for page in range(1, 6):
        batch = json.loads(api(f"{path}{joiner}per_page=100&page={page}")).get(key, [])
        if not isinstance(batch, list):
            raise ValueError("malformed GitHub page")
        items.extend(batch)
        if len(batch) < 100:
            return items
    raise ValueError("GitHub pagination limit reached")


def timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value):
        raise ValueError("missing or malformed completion time")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def latest(mode):
    current = int(os.environ["GITHUB_RUN_ID"])
    if mode == "ci":
        # One successful-run page is enough to find a recent verified base.
        # Missing it only widens the classifier range to the full CI path.
        runs = json.loads(api("/actions/workflows/ci.yml/runs?branch=main&status=success&per_page=100&page=1")).get("workflow_runs", [])
        candidates = [run for run in runs if run.get("id") != current and run.get("conclusion") == "success" and run.get("event") == "push"]
        required = {"build", "test", "e2e", "journey e2e (real datatug-cli agent)", "deploy-gate"}
        for run in sorted(candidates, key=lambda item: timestamp(item.get("updated_at")), reverse=True):
            jobs = pages(f"/actions/runs/{run['id']}/jobs?filter=latest", "jobs")
            if not required.issubset({job["name"] for job in jobs if job.get("conclusion") == "success"}):
                return None
            sha = run.get("head_sha", "")
            return sha if re.fullmatch(r"[0-9a-f]{40}", sha) else None
        return None

    # The repository endpoint filters by exact artifact name. Read every
    # bounded page and sort locally: API response ordering is not a receipt.
    artifacts = pages("/actions/artifacts?name=deployed-sha", "artifacts")
    artifacts = [artifact for artifact in artifacts if artifact.get("name") == "deployed-sha"]
    if not artifacts:
        return None
    artifacts.sort(key=lambda item: timestamp(item.get("created_at")), reverse=True)
    if len(artifacts) > 1 and timestamp(artifacts[0]["created_at"]) == timestamp(artifacts[1]["created_at"]):
        return None
    marker = artifacts[0]
    if marker.get("expired"):
        return None
    marker_run = marker.get("workflow_run") or {}
    run_id = marker_run.get("id")
    if type(run_id) is not int or run_id <= 0 or run_id == current or marker_run.get("head_branch") != "main":
        return None
    run = json.loads(api(f"/actions/runs/{run_id}"))
    workflow_identity = json.loads(api("/actions/workflows/deploy.yml"))
    if (type(workflow_identity.get("id")) is not int or workflow_identity["id"] <= 0 or
        run.get("id") != run_id or run.get("workflow_id") != workflow_identity["id"] or
        workflow_identity.get("path") != ".github/workflows/deploy.yml" or
        run.get("event") not in {"workflow_run", "workflow_dispatch"} or
        run.get("head_branch") != "main" or
        (run.get("head_repository") or {}).get("full_name") != os.environ["GITHUB_REPOSITORY"] or
        run.get("conclusion") != "success" or
        marker_run.get("head_sha") != run.get("head_sha") or
        type(run.get("run_attempt")) is not int or run["run_attempt"] <= 0):
        return None
    jobs = pages(f"/actions/runs/{run_id}/jobs?filter=latest", "jobs")
    receipt_jobs = [job for job in jobs if job.get("name") == "deploy-receipt" and job.get("conclusion") == "success"]
    deploy_jobs = [job for job in jobs if job.get("name", "").startswith("deploy / ")]
    if (len(receipt_jobs) != 1 or len(deploy_jobs) != 1 or deploy_jobs[0].get("conclusion") != "success" or
        timestamp(receipt_jobs[0].get("completed_at")) < timestamp(marker["created_at"])):
        return None
    archive = api(f"/actions/artifacts/{marker['id']}/zip")
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        if zipped.namelist() != ["deployed-sha.json"] or zipped.getinfo("deployed-sha.json").file_size > 4096:
            return None
        receipt = json.loads(zipped.read("deployed-sha.json"))
    if (type(receipt.get("schema_version")) is not int or receipt["schema_version"] != 1 or
        type(receipt.get("run_id")) is not int or receipt["run_id"] != run_id or
        type(receipt.get("run_attempt")) is not int or receipt["run_attempt"] != run["run_attempt"] or
        receipt.get("head_sha") != run.get("head_sha")):
        return None
    sha = receipt.get("head_sha", "")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        return None

    # A later deploy may have published but failed before uploading a receipt.
    # Include failed, cancelled and running workflows, and old runs rerun late.
    # Only an explicit skipped reusable deploy job proves such a run harmless.
    later = pages("/actions/workflows/deploy.yml/runs?branch=main", "workflow_runs")
    inspected = 0
    seen_marker_run = False
    for candidate in later:
        if candidate.get("id") == current:
            continue
        if candidate.get("id") == run_id:
            seen_marker_run = True
            if candidate.get("run_attempt") != run["run_attempt"]:
                return None
            continue
        if timestamp(candidate.get("updated_at")) < timestamp(marker["created_at"]):
            continue
        inspected += 1
        if inspected > 10:
            return None
        candidate_jobs = pages(f"/actions/runs/{candidate['id']}/jobs?filter=all", "jobs")
        reusable = [job for job in candidate_jobs if job.get("name", "").startswith("deploy / ")]
        if not reusable or any(job.get("conclusion") != "skipped" for job in reusable):
            return None
    return sha if seen_marker_run else None


if __name__ == "__main__":
    result = None
    try:
        if len(sys.argv) == 2 and sys.argv[1] in {"ci", "deploy"}:
            result = latest(sys.argv[1])
    except (OSError, KeyError, ValueError, TypeError, AttributeError, zipfile.BadZipFile):
        pass
    print(result or "")
