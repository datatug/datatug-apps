"""Security regression tests for the online RecordsetCompare artifact consumer."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
import subprocess
import tarfile
import tempfile
import time
import unittest
from contextlib import contextmanager
from email.message import Message
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit

import consume


SOURCE_COMMIT = "a" * 40
ARCHIVE_NAME = "recordsetcompare-test.tar.gz"
WORKFLOW = "https://github.com/datatug/datatug-core/.github/workflows/golangci.yml@refs/heads/main"


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _proof(lock: dict, *, certificate_overrides: dict | None = None, subject_overrides: dict | None = None) -> str:
    certificate = {
        "issuer": lock["issuer"],
        "subjectAlternativeName": lock["workflowIdentity"],
        "sourceRepositoryURI": f"https://github.com/{lock['repository']}",
        "sourceRepositoryDigest": lock["sourceCommit"],
        "sourceRepositoryRef": lock["sourceRef"],
        "buildSignerURI": lock["workflowIdentity"],
        "buildSignerDigest": lock["sourceCommit"],
        "runnerEnvironment": "github-hosted",
        "githubWorkflowTrigger": "push",
        "buildTrigger": "push",
    }
    certificate.update(certificate_overrides or {})
    subject = {"name": lock["archiveName"], "digest": {"sha256": lock["archiveSHA256"]}}
    subject.update(subject_overrides or {})
    return json.dumps(
        [
            {
                "verificationResult": {
                    "signature": {"certificate": certificate},
                    "statement": {
                        "subject": [subject],
                        "predicateType": "https://slsa.dev/provenance/v1",
                    },
                }
            }
        ]
    )


def _fixture(root: Path, *, unsafe_member: str | None = None, symlink_member: str | None = None):
    files: dict[str, bytes] = {
        name: f"test package bytes for {name}".encode()
        for name in consume.EXPECTED_FILES
        if name != "manifest.json"
    }
    manifest_files = {name: {"bytes": len(data), "sha256": _sha(data)} for name, data in files.items()}
    files["manifest.json"] = json.dumps(
        {
            "abi": "recordsetcompare/1",
            "sourceCommit": SOURCE_COMMIT,
            "sourceTag": "v1.2.3",
            "files": manifest_files,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    lock = {
        "schemaVersion": 1,
        "repository": "datatug/datatug-core",
        "tag": "v1.2.3",
        "sourceCommit": SOURCE_COMMIT,
        "sourceRef": "refs/heads/main",
        "workflowPath": ".github/workflows/golangci.yml",
        "workflowIdentity": WORKFLOW,
        "issuer": "https://token.actions.githubusercontent.com",
        "archiveName": ARCHIVE_NAME,
        "archiveBytes": 1,
        "archiveSHA256": "0" * 64,
        "abi": "recordsetcompare/1",
        "files": {name: {"bytes": len(data), "sha256": _sha(data)} for name, data in files.items()},
    }
    archive = root / ARCHIVE_NAME
    with tarfile.open(archive, mode="w:gz") as package:
        for name, data in files.items():
            if name == symlink_member:
                item = tarfile.TarInfo(name)
                item.type = tarfile.SYMTYPE
                item.linkname = "../../outside"
                package.addfile(item)
                continue
            item = tarfile.TarInfo(name)
            item.size = len(data)
            package.addfile(item, io.BytesIO(data))
        if unsafe_member:
            item = tarfile.TarInfo(unsafe_member)
            item.size = 1
            package.addfile(item, io.BytesIO(b"x"))
    lock["archiveBytes"] = archive.stat().st_size
    lock["archiveSHA256"] = _sha(archive.read_bytes())
    lock_path = root / "lock.json"
    lock_path.write_text(json.dumps(lock), encoding="utf-8")
    return lock, lock_path, archive


class FakeGh:
    def __init__(self, lock: dict, archive: Path):
        self.lock = lock
        self.archive = archive
        self.calls: list[list[str]] = []
        self.tag_sha = lock["sourceCommit"]
        self.tag_object_sha = None
        self.tag_sha_sequence = []
        self.tag_ref_reads = 0
        self.release = {
            "tag_name": lock["tag"],
            "draft": False,
            "prerelease": False,
            "assets": [
                {
                    "id": 41,
                    "name": lock["archiveName"],
                    "state": "uploaded",
                    "size": archive.stat().st_size,
                    "digest": f"sha256:{_sha(archive.read_bytes())}",
                    "url": f"https://api.github.com/repos/{lock['repository']}/releases/assets/41",
                }
            ],
        }
        self.attestation = _proof(lock)

    def __call__(self, args: list[str], **_kwargs) -> str:
        self.calls.append(args)
        command = args[1:]
        if command[:2] == ["api", f"repos/{self.lock['repository']}/releases/tags/{self.lock['tag']}"]:
            return json.dumps(self.release)
        if command[:2] == ["api", f"repos/{self.lock['repository']}/git/ref/tags/{self.lock['tag']}"]:
            if self.tag_sha_sequence:
                index = min(self.tag_ref_reads, len(self.tag_sha_sequence) - 1)
                self.tag_sha = self.tag_sha_sequence[index]
                self.tag_ref_reads += 1
            tag_object = (
                {"type": "tag", "sha": self.tag_object_sha}
                if self.tag_object_sha
                else {"type": "commit", "sha": self.tag_sha}
            )
            return json.dumps({"object": tag_object})
        if command[:2] == ["api", f"repos/{self.lock['repository']}/git/tags/{self.tag_object_sha}"]:
            return json.dumps({"object": {"type": "commit", "sha": self.tag_sha}})
        if command[:2] == ["attestation", "verify"]:
            return self.attestation
        raise AssertionError(f"unexpected verifier command: {args}")


class FakeAssetResponse:
    def __init__(self, body: bytes, *, headers: dict[str, str] | None = None, delay_per_read: float = 0):
        self.body = body
        self.headers = headers or {}
        self.offset = 0
        self.closed = False
        self.read_sizes: list[int] = []
        self.delay_per_read = delay_per_read

    def getcode(self) -> int:
        return 200

    def read(self, size: int = -1) -> bytes:
        if self.delay_per_read:
            time.sleep(self.delay_per_read)
        self.read_sizes.append(size)
        if size < 0:
            size = len(self.body) - self.offset
        end = min(len(self.body), self.offset + size)
        chunk = self.body[self.offset:end]
        self.offset = end
        return chunk

    def close(self) -> None:
        self.closed = True


class FakeAssetOpener:
    def __init__(
        self,
        body: bytes,
        *,
        redirect_location: str | None = "https://release-assets.githubusercontent.com/download/test",
        headers: dict[str, str] | None = None,
        error: Exception | None = None,
        delay_per_read: float = 0,
    ):
        self.body = body
        self.redirect_location = redirect_location
        self.response_headers = headers or {}
        self.error = error
        self.delay_per_read = delay_per_read
        self.calls: list[tuple[object, float]] = []
        self.responses: list[FakeAssetResponse] = []

    def open(self, request, *, timeout: float):  # type: ignore[no-untyped-def]
        self.calls.append((request, timeout))
        if self.error:
            raise self.error
        host = urlsplit(request.full_url).hostname
        if host == consume.ASSET_API_HOST and self.redirect_location is not None:
            headers = Message()
            headers["Location"] = self.redirect_location
            raise HTTPError(request.full_url, 302, "Found", headers, io.BytesIO())
        if host not in {consume.ASSET_API_HOST, *consume.ASSET_REDIRECT_HOSTS}:
            raise AssertionError(f"unexpected asset host: {host}")
        response = FakeAssetResponse(self.body, headers=self.response_headers, delay_per_read=self.delay_per_read)
        self.responses.append(response)
        return response


class ConsumeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.root_patch = patch.object(consume, "ROOT", self.root)
        self.root_patch.start()
        self.lock, self.lock_path, self.archive = _fixture(self.root)
        self.gh = FakeGh(self.lock, self.archive)

    def tearDown(self):
        self.root_patch.stop()
        self.temp.cleanup()

    @contextmanager
    def fake_online(self):
        opener = FakeAssetOpener(self.archive.read_bytes())
        with patch.object(consume, "run_command", self.gh), patch.object(
            consume, "build_opener", return_value=opener
        ):
            yield opener

    def download(self, opener: FakeAssetOpener, asset: dict | None = None) -> Path:
        metadata = asset or {
            "id": 41,
            "url": f"https://api.github.com/repos/{self.lock['repository']}/releases/assets/41",
        }
        directory = self.root / "downloads"
        directory.mkdir(exist_ok=True)
        with patch.object(consume, "build_opener", return_value=opener):
            return consume._download_archive(self.lock, directory, metadata)

    def test_release_metadata_requires_one_exact_uploaded_locked_asset(self):
        with patch.object(consume, "run_command", self.gh):
            asset = consume._validate_release(self.lock)
        self.assertEqual(asset, {
            "id": 41,
            "url": "https://api.github.com/repos/datatug/datatug-core/releases/assets/41",
        })
        args = self.gh.calls[-1]
        self.assertEqual(args[:2], ["gh", "api"])
        self.assertEqual(args[2], "repos/datatug/datatug-core/releases/tags/v1.2.3")

        self.gh.release["assets"].append(dict(self.gh.release["assets"][0]))
        with patch.object(consume, "run_command", self.gh), self.assertRaisesRegex(
            consume.VerificationError, "exactly one asset"
        ):
            consume._validate_release(self.lock)

    def test_streaming_download_follows_allowlisted_redirect_without_forwarding_auth(self):
        with patch.dict(consume.os.environ, {"GH_TOKEN": "test-token"}):
            opener = FakeAssetOpener(self.archive.read_bytes())
            result = self.download(opener)
        self.assertEqual(result.read_bytes(), self.archive.read_bytes())
        self.assertEqual(len(opener.calls), 2)
        api_request, api_timeout = opener.calls[0]
        asset_request, asset_timeout = opener.calls[1]
        self.assertEqual(urlsplit(api_request.full_url).hostname, "api.github.com")
        self.assertEqual(api_request.get_header("Authorization"), "Bearer test-token")
        self.assertEqual(urlsplit(asset_request.full_url).hostname, "release-assets.githubusercontent.com")
        self.assertIsNone(asset_request.get_header("Authorization"))
        self.assertEqual(api_timeout, consume.DOWNLOAD_TIMEOUT_SECONDS)
        self.assertEqual(asset_timeout, consume.DOWNLOAD_TIMEOUT_SECONDS)
        self.assertTrue(opener.responses[0].closed)

    def test_asset_404_explains_missing_environment_credential_without_exposing_values(self):
        for configured in (False, True):
            with self.subTest(configured=configured):
                error = HTTPError("https://api.github.com/asset", 404, "Not Found", Message(), io.BytesIO())
                opener = FakeAssetOpener(b"", error=error)
                environment = {"GH_TOKEN": "private-test-token"} if configured else {}
                with patch.dict(consume.os.environ, environment, clear=True):
                    with self.assertRaises(consume.VerificationError) as raised:
                        self.download(opener)
                message = str(raised.exception)
                self.assertIn("HTTP 404", message)
                self.assertNotIn("private-test-token", message)
                self.assertEqual("does not inherit gh's stored login" in message, not configured)
                if not configured:
                    self.assertIn("GH_TOKEN or GITHUB_TOKEN", message)
                self.assertEqual(len(opener.calls), 1)

    def test_streaming_download_accepts_direct_api_response_and_reads_in_bounded_chunks(self):
        body = bytes(range(256)) * 500
        self.lock["archiveBytes"] = len(body)
        self.lock["archiveSHA256"] = _sha(body)
        opener = FakeAssetOpener(body, redirect_location=None)
        with patch.dict(consume.os.environ, {}, clear=True):
            downloaded = self.download(opener)
        self.assertEqual(downloaded.read_bytes(), body)
        self.assertEqual(len(opener.calls), 1)
        self.assertEqual(urlsplit(opener.calls[0][0].full_url).hostname, "api.github.com")
        self.assertLessEqual(max(opener.responses[0].read_sizes), consume.MAX_DOWNLOAD_CHUNK_BYTES)
        self.assertIsNone(opener.calls[0][0].get_header("Authorization"))

    def test_streaming_download_stops_after_one_byte_over_the_locked_bound(self):
        body = self.archive.read_bytes() + b"x"
        opener = FakeAssetOpener(body)
        with self.assertRaisesRegex(consume.VerificationError, "exceeded its locked byte count"):
            self.download(opener)
        self.assertEqual(opener.responses[0].offset, self.lock["archiveBytes"] + 1)
        self.assertFalse((self.root / "downloads" / self.lock["archiveName"]).exists())

    def test_streaming_download_rejects_short_body_content_length_and_timeout(self):
        cases = [
            (FakeAssetOpener(self.archive.read_bytes()[:-1]), "byte count and SHA-256"),
            (FakeAssetOpener(self.archive.read_bytes(), headers={"Content-Length": "1"}), "Content-Length"),
            (FakeAssetOpener(b"", error=URLError(TimeoutError())), "asset timed out"),
        ]
        for opener, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(consume.VerificationError, message):
                self.download(opener)
            self.assertFalse((self.root / "downloads" / self.lock["archiveName"]).exists())

    def test_streaming_download_enforces_total_wall_clock_timeout_for_dripping_peer(self):
        opener = FakeAssetOpener(self.archive.read_bytes(), delay_per_read=0.05)
        with patch.object(consume, "DOWNLOAD_WALL_TIMEOUT_SECONDS", 0.01):
            with self.assertRaisesRegex(consume.VerificationError, "wall-clock download timeout"):
                self.download(opener)
        self.assertTrue(opener.responses[0].closed)
        self.assertFalse((self.root / "downloads" / self.lock["archiveName"]).exists())

    def test_verification_command_enforces_wall_clock_timeout(self):
        with patch.object(consume.subprocess, "run", side_effect=subprocess.TimeoutExpired(["gh", "api"], 120)):
            with self.assertRaisesRegex(consume.VerificationError, "gh verification timed out"):
                consume.run_command(["gh", "api"])

    def test_verification_command_forces_official_github_host_over_inherited_enterprise_host(self):
        result = subprocess.CompletedProcess(["gh", "api"], 0, stdout="{}", stderr="")
        with patch.dict(consume.os.environ, {"GH_HOST": "enterprise.invalid"}), patch.object(
            consume.subprocess, "run", return_value=result
        ) as run:
            self.assertEqual(consume.run_command(["gh", "api"]), "{}")
        self.assertEqual(run.call_args.kwargs["env"]["GH_HOST"], "github.com")

    def test_streaming_download_refuses_non_github_redirects_and_downgrade(self):
        for target in (
            "https://attacker.example/download",
            "http://release-assets.githubusercontent.com/download",
            "https://user:pass@release-assets.githubusercontent.com/download",
            "https://release-assets.githubusercontent.com:444/download",
        ):
            with self.subTest(target=target), self.assertRaisesRegex(
                consume.VerificationError, "not an allowlisted HTTPS"
            ):
                self.download(FakeAssetOpener(self.archive.read_bytes(), redirect_location=target))

    def test_release_asset_metadata_size_and_digest_must_match_before_fetch(self):
        self.gh.release["assets"][0]["size"] += 1
        with patch.object(consume, "run_command", self.gh), self.assertRaisesRegex(
            consume.VerificationError, "state or size"
        ):
            consume._validate_release(self.lock)
        self.gh.release["assets"][0]["size"] = self.lock["archiveBytes"]
        self.gh.release["assets"][0]["digest"] = "sha256:" + "f" * 64
        with patch.object(consume, "run_command", self.gh), self.assertRaisesRegex(
            consume.VerificationError, "asset digest"
        ):
            consume._validate_release(self.lock)

    def test_download_requires_the_exact_repository_scoped_asset_endpoint(self):
        with self.assertRaisesRegex(consume.VerificationError, "unverified GitHub release asset endpoint"):
            self.download(FakeAssetOpener(self.archive.read_bytes()), {
                "id": 41,
                "url": "https://attacker.example/repos/datatug/datatug-core/releases/assets/41",
            })

    def test_prepare_rechecks_online_provenance_and_repairs_a_corrupt_existing_copy(self):
        destination = self.root / "assets/recordsetcompare"
        with self.fake_online():
            consume.prepare(self.lock_path, destination)
            (destination / "recordsetcompare.wasm").write_bytes(b"tampered")
            self.gh.calls.clear()
            consume.prepare(self.lock_path, destination)
        self.assertEqual(len(self.gh.calls), 4)
        self.assertEqual(
            [call[1] for call in self.gh.calls],
            ["api", "api", "attestation", "api"],
        )
        consume.verify_tree(destination, self.lock)

    def test_tag_peel_must_match_before_asset_download(self):
        self.gh.tag_sha = "b" * 40
        with self.fake_online(), self.assertRaisesRegex(
            consume.VerificationError, "peels to the locked source"
        ):
            consume.prepare(self.lock_path, self.root / "output")
        self.assertFalse(any(call[1:2] == ["attestation"] for call in self.gh.calls))

    def test_annotated_release_tag_is_recursively_peeled_before_and_after_download(self):
        self.gh.tag_object_sha = "c" * 40
        destination = self.root / "assets/recordsetcompare"
        with self.fake_online():
            consume.prepare(self.lock_path, destination)
        self.assertEqual(
            sum("git/tags/" in " ".join(call) for call in self.gh.calls),
            2,
            "the annotated tag must be peeled before and after the download",
        )

    def test_draft_or_prerelease_is_not_accepted(self):
        self.gh.release["draft"] = True
        with self.fake_online(), self.assertRaisesRegex(
            consume.VerificationError, "published, non-prerelease"
        ):
            consume.prepare(self.lock_path, self.root / "output")
        self.assertEqual(len(self.gh.calls), 1)

    def test_signed_certificate_and_subject_are_checked_after_gh_verification(self):
        self.gh.attestation = _proof(self.lock, certificate_overrides={"runnerEnvironment": "self-hosted"})
        destination = self.root / "assets/recordsetcompare"
        destination.mkdir(parents=True)
        sentinel = destination / "previous"
        sentinel.write_text("keep on failed verification", encoding="utf-8")
        with self.fake_online(), self.assertRaisesRegex(
            consume.VerificationError, "runnerEnvironment"
        ):
            consume.prepare(self.lock_path, destination)
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep on failed verification")

    def test_signed_subject_name_and_archive_digest_are_checked(self):
        self.gh.attestation = _proof(
            self.lock,
            subject_overrides={
                "name": "another-archive.tar.gz",
                "digest": {"sha256": "f" * 64},
            },
        )
        with self.fake_online(), self.assertRaisesRegex(
            consume.VerificationError, "subject does not match"
        ):
            consume.prepare(self.lock_path, self.root / "output")

    def test_tag_change_during_download_prevents_replacing_previous_assets(self):
        self.gh.tag_sha_sequence = [self.lock["sourceCommit"], "b" * 40]
        destination = self.root / "assets/recordsetcompare"
        destination.mkdir(parents=True)
        sentinel = destination / "previous"
        sentinel.write_text("keep", encoding="utf-8")
        with self.fake_online(), self.assertRaisesRegex(
            consume.VerificationError, "peels to the locked source"
        ):
            consume.prepare(self.lock_path, destination)
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")

    def test_attestation_command_uses_exact_repository_source_and_signer_policy(self):
        with patch.object(consume, "run_command", self.gh):
            consume._validate_attestation(self.lock, self.archive)
        args = self.gh.calls[-1]
        for expected in (
            "--repo", "datatug/datatug-core",
            "--cert-identity", WORKFLOW,
            "--cert-oidc-issuer", "https://token.actions.githubusercontent.com",
            "--source-digest", SOURCE_COMMIT,
            "--source-ref", "refs/heads/main",
            "--signer-digest", SOURCE_COMMIT,
            "--deny-self-hosted-runners",
        ):
            self.assertIn(expected, args)

    def test_archive_corruption_is_rejected_before_materialization(self):
        self.gh.attestation = _proof(self.lock)
        original = consume._download_archive

        def corrupt(lock, directory, asset):
            result = original(lock, directory, asset)
            with result.open("ab") as stream:
                stream.write(b"corruption")
            return result

        with self.fake_online(), patch.object(consume, "_download_archive", corrupt):
            with self.assertRaisesRegex(consume.VerificationError, "changed between download and extraction"):
                consume.prepare(self.lock_path, self.root / "output")

    def test_unsafe_archive_paths_and_symlinks_are_rejected(self):
        for unsafe_member, symlink_member in [("../outside", None), (None, "index.mjs")]:
            with self.subTest(unsafe_member=unsafe_member, symlink_member=symlink_member):
                _, _, archive = _fixture(self.root, unsafe_member=unsafe_member, symlink_member=symlink_member)
                lock = json.loads(self.lock_path.read_text(encoding="utf-8"))
                # Rebuild the archive's expected whole-file pin so extraction, rather than download, is tested.
                lock["archiveBytes"] = archive.stat().st_size
                lock["archiveSHA256"] = _sha(archive.read_bytes())
                with self.assertRaises(consume.VerificationError):
                    consume._read_archive(archive, lock)

    def test_streaming_archive_reader_stops_at_member_cap(self):
        _, _, archive = _fixture(self.root, unsafe_member="extra.bin")
        lock = json.loads(self.lock_path.read_text(encoding="utf-8"))
        with self.assertRaisesRegex(consume.VerificationError, "more than the 11 allowed members"):
            consume._read_archive(archive, lock)

    def test_streaming_archive_reader_bounds_decompressed_headers(self):
        archive = self.root / "pax-bomb.tar.gz"
        with tarfile.open(archive, mode="w:gz", format=tarfile.PAX_FORMAT) as package:
            member = tarfile.TarInfo("index.mjs")
            member.size = 0
            member.pax_headers = {"large-header": "x" * (consume.MAX_TAR_STREAM_BYTES + 1)}
            package.addfile(member)
        self.assertLess(archive.stat().st_size, consume.MAX_ARCHIVE_BYTES)
        with self.assertRaisesRegex(consume.VerificationError, "decompressed tar stream safety bound"):
            consume._read_archive(archive, self.lock)

    def test_changed_member_bytes_and_manifest_file_table_are_rejected(self):
        lock = json.loads(self.lock_path.read_text(encoding="utf-8"))
        contents = consume._read_archive(self.archive, lock)
        mutated = dict(contents)
        mutated["index.mjs"] += b"changed"
        mutated_archive = self.root / "mutated.tar.gz"
        with tarfile.open(mutated_archive, "w:gz") as package:
            for name, data in mutated.items():
                item = tarfile.TarInfo(name)
                item.size = len(data)
                package.addfile(item, io.BytesIO(data))
        with self.assertRaisesRegex(consume.VerificationError, "size does not match lock"):
            consume._read_archive(mutated_archive, lock)
        lock["files"].pop("GO-LICENSE.txt")
        with self.assertRaisesRegex(consume.VerificationError, "complete 11-file"):
            consume.validate_lock(lock)

    def test_emitted_dist_detects_changed_or_extra_files(self):
        destination = self.root / "dist/assets/recordsetcompare"
        with self.fake_online():
            consume.prepare(self.lock_path, destination)
        consume.verify_dist(self.lock_path, destination)
        (destination / "recordsetcompare-worker.js").write_text("changed", encoding="utf-8")
        with self.assertRaisesRegex(consume.VerificationError, "does not match its lock"):
            consume.verify_dist(self.lock_path, destination)
        (destination / "recordsetcompare-worker.js").write_bytes(
            _fixture_contents(self.lock)["recordsetcompare-worker.js"]
        )
        (destination / "extra.js").write_text("extra", encoding="utf-8")
        with self.assertRaisesRegex(consume.VerificationError, "exactly the locked 11 files"):
            consume.verify_dist(self.lock_path, destination)

    def test_missing_online_verifier_fails_closed(self):
        def no_network(_args, **_kwargs):
            raise consume.VerificationError("gh API unavailable")

        with patch.object(consume, "run_command", no_network), self.assertRaisesRegex(
            consume.VerificationError, "gh API unavailable"
        ):
            consume.prepare(self.lock_path, self.root / "output")


def _fixture_contents(lock: dict) -> dict[str, bytes]:
    # Recreate deterministic fixture package file payloads for a focused dist test.
    files = {
        name: f"test package bytes for {name}".encode()
        for name in consume.EXPECTED_FILES
        if name != "manifest.json"
    }
    files["manifest.json"] = json.dumps(
        {
            "abi": "recordsetcompare/1",
            "sourceCommit": SOURCE_COMMIT,
            "sourceTag": "v1.2.3",
            "files": {name: {"bytes": len(data), "sha256": _sha(data)} for name, data in files.items()},
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return files


if __name__ == "__main__":
    unittest.main()
