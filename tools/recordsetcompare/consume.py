#!/usr/bin/env python3
"""Verify and materialize the published RecordsetCompare browser package."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import queue
import shutil
import subprocess
import sys
import tarfile
import tempfile
from threading import Event, Thread
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


ROOT = Path(__file__).resolve().parents[2]
LOCK_PATH = ROOT / "apps/datatug-app/recordsetcompare-lock.json"
SOURCE_ASSET_DIR = ROOT / "apps/datatug-app/src/assets/recordsetcompare"
DIST_ASSET_DIR = ROOT / "dist/apps/datatug-app/browser/assets/recordsetcompare"
EXPECTED_FILES = frozenset(
    {
        "DATATUG-LICENSE.txt",
        "GO-LICENSE.txt",
        "THIRD-PARTY-NOTICES.md",
        "index.d.ts",
        "index.mjs",
        "manifest.json",
        "node-loader.mjs",
        "recordsetcompare-node-worker.mjs",
        "recordsetcompare-worker.js",
        "recordsetcompare.wasm",
        "wasm_exec.js",
    }
)
MAX_ARCHIVE_BYTES = 4 * 1024 * 1024
MAX_EXPANDED_BYTES = 8 * 1024 * 1024
MAX_TAR_STREAM_BYTES = MAX_EXPANDED_BYTES + 1024 * 1024
MAX_DOWNLOAD_CHUNK_BYTES = 64 * 1024
MAX_DOWNLOAD_REDIRECTS = 3
DOWNLOAD_TIMEOUT_SECONDS = 20
DOWNLOAD_WALL_TIMEOUT_SECONDS = 120
VERIFICATION_COMMAND_TIMEOUT_SECONDS = 120
ASSET_API_HOST = "api.github.com"
ASSET_REDIRECT_HOSTS = frozenset({"release-assets.githubusercontent.com", "objects.githubusercontent.com"})


class VerificationError(RuntimeError):
    """Raised when a release, archive, or emitted asset fails its lock."""


def run_command(args: list[str], *, cwd: Path = ROOT) -> str:
    """Run a verifier command without printing credentials or raw environment."""
    command_env = os.environ.copy()
    command_env["GH_HOST"] = "github.com"
    try:
        result = subprocess.run(
            args,
            cwd=cwd,
            check=False,
            capture_output=True,
            text=True,
            env=command_env,
            timeout=VERIFICATION_COMMAND_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as error:
        raise VerificationError(f"required verification command is unavailable: {args[0]}") from error
    except subprocess.TimeoutExpired as error:
        raise VerificationError(f"{args[0]} verification timed out") from error
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "command failed"
        raise VerificationError(f"{args[0]} verification failed: {detail[-1200:]}")
    return result.stdout


def load_lock(lock_path: Path = LOCK_PATH) -> dict[str, Any]:
    if lock_path.is_symlink():
        raise VerificationError("RecordsetCompare lock must not be a symlink")
    try:
        lock_path.resolve().relative_to(ROOT.resolve())
    except ValueError as error:
        raise VerificationError("RecordsetCompare lock must stay inside the Apps workspace") from error
    try:
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise VerificationError(f"cannot read RecordsetCompare lock: {error}") from error
    return validate_lock(lock)


def validate_lock(lock: Any) -> dict[str, Any]:
    if not isinstance(lock, dict) or lock.get("schemaVersion") != 1:
        raise VerificationError("unsupported or malformed RecordsetCompare lock")
    if lock.get("repository") != "datatug/datatug-core":
        raise VerificationError("lock repository is not the approved Core repository")
    if lock.get("sourceRef") != "refs/heads/main":
        raise VerificationError("lock source ref must be refs/heads/main")
    if lock.get("workflowPath") != ".github/workflows/golangci.yml":
        raise VerificationError("lock signer workflow path is not approved")
    expected_identity = (
        "https://github.com/datatug/datatug-core/"
        f"{lock['workflowPath']}@{lock['sourceRef']}"
    )
    if lock.get("workflowIdentity") != expected_identity:
        raise VerificationError("lock signer identity does not match the approved workflow and ref")
    if lock.get("issuer") != "https://token.actions.githubusercontent.com":
        raise VerificationError("lock OIDC issuer is not the GitHub Actions issuer")
    if lock.get("abi") != "recordsetcompare/1":
        raise VerificationError("unsupported RecordsetCompare ABI")
    for field in ("tag", "sourceCommit", "archiveName"):
        if not isinstance(lock.get(field), str) or not lock[field]:
            raise VerificationError(f"lock field {field} is missing")
    if not _is_sha256(lock.get("archiveSHA256")) or not _is_sha(lock.get("sourceCommit")):
        raise VerificationError("lock source or archive digest is malformed")
    if not isinstance(lock.get("archiveBytes"), int) or not 1 <= lock["archiveBytes"] <= MAX_ARCHIVE_BYTES:
        raise VerificationError("locked archive byte count is outside the safety bound")
    files = lock.get("files")
    if not isinstance(files, dict) or frozenset(files) != EXPECTED_FILES:
        raise VerificationError("lock must pin the complete 11-file released package")
    expanded = 0
    for name, metadata in files.items():
        if PurePosixPath(name).name != name or name in {".", ".."}:
            raise VerificationError(f"unsafe locked file name: {name!r}")
        if (
            not isinstance(metadata, dict)
            or not isinstance(metadata.get("bytes"), int)
            or metadata["bytes"] < 1
            or not _is_sha256(metadata.get("sha256"))
        ):
            raise VerificationError(f"invalid file pin for {name}")
        expanded += metadata["bytes"]
    if expanded > MAX_EXPANDED_BYTES:
        raise VerificationError("locked package exceeds the expanded-size safety bound")
    return lock


def _is_sha(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 40 and all(c in "0123456789abcdef" for c in value)


def _is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value)


def _tag_commit(lock: dict[str, Any]) -> str:
    """Resolve an annotated tag recursively and return its authoritative commit."""
    repo = lock["repository"]
    ref = json.loads(
        run_command(["gh", "api", f"repos/{repo}/git/ref/tags/{lock['tag']}"])
    )
    obj = ref.get("object") if isinstance(ref, dict) else None
    seen: set[str] = set()
    for _ in range(8):
        if not isinstance(obj, dict) or obj.get("type") not in {"tag", "commit"} or not _is_sha(obj.get("sha")):
            raise VerificationError("GitHub returned a malformed release tag object")
        sha = obj["sha"]
        if sha in seen:
            raise VerificationError("release tag contains a cycle")
        seen.add(sha)
        if obj["type"] == "commit":
            if sha != lock["sourceCommit"]:
                raise VerificationError("published release tag no longer peels to the locked source commit")
            return sha
        tag_object = json.loads(run_command(["gh", "api", f"repos/{repo}/git/tags/{sha}"]))
        obj = tag_object.get("object") if isinstance(tag_object, dict) else None
    raise VerificationError("release tag nesting exceeds the verification limit")


def _validate_release(lock: dict[str, Any]) -> dict[str, Any]:
    repo = lock["repository"]
    release = json.loads(run_command(["gh", "api", f"repos/{repo}/releases/tags/{lock['tag']}"]))
    if (
        not isinstance(release, dict)
        or release.get("tag_name") != lock["tag"]
        or release.get("draft") is not False
        or release.get("prerelease") is not False
    ):
        raise VerificationError("the locked release must exist as a published, non-prerelease release")
    assets = release.get("assets")
    if not isinstance(assets, list):
        raise VerificationError("GitHub release response has no asset list")
    matches = [asset for asset in assets if isinstance(asset, dict) and asset.get("name") == lock["archiveName"]]
    if len(matches) != 1:
        raise VerificationError("the release must contain exactly one asset with the locked archive name")
    asset = matches[0]
    asset_id = asset.get("id")
    if type(asset_id) is not int or asset_id < 1:
        raise VerificationError("GitHub release asset has an invalid numeric ID")
    if asset.get("state") != "uploaded" or asset.get("size") != lock["archiveBytes"]:
        raise VerificationError("GitHub release asset state or size does not match the locked archive")
    if asset.get("digest") not in (None, f"sha256:{lock['archiveSHA256']}"):
        raise VerificationError("GitHub release asset digest does not match the locked archive")
    expected_url = f"https://{ASSET_API_HOST}/repos/{repo}/releases/assets/{asset_id}"
    if asset.get("url") != expected_url:
        raise VerificationError("GitHub release asset API URL does not match its repository and ID")
    return {"id": asset_id, "url": expected_url}


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):  # type: ignore[no-untyped-def]
        return None


def _validated_asset_redirect(current_url: str, location: str | None) -> str:
    if not location:
        raise VerificationError("GitHub asset response omitted its redirect location")
    target = urljoin(current_url, location)
    parsed = urlsplit(target)
    try:
        port = parsed.port
    except ValueError as error:
        raise VerificationError("GitHub asset redirect has an invalid URL") from error
    if (
        parsed.scheme != "https"
        or parsed.hostname not in ASSET_REDIRECT_HOSTS
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or parsed.fragment
    ):
        raise VerificationError("GitHub asset redirect is not an allowlisted HTTPS download destination")
    return target


def _asset_token() -> str | None:
    return os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")


def _read_response_chunks(response, deadline: float, max_bytes: int):  # type: ignore[no-untyped-def]
    """Stream from urllib in a daemon reader so a continuously dripping peer cannot extend the total deadline."""
    chunks: queue.Queue[bytes | BaseException] = queue.Queue(maxsize=1)
    stopped = Event()
    bytes_read = 0

    def publish(item: bytes | BaseException) -> bool:
        while not stopped.is_set():
            try:
                chunks.put(item, timeout=0.1)
                return True
            except queue.Full:
                continue
        return False

    def read() -> None:
        bytes_read = 0
        try:
            while True:
                read_size = min(MAX_DOWNLOAD_CHUNK_BYTES, max_bytes - bytes_read + 1)
                chunk = response.read(read_size)
                if not publish(chunk) or not chunk:
                    return
                bytes_read += len(chunk)
        except BaseException as error:
            publish(error)

    reader = Thread(target=read, name="recordsetcompare-asset-reader", daemon=True)
    reader.start()
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                response.close()
                raise VerificationError("GitHub release asset exceeded its wall-clock download timeout")
            try:
                chunk = chunks.get(timeout=remaining)
            except queue.Empty as error:
                response.close()
                raise VerificationError("GitHub release asset exceeded its wall-clock download timeout") from error
            if isinstance(chunk, BaseException):
                raise chunk
            if not chunk:
                return
            yield chunk
    finally:
        stopped.set()


def _download_archive(lock: dict[str, Any], directory: Path, asset: dict[str, Any]) -> Path:
    archive = directory / lock["archiveName"]
    asset_id = asset.get("id")
    expected_url = f"https://{ASSET_API_HOST}/repos/{lock['repository']}/releases/assets/{asset_id}"
    if type(asset_id) is not int or asset_id < 1 or asset.get("url") != expected_url:
        raise VerificationError("refusing to download from an unverified GitHub release asset endpoint")
    headers = {
        "Accept": "application/octet-stream",
        "User-Agent": "datatug-recordsetcompare-artifact-verifier",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = _asset_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    current_url = asset["url"]
    response = None
    opener = build_opener(_NoRedirect())
    deadline = time.monotonic() + DOWNLOAD_WALL_TIMEOUT_SECONDS
    try:
        for redirect_count in range(MAX_DOWNLOAD_REDIRECTS + 1):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise VerificationError("GitHub release asset exceeded its wall-clock download timeout")
            request = Request(current_url, headers=headers, method="GET")
            try:
                response = opener.open(request, timeout=min(DOWNLOAD_TIMEOUT_SECONDS, remaining))
            except HTTPError as error:
                status = error.code
                location = error.headers.get("Location") if error.headers else None
                error.close()
                if status not in {301, 302, 303, 307, 308}:
                    hint = (
                        ". No GH_TOKEN or GITHUB_TOKEN environment credential is configured; "
                        "export one with release read access when the asset requires authentication. "
                        "This HTTP downloader does not inherit gh's stored login."
                        if status == 404 and not token and urlsplit(current_url).hostname == ASSET_API_HOST
                        else ""
                    )
                    raise VerificationError(f"GitHub release asset request failed with HTTP {status}{hint}") from None
                if redirect_count >= MAX_DOWNLOAD_REDIRECTS:
                    raise VerificationError("GitHub release asset exceeded the redirect limit") from None
                current_url = _validated_asset_redirect(current_url, location)
                # A signed CDN URL is a new origin. Never forward the API bearer token.
                headers.pop("Authorization", None)
                continue
            if response.getcode() != 200:
                raise VerificationError(f"GitHub release asset returned unexpected HTTP status {response.getcode()}")
            if urlsplit(current_url).hostname != ASSET_API_HOST and urlsplit(current_url).hostname not in ASSET_REDIRECT_HOSTS:
                raise VerificationError("GitHub release asset response came from an unapproved host")
            break
        else:
            raise VerificationError("GitHub release asset could not be fetched")

        content_length = response.headers.get("Content-Length") if response.headers else None
        if content_length is not None:
            try:
                announced_size = int(content_length)
            except (TypeError, ValueError) as error:
                raise VerificationError("GitHub release asset returned an invalid Content-Length") from error
            if announced_size != lock["archiveBytes"]:
                raise VerificationError("GitHub release asset Content-Length does not match the locked archive")
        digest = hashlib.sha256()
        total = 0
        with archive.open("xb") as output:
            for chunk in _read_response_chunks(response, deadline, lock["archiveBytes"]):
                # Read at most one byte past the pin so a missing Content-Length cannot bypass the cap.
                total += len(chunk)
                if total > lock["archiveBytes"] or total > MAX_ARCHIVE_BYTES:
                    raise VerificationError("GitHub release asset exceeded its locked byte count during download")
                output.write(chunk)
                digest.update(chunk)
        if total != lock["archiveBytes"] or digest.hexdigest() != lock["archiveSHA256"]:
            raise VerificationError("downloaded archive does not match its locked byte count and SHA-256")
    except VerificationError:
        archive.unlink(missing_ok=True)
        raise
    except (OSError, TimeoutError, URLError) as error:
        archive.unlink(missing_ok=True)
        timed_out = isinstance(error, TimeoutError) or (isinstance(error, URLError) and isinstance(error.reason, TimeoutError))
        reason = "timed out" if timed_out else "could not be fetched"
        raise VerificationError(f"GitHub release asset {reason}") from None
    finally:
        if response is not None:
            response.close()
    return archive


def _validate_attestation(lock: dict[str, Any], archive: Path) -> None:
    result = json.loads(
        run_command(
            [
                "gh",
                "attestation",
                "verify",
                str(archive),
                "--repo",
                lock["repository"],
                "--format",
                "json",
                "--cert-identity",
                lock["workflowIdentity"],
                "--cert-oidc-issuer",
                lock["issuer"],
                "--source-digest",
                lock["sourceCommit"],
                "--source-ref",
                lock["sourceRef"],
                "--signer-digest",
                lock["sourceCommit"],
                "--deny-self-hosted-runners",
            ]
        )
    )
    if not isinstance(result, list) or len(result) != 1:
        raise VerificationError("expected exactly one verified Core artifact attestation")
    verified = result[0].get("verificationResult") if isinstance(result[0], dict) else None
    if not isinstance(verified, dict):
        raise VerificationError("GitHub attestation verifier returned no verification result")
    certificate = ((verified.get("signature") or {}).get("certificate"))
    if not isinstance(certificate, dict):
        raise VerificationError("verified attestation has no signed certificate identity")
    expected_certificate = {
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
    for field, expected in expected_certificate.items():
        if certificate.get(field) != expected:
            raise VerificationError(f"verified attestation certificate has unexpected {field}")
    statement = verified.get("statement")
    subjects = statement.get("subject") if isinstance(statement, dict) else None
    if not isinstance(subjects, list) or len(subjects) != 1:
        raise VerificationError("verified attestation must bind exactly one archive subject")
    subject = subjects[0]
    digest = subject.get("digest") if isinstance(subject, dict) else None
    if subject.get("name") != lock["archiveName"] or not isinstance(digest, dict) or digest.get("sha256") != lock["archiveSHA256"]:
        raise VerificationError("verified attestation subject does not match the locked archive")
    if statement.get("predicateType") != "https://slsa.dev/provenance/v1":
        raise VerificationError("verified attestation does not use the SLSA provenance predicate")


def _file_fingerprint(path: Path, max_bytes: int) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            if size > max_bytes:
                raise VerificationError(f"file exceeds the {max_bytes}-byte verification bound")
            digest.update(chunk)
    return size, digest.hexdigest()


class _BoundedReader:
    """Cap decompressed tar bytes, including headers, before tarfile buffers them."""

    def __init__(self, stream, max_bytes: int):  # type: ignore[no-untyped-def]
        self._stream = stream
        self._max_bytes = max_bytes
        self._read_bytes = 0

    def read(self, size: int = -1) -> bytes:
        if size == 0:
            return b""
        remaining = self._max_bytes - self._read_bytes
        requested = remaining + 1 if size < 0 else min(size, remaining + 1)
        data = self._stream.read(requested)
        self._read_bytes += len(data)
        if self._read_bytes > self._max_bytes:
            raise VerificationError("archive exceeds the decompressed tar stream safety bound")
        return data


def _read_archive(archive: Path, lock: dict[str, Any]) -> dict[str, bytes]:
    contents: dict[str, bytes] = {}
    expanded = 0
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size > MAX_ARCHIVE_BYTES:
        raise VerificationError("release archive is missing, unsafe, or exceeds the compressed-size safety bound")
    try:
        with archive.open("rb") as compressed, gzip.GzipFile(fileobj=compressed, mode="rb") as decompressed:
            bounded = _BoundedReader(decompressed, MAX_TAR_STREAM_BYTES)
            with tarfile.open(fileobj=bounded, mode="r|") as package:
                for member_count, member in enumerate(package, start=1):
                    if member_count > len(EXPECTED_FILES):
                        raise VerificationError("archive contains more than the 11 allowed members")
                    path = PurePosixPath(member.name)
                    if path.is_absolute() or len(path.parts) != 1 or path.name in {".", ".."}:
                        raise VerificationError(f"unsafe archive path: {member.name!r}")
                    name = path.name
                    if name not in lock["files"] or name in contents:
                        raise VerificationError(f"unexpected or duplicate archive member: {name}")
                    if not member.isfile() or member.issym() or member.islnk() or member.size != lock["files"][name]["bytes"]:
                        raise VerificationError(f"archive member type or size does not match lock: {name}")
                    expanded += member.size
                    if expanded > MAX_EXPANDED_BYTES:
                        raise VerificationError("archive exceeds the expanded-size safety bound")
                    stream = package.extractfile(member)
                    if stream is None:
                        raise VerificationError(f"cannot read archive member {name}")
                    data = stream.read(member.size + 1)
                    if len(data) != member.size:
                        raise VerificationError(f"archive member length changed while reading: {name}")
                    metadata = lock["files"][name]
                    if hashlib.sha256(data).hexdigest() != metadata["sha256"]:
                        raise VerificationError(f"archive member does not match the locked SHA-256: {name}")
                    contents[name] = data
    except (OSError, tarfile.TarError) as error:
        raise VerificationError(f"cannot safely read the release archive: {error}") from error
    if frozenset(contents) != EXPECTED_FILES:
        raise VerificationError("archive is missing one or more of the 11 locked release files")
    _validate_manifest(contents, lock)
    return contents


def _validate_manifest(contents: dict[str, bytes], lock: dict[str, Any]) -> None:
    try:
        manifest = json.loads(contents["manifest.json"])
    except (KeyError, json.JSONDecodeError) as error:
        raise VerificationError("release manifest is malformed") from error
    if manifest.get("abi") != lock["abi"] or manifest.get("sourceCommit") != lock["sourceCommit"] or manifest.get("sourceTag") != lock["tag"]:
        raise VerificationError("release manifest does not describe the locked ABI, tag, and source")
    manifest_files = manifest.get("files")
    if not isinstance(manifest_files, dict):
        raise VerificationError("release manifest file table is malformed")
    expected_manifest_files = {name: metadata for name, metadata in lock["files"].items() if name != "manifest.json"}
    if manifest_files != expected_manifest_files:
        raise VerificationError("release manifest file table does not match the independent lock")


def _replace_directory_atomically(stage: Path, destination: Path) -> None:
    if destination.is_symlink():
        raise VerificationError("refusing to replace a generated asset symlink")
    backup = destination.with_name(f".{destination.name}.previous-{os.getpid()}")
    if backup.exists() or backup.is_symlink():
        raise VerificationError("a previous atomic-materialization backup already exists")
    moved_old = False
    try:
        if destination.exists():
            if not destination.is_dir():
                raise VerificationError("generated asset destination is not a directory")
            os.replace(destination, backup)
            moved_old = True
        os.replace(stage, destination)
    except OSError:
        if moved_old and not destination.exists():
            os.replace(backup, destination)
        raise
    if moved_old:
        shutil.rmtree(backup)


def prepare(lock_path: Path = LOCK_PATH, destination: Path = SOURCE_ASSET_DIR) -> None:
    lock = load_lock(lock_path)
    asset = _validate_release(lock)
    peeled = _tag_commit(lock)
    if peeled != lock["sourceCommit"]:
        raise VerificationError("release tag changed during verification")
    parent = destination.parent
    try:
        parent.resolve().relative_to(ROOT.resolve())
    except ValueError as error:
        raise VerificationError("generated asset destination must stay inside the Apps workspace") from error
    parent.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink():
        raise VerificationError("refusing to write generated assets through a symlink")
    if destination.exists() and not destination.is_dir():
        raise VerificationError("generated asset destination is not a directory")
    with tempfile.TemporaryDirectory(prefix="recordsetcompare-download-") as download_dir:
        download = Path(download_dir)
        archive = _download_archive(lock, download, asset)
        _validate_attestation(lock, archive)
        if _tag_commit(lock) != lock["sourceCommit"]:
            raise VerificationError("release tag moved during artifact verification")
        size, digest = _file_fingerprint(archive, MAX_ARCHIVE_BYTES)
        if size != lock["archiveBytes"] or digest != lock["archiveSHA256"]:
            raise VerificationError("archive bytes changed between download and extraction")
        contents = _read_archive(archive, lock)
        stage = Path(tempfile.mkdtemp(prefix=".recordsetcompare-stage-", dir=parent))
        try:
            for name, data in contents.items():
                output = stage / name
                output.write_bytes(data)
                output.chmod(0o644)
            verify_tree(stage, lock)
            _replace_directory_atomically(stage, destination)
        finally:
            if stage.exists():
                shutil.rmtree(stage)
    print(f"Verified Core {lock['tag']} ({lock['sourceCommit']}) and materialized 11 pinned files.")


def verify_tree(directory: Path, lock: dict[str, Any]) -> None:
    if directory.is_symlink() or not directory.is_dir():
        raise VerificationError(f"asset directory is missing or unsafe: {directory}")
    entries = list(directory.iterdir())
    if any(entry.is_symlink() or not entry.is_file() for entry in entries):
        raise VerificationError(f"asset directory contains a symlink or non-file entry: {directory}")
    if frozenset(entry.name for entry in entries) != EXPECTED_FILES:
        raise VerificationError(f"asset directory does not contain exactly the locked 11 files: {directory}")
    for name, metadata in lock["files"].items():
        size, digest = _file_fingerprint(directory / name, metadata["bytes"])
        if size != metadata["bytes"] or digest != metadata["sha256"]:
            raise VerificationError(f"materialized or emitted asset does not match its lock: {name}")


def verify_dist(lock_path: Path = LOCK_PATH, dist_path: Path = DIST_ASSET_DIR) -> None:
    lock = load_lock(lock_path)
    verify_tree(dist_path, lock)
    print("Emitted browser RecordsetCompare assets match the verified 11-file lock.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare_parser = subparsers.add_parser("prepare", help="online-verify and materialize the locked release")
    prepare_parser.add_argument("--lock", type=Path, default=LOCK_PATH)
    prepare_parser.add_argument("--destination", type=Path, default=SOURCE_ASSET_DIR)
    dist_parser = subparsers.add_parser("verify-dist", help="verify emitted browser assets after build/cache restore")
    dist_parser.add_argument("--lock", type=Path, default=LOCK_PATH)
    dist_parser.add_argument("--dist", type=Path, default=DIST_ASSET_DIR)
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            prepare(args.lock, args.destination)
        else:
            verify_dist(args.lock, args.dist)
    except VerificationError as error:
        print(f"recordsetcompare artifact verification failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
