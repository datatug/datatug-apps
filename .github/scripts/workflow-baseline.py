#!/usr/bin/env python3
"""Find the latest verified successful CI or actual deploy SHA, or return none."""

import io
from datetime import datetime
import json
import os
import re
import sys
import urllib.request
import zipfile


def api(path, accept="application/vnd.github+json"):
    request = urllib.request.Request(
        "https://api.github.com/repos/" + os.environ["GITHUB_REPOSITORY"] + path,
        headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"], "Accept": accept},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
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
    workflow = "ci.yml" if mode == "ci" else "deploy.yml"
    current = int(os.environ["GITHUB_RUN_ID"])
    runs = pages(f"/actions/workflows/{workflow}/runs?branch=main&status=success", "workflow_runs")
    candidates = [run for run in runs if run.get("id") != current and run.get("conclusion") == "success" and
                  (mode != "ci" or run.get("event") == "push")]
    if mode == "ci":
        required = {"build", "test", "e2e", "journey e2e (real datatug-cli agent)", "deploy-gate"}
        for run in sorted(candidates, key=lambda item: timestamp(item.get("updated_at")), reverse=True):
            jobs = pages(f"/actions/runs/{run['id']}/jobs?filter=latest", "jobs")
            if not required.issubset({job["name"] for job in jobs if job.get("conclusion") == "success"}):
                return None
            sha = run.get("head_sha", "")
            return sha if re.fullmatch(r"[0-9a-f]{40}", sha) else None
        return None

    deployed = []
    for run in candidates:
        jobs = pages(f"/actions/runs/{run['id']}/jobs?filter=latest", "jobs")
        receipts = [job for job in jobs if job.get("name") == "deploy-receipt" and job.get("conclusion") == "success"]
        for job in receipts:
            deployed.append((timestamp(job.get("completed_at")), run))
    if not deployed:
        return None
    deployed.sort(key=lambda item: item[0], reverse=True)
    if len(deployed) > 1 and deployed[0][0] == deployed[1][0]:
        return None
    run = deployed[0][1]
    artifacts = pages(f"/actions/runs/{run['id']}/artifacts", "artifacts")
    marker_name = f"deployed-sha-{run['run_attempt']}"
    marker = next((a for a in artifacts if a.get("name") == marker_name and not a.get("expired")), None)
    if marker is None:
        return None
    archive = api(f"/actions/artifacts/{marker['id']}/zip")
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        receipt = json.loads(zipped.read("deployed-sha.json"))
    if receipt.get("run_id") != run["id"] or receipt.get("run_attempt") != run["run_attempt"]:
        return None
    sha = receipt.get("sha", "")
    return sha if sha == run.get("head_sha") and re.fullmatch(r"[0-9a-f]{40}", sha) else None


if __name__ == "__main__":
    result = None
    try:
        if len(sys.argv) == 2 and sys.argv[1] in {"ci", "deploy"}:
            result = latest(sys.argv[1])
    except (OSError, KeyError, ValueError, zipfile.BadZipFile):
        pass
    print(result or "")
