"""Exact successful CI and actual deployment baseline fixtures."""

import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
import zipfile


SCRIPT = Path(__file__).with_name("workflow-baseline.py")
SPEC = importlib.util.spec_from_file_location("workflow_baseline", SCRIPT)
baseline = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(baseline)


class BaselineTest(unittest.TestCase):
    def test_ci_uses_previous_verified_success_not_failed_code_commit(self):
        sha = "a" * 40

        def api(path, accept=None):
            if "/runs?" in path:
                return json.dumps({"workflow_runs": [
                    {"id": 90, "event": "push", "conclusion": "success", "head_sha": sha, "updated_at": "2026-10-16T12:00:00Z"},
                ]}).encode()
            if "/runs/90/jobs" in path:
                return json.dumps({"jobs": [{"name": name, "conclusion": "success"} for name in
                    ("build", "test", "e2e", "journey e2e (real datatug-cli agent)", "deploy-gate")]}).encode()
            raise AssertionError(path)

        with patch.dict(os.environ, {"GITHUB_RUN_ID": "100", "GITHUB_REPOSITORY": "datatug/datatug-apps"}), patch.object(baseline, "api", api):
            self.assertEqual(baseline.latest("ci"), sha)

    def test_missing_required_ci_job_has_no_shortcut_baseline(self):
        def api(path, accept=None):
            if "/runs?" in path:
                return json.dumps({"workflow_runs": [{"id": 90, "event": "push", "conclusion": "success", "head_sha": "a" * 40, "updated_at": "2026-10-16T12:00:00Z"}]}).encode()
            return json.dumps({"jobs": [{"name": "build", "conclusion": "success"}]}).encode()

        with patch.dict(os.environ, {"GITHUB_RUN_ID": "100", "GITHUB_REPOSITORY": "datatug/datatug-apps"}), patch.object(baseline, "api", api):
            self.assertIsNone(baseline.latest("ci"))

    def test_actual_deploy_receipt_is_required(self):
        sha = "b" * 40
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("deployed-sha.json", json.dumps({"sha": sha, "run_id": 90, "run_attempt": 2}))

        def api(path, accept=None):
            if "/runs?" in path:
                return json.dumps({"workflow_runs": [{"id": 90, "run_attempt": 2, "conclusion": "success", "head_sha": sha, "updated_at": "2026-10-16T12:00:00Z"}]}).encode()
            if "/runs/90/jobs" in path:
                return json.dumps({"jobs": [{"name": "deploy-receipt", "conclusion": "success", "completed_at": "2026-10-16T12:00:00Z"}]}).encode()
            if "/runs/90/artifacts" in path:
                return json.dumps({"artifacts": [{"name": "deployed-sha-2", "id": 3, "expired": False}]}).encode()
            if "/artifacts/3/zip" in path:
                return archive.getvalue()
            raise AssertionError(path)

        with patch.dict(os.environ, {"GITHUB_RUN_ID": "100", "GITHUB_REPOSITORY": "datatug/datatug-apps"}), patch.object(baseline, "api", api):
            self.assertEqual(baseline.latest("deploy"), sha)

    def test_green_metadata_gate_without_deploy_does_not_replace_actual_deploy(self):
        sha = "b" * 40
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("deployed-sha.json", json.dumps({"sha": sha, "run_id": 90, "run_attempt": 1}))

        def api(path, accept=None):
            if "/runs?" in path:
                return json.dumps({"workflow_runs": [
                    {"id": 95, "run_attempt": 1, "conclusion": "success"},
                    {"id": 90, "run_attempt": 1, "conclusion": "success", "head_sha": sha, "updated_at": "2026-10-16T12:00:00Z"},
                ]}).encode()
            if "/runs/95/jobs" in path:
                return json.dumps({"jobs": [{"name": "deploy gate", "conclusion": "success"}]}).encode()
            if "/runs/90/jobs" in path:
                return json.dumps({"jobs": [{"name": "deploy-receipt", "conclusion": "success", "completed_at": "2026-10-16T12:00:00Z"}]}).encode()
            if "/runs/90/artifacts" in path:
                return json.dumps({"artifacts": [{"name": "deployed-sha-1", "id": 3, "expired": False}]}).encode()
            if "/artifacts/3/zip" in path:
                return archive.getvalue()
            raise AssertionError(path)

        with patch.dict(os.environ, {"GITHUB_RUN_ID": "100", "GITHUB_REPOSITORY": "datatug/datatug-apps"}), patch.object(baseline, "api", api):
            self.assertEqual(baseline.latest("deploy"), sha)

    def test_latest_attempt_receipt_on_second_job_and_artifact_pages(self):
        sha = "c" * 40
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("deployed-sha.json", json.dumps({"sha": sha, "run_id": 90, "run_attempt": 3}))

        def api(path, accept=None):
            if "/runs?" in path:
                return json.dumps({"workflow_runs": [{"id": 90, "run_attempt": 3, "conclusion": "success", "head_sha": sha, "updated_at": "2026-10-16T12:00:00Z"}]}).encode()
            if "/runs/90/jobs" in path:
                jobs = [{"name": f"other-{n}", "conclusion": "success"} for n in range(100)] if path.endswith("page=1") else [
                    {"name": "deploy-receipt", "conclusion": "success", "completed_at": "2026-10-16T12:00:00Z"}]
                return json.dumps({"jobs": jobs}).encode()
            if "/runs/90/artifacts" in path:
                artifacts = [{"name": f"other-{n}", "id": n, "expired": False} for n in range(100)] if path.endswith("page=1") else [
                    {"name": "deployed-sha-2", "id": 2, "expired": False},
                    {"name": "deployed-sha-3", "id": 3, "expired": False},
                ]
                return json.dumps({"artifacts": artifacts}).encode()
            if "/artifacts/3/zip" in path:
                return archive.getvalue()
            raise AssertionError(path)

        with patch.dict(os.environ, {"GITHUB_RUN_ID": "100", "GITHUB_REPOSITORY": "datatug/datatug-apps"}), patch.object(baseline, "api", api):
            self.assertEqual(baseline.latest("deploy"), sha)

    def test_later_successful_rerun_is_the_actual_deployment_baseline(self):
        sha = "d" * 40
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("deployed-sha.json", json.dumps({"sha": sha, "run_id": 90, "run_attempt": 2}))

        def api(path, accept=None):
            if "/runs?" in path:
                return json.dumps({"workflow_runs": [
                    {"id": 95, "run_attempt": 1, "conclusion": "success", "head_sha": "e" * 40},
                    {"id": 90, "run_attempt": 2, "conclusion": "success", "head_sha": sha},
                ]}).encode()
            if "/runs/95/jobs" in path:
                return json.dumps({"jobs": [{"name": "deploy-receipt", "conclusion": "success", "completed_at": "2026-10-16T12:00:00Z"}]}).encode()
            if "/runs/90/jobs" in path:
                return json.dumps({"jobs": [{"name": "deploy-receipt", "conclusion": "success", "completed_at": "2026-10-16T13:00:00Z"}]}).encode()
            if "/runs/90/artifacts" in path:
                return json.dumps({"artifacts": [{"name": "deployed-sha-2", "id": 3, "expired": False}]}).encode()
            if "/artifacts/3/zip" in path:
                return archive.getvalue()
            raise AssertionError(path)

        with patch.dict(os.environ, {"GITHUB_RUN_ID": "100", "GITHUB_REPOSITORY": "datatug/datatug-apps"}), patch.object(baseline, "api", api):
            self.assertEqual(baseline.latest("deploy"), sha)


if __name__ == "__main__":
    unittest.main()
