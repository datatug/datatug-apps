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

    def deploy_api(self, *, later=None, artifacts=None, run=None, jobs=None, archive=None):
        sha = "b" * 40
        marker = {"name": "deployed-sha", "id": 3, "expired": False,
                  "created_at": "2026-10-16T12:00:00Z",
                  "workflow_run": {"id": 90, "head_branch": "main", "head_sha": sha}}
        deployed_run = {"id": 90, "run_attempt": 2, "workflow_id": 358505433, "path": ".github/workflows/deploy.yml@main",
                        "event": "workflow_run", "head_branch": "main",
                        "head_repository": {"full_name": "datatug/datatug-apps"},
                        "head_sha": sha, "conclusion": "success"}
        deployed_jobs = [
            {"name": "deploy / build · deploy", "conclusion": "success", "completed_at": "2026-10-16T11:59:50Z"},
            {"name": "deploy-receipt", "conclusion": "success", "completed_at": "2026-10-16T12:00:05Z"},
        ]
        zipped_bytes = io.BytesIO()
        with zipfile.ZipFile(zipped_bytes, "w") as zipped:
            zipped.writestr("deployed-sha.json", json.dumps({"schema_version": 1, "head_sha": sha,
                                                              "run_id": 90, "run_attempt": 2}))
        def api(path, accept=None):
            if path.startswith("/actions/artifacts?name=deployed-sha"):
                return json.dumps({"artifacts": artifacts if artifacts is not None else [marker]}).encode()
            if path == "/actions/workflows/deploy.yml":
                return json.dumps({"id": 358505433, "path": ".github/workflows/deploy.yml"}).encode()
            if path == "/actions/runs/90":
                return json.dumps(run if run is not None else deployed_run).encode()
            if "/actions/runs/90/jobs?" in path:
                return json.dumps({"jobs": jobs if jobs is not None else deployed_jobs}).encode()
            if path == "/actions/artifacts/3/zip":
                return archive if archive is not None else zipped_bytes.getvalue()
            if path.startswith("/actions/workflows/deploy.yml/runs?"):
                return json.dumps({"workflow_runs": later if later is not None else [
                    {"id": 90, "run_attempt": 2, "updated_at": "2026-10-16T12:00:06Z"}]}).encode()
            if "/actions/runs/95/jobs?" in path:
                return json.dumps({"jobs": [{"name": "deploy / build · deploy", "conclusion": "skipped"}]}).encode()
            raise AssertionError(path)
        return api

    def deploy_baseline(self, api):
        with patch.dict(os.environ, {"GITHUB_RUN_ID": "100", "GITHUB_REPOSITORY": "datatug/datatug-apps"}), patch.object(baseline, "api", api):
            return baseline.latest("deploy")

    def test_actual_deploy_receipt_is_required(self):
        self.assertEqual(self.deploy_baseline(self.deploy_api()), "b" * 40)
        self.assertIsNone(self.deploy_baseline(self.deploy_api(artifacts=[])))

    def test_later_skipped_metadata_deploy_keeps_verified_receipt(self):
        later = [{"id": 95, "updated_at": "2026-10-16T13:00:00Z"},
                 {"id": 90, "run_attempt": 2, "updated_at": "2026-10-16T12:00:06Z"}]
        self.assertEqual(self.deploy_baseline(self.deploy_api(later=later)), "b" * 40)

    def test_later_unreceipted_or_unknown_deploy_forces_normal_deployment(self):
        later = [{"id": 95, "updated_at": "2026-10-16T13:00:00Z"},
                 {"id": 90, "run_attempt": 2, "updated_at": "2026-10-16T12:00:06Z"}]
        api = self.deploy_api(later=later)
        def unreceipted(path, accept=None):
            if "/actions/runs/95/jobs?" in path:
                return json.dumps({"jobs": [{"name": "deploy / build · deploy", "conclusion": "success"}]}).encode()
            return api(path, accept)
        self.assertIsNone(self.deploy_baseline(unreceipted))
        def failed_after_publish(path, accept=None):
            if "/actions/runs/95/jobs?" in path:
                return json.dumps({"jobs": [{"name": "deploy / build · deploy", "conclusion": "failure"}]}).encode()
            return api(path, accept)
        self.assertIsNone(self.deploy_baseline(failed_after_publish))
        def unknown(path, accept=None):
            if "/actions/runs/95/jobs?" in path:
                return json.dumps({"jobs": []}).encode()
            return api(path, accept)
        self.assertIsNone(self.deploy_baseline(unknown))

    def test_later_rerun_with_skipped_latest_attempt_cannot_hide_prior_publication(self):
        later = [{"id": 95, "run_attempt": 2, "updated_at": "2026-10-16T13:00:00Z"},
                 {"id": 90, "run_attempt": 2, "updated_at": "2026-10-16T12:00:06Z"}]
        api = self.deploy_api(later=later)
        def published_before_skip(path, accept=None):
            if "/actions/runs/95/jobs?" in path:
                self.assertIn("filter=all", path)
                return json.dumps({"jobs": [
                    {"name": "deploy / build · deploy", "conclusion": "success", "run_attempt": 1},
                    {"name": "deploy / build · deploy", "conclusion": "skipped", "run_attempt": 2},
                ]}).encode()
            return api(path, accept)
        self.assertIsNone(self.deploy_baseline(published_before_skip))

    def test_newer_attempt_without_receipt_forces_normal_deployment(self):
        later = [{"id": 90, "run_attempt": 3, "updated_at": "2026-10-16T13:00:00Z"}]
        self.assertIsNone(self.deploy_baseline(self.deploy_api(later=later)))

    def test_receipt_run_attempt_and_head_must_match_provider(self):
        run = {"id": 90, "run_attempt": 3, "workflow_id": 358505433, "path": ".github/workflows/deploy.yml@main",
               "event": "workflow_run", "head_branch": "main",
               "head_repository": {"full_name": "datatug/datatug-apps"},
               "head_sha": "b" * 40, "conclusion": "success"}
        self.assertIsNone(self.deploy_baseline(self.deploy_api(run=run)))
        run["run_attempt"] = 2
        run["head_sha"] = "c" * 40
        self.assertIsNone(self.deploy_baseline(self.deploy_api(run=run)))

    def test_marker_from_other_workflow_or_branch_cannot_authorize_skip(self):
        run = {"id": 90, "run_attempt": 2, "workflow_id": 999, "path": ".github/workflows/other.yml@feature",
               "event": "pull_request", "head_branch": "feature",
               "head_repository": {"full_name": "other/repo"},
               "head_sha": "b" * 40, "conclusion": "success"}
        self.assertIsNone(self.deploy_baseline(self.deploy_api(run=run)))

    def test_receipt_archive_must_be_small_and_single_file(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("deployed-sha.json", "x" * 4097)
        self.assertIsNone(self.deploy_baseline(self.deploy_api(archive=archive.getvalue())))
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("deployed-sha.json", json.dumps({"schema_version": 1, "head_sha": "b" * 40,
                                                              "run_id": 90, "run_attempt": 2}))
            zipped.writestr("extra.txt", "unexpected")
        self.assertIsNone(self.deploy_baseline(self.deploy_api(archive=archive.getvalue())))

    def test_local_sort_checks_newest_marker_regardless_of_api_order(self):
        old = {"name": "deployed-sha", "id": 4, "expired": False,
               "created_at": "2026-10-16T11:00:00Z",
               "workflow_run": {"id": 80, "head_branch": "main", "head_sha": "a" * 40}}
        new = {"name": "deployed-sha", "id": 3, "expired": False,
               "created_at": "2026-10-16T12:00:00Z",
               "workflow_run": {"id": 90, "head_branch": "main", "head_sha": "b" * 40}}
        self.assertEqual(self.deploy_baseline(self.deploy_api(artifacts=[old, new])), "b" * 40)
        new["expired"] = True
        self.assertIsNone(self.deploy_baseline(self.deploy_api(artifacts=[old, new])))

    def test_current_run_and_old_runs_do_not_replace_actual_receipt(self):
        later = [{"id": 100, "updated_at": "2026-10-16T13:00:00Z"},
                 {"id": 80, "updated_at": "2026-10-16T11:00:00Z"},
                 {"id": 90, "run_attempt": 2, "updated_at": "2026-10-16T12:00:06Z"}]
        self.assertEqual(self.deploy_baseline(self.deploy_api(later=later)), "b" * 40)

    def test_filtered_artifacts_and_later_runs_are_paginated_and_sorted_locally(self):
        marker = {"name": "deployed-sha", "id": 3, "expired": False,
                  "created_at": "2026-10-16T12:00:00Z",
                  "workflow_run": {"id": 90, "head_branch": "main", "head_sha": "b" * 40}}
        old_artifacts = [{"name": "deployed-sha", "id": n + 1000, "expired": False,
                          "created_at": "2026-10-15T11:00:00Z",
                          "workflow_run": {"id": n + 1000, "head_branch": "main", "head_sha": "a" * 40}}
                         for n in range(100)]
        old_runs = [{"id": n + 1000, "updated_at": "2026-10-15T11:00:00Z"} for n in range(100)]
        api = self.deploy_api()
        def paged(path, accept=None):
            if path.startswith("/actions/artifacts?name=deployed-sha"):
                return json.dumps({"artifacts": old_artifacts if path.endswith("page=1") else [marker]}).encode()
            if path.startswith("/actions/workflows/deploy.yml/runs?"):
                return json.dumps({"workflow_runs": old_runs if path.endswith("page=1") else [
                    {"id": 90, "run_attempt": 2, "updated_at": "2026-10-16T12:00:06Z"}]}).encode()
            return api(path, accept)
        self.assertEqual(self.deploy_baseline(paged), "b" * 40)

    def test_many_later_runs_or_malformed_time_take_full_path(self):
        later = [{"id": n + 1000, "updated_at": "2026-10-16T13:00:00Z"} for n in range(11)]
        api = self.deploy_api(later=later)
        def skipped(path, accept=None):
            if path.startswith("/actions/runs/1") and "/jobs?" in path:
                return json.dumps({"jobs": [{"name": "deploy / build · deploy", "conclusion": "skipped"}]}).encode()
            return api(path, accept)
        self.assertIsNone(self.deploy_baseline(skipped))
        later[0]["updated_at"] = "unexpected"
        with self.assertRaises(ValueError):
            self.deploy_baseline(skipped)


if __name__ == "__main__":
    unittest.main()
