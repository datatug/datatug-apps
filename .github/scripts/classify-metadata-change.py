#!/usr/bin/env python3
"""Conservatively identify existing SpecScore status-only Git tree changes."""

import re
import subprocess
import sys


ARTIFACTS = (
    (re.compile(rb"spec/ideas/[A-Za-z0-9_-]+\.md\Z"), b"idea"),
    (re.compile(rb"spec/features/[A-Za-z0-9_-]+/README\.md\Z"), b"feature"),
    (re.compile(rb"spec/plans/[A-Za-z0-9_-]+\.md\Z"), b"plan"),
    (re.compile(rb"spec/plans/[A-Za-z0-9_-]+/README\.md\Z"), b"plan"),
)
INDEX = {b"spec/ideas/README.md": b"idea", b"spec/features/README.md": b"feature", b"spec/plans/README.md": b"plan"}
STATUS = re.compile(rb"[A-Za-z][A-Za-z0-9 -]*\Z")


def git(*args):
    return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL)


def normalize_document(data, kind):
    if b"\0" in data or not data.startswith(b"---\n"):
        return None
    lines = data.splitlines(keepends=True)
    try:
        end = next(i for i in range(1, len(lines)) if lines[i] == b"---\n")
    except StopIteration:
        return None
    expected_format = b"format: https://specscore.md/" + kind + b"-specification\n"
    if lines[1:end].count(expected_format) != 1:
        return None
    hits = [i for i in range(1, end) if lines[i].startswith(b"status: ")]
    if len(hits) != 1:
        return None
    i = hits[0]
    value = lines[i][len(b"status: "):].rstrip(b"\r\n")
    if not STATUS.fullmatch(value):
        return None
    lines[i] = b"status: <STATUS>\n"
    body_lines = lines[end + 1:]
    cursor = 0
    while cursor < len(body_lines) and not body_lines[cursor].strip():
        cursor += 1
    title = b"# " + kind.capitalize() + b":"
    if cursor == len(body_lines) or not body_lines[cursor].startswith(title):
        return None
    cursor += 1
    while cursor < len(body_lines) and not body_lines[cursor].strip():
        cursor += 1
    if cursor < len(body_lines) and body_lines[cursor].startswith(b"> [SpecScore.**Studio**](https://specscore.studio/"):
        cursor += 1
        while cursor < len(body_lines) and not body_lines[cursor].strip():
            cursor += 1
    if cursor == len(body_lines) or not body_lines[cursor].startswith(b"**Status:** "):
        return None
    value = body_lines[cursor][len(b"**Status:** "):].rstrip(b"\r\n")
    if not STATUS.fullmatch(value):
        return None
    body_lines[cursor] = b"**Status:** <STATUS>\n"
    return b"".join(lines[:end + 1] + body_lines)


def normalize_index(data, kind):
    expected_format = b"format: https://specscore.md/" + kind + b"s-index-specification\n"
    if b"\0" in data or not data.startswith(b"---\n"):
        return None
    lines = data.splitlines(keepends=True)
    if lines[1:4] != [expected_format, b"---\n", b"\n"]:
        return None
    section = b"## Contents" if kind == b"plan" else b"## Index"
    sections = [i for i, line in enumerate(lines) if line.rstrip(b"\r\n") == section]
    if len(sections) != 1:
        return None
    start = sections[0] + 1
    while start < len(lines) and not lines[start].strip():
        start += 1
    if start == len(lines) or not lines[start].startswith(b"|"):
        return None
    header_cells = lines[start].rstrip(b"\r\n").split(b"|")
    if len(header_cells) < 4 or header_cells[1].strip() != kind.capitalize() or header_cells[2].strip() != b"Status":
        return None
    changed_rows = 0
    for i in range(start + 1, len(lines)):
        line = lines[i]
        raw = line.rstrip(b"\r\n")
        if not raw.startswith(b"|"):
            break
        cells = raw.split(b"|")
        if len(cells) != len(header_cells) or cells[-1] != b"":
            return None
        if all(re.fullmatch(rb"[ :-]+", c) for c in cells[1:-1]):
            continue
        link = re.fullmatch(rb"\[[^]]+\]\(([^)]+)\)", cells[1].strip())
        target = link.group(1) if link else b""
        if kind == b"feature":
            target_pattern = rb"[A-Za-z0-9_-]+/README\.md"
        elif kind == b"plan":
            target_pattern = rb"[A-Za-z0-9_-]+(?:\.md|/README\.md)"
        else:
            target_pattern = rb"[A-Za-z0-9_-]+\.md"
        if not re.fullmatch(target_pattern, target):
            return None
        cell = cells[2]
        match = re.fullmatch(rb"( *)" + STATUS.pattern + rb"( *)", cell)
        if not match:
            return None
        cells[2] = match.group(1) + b"<STATUS>" + match.group(2)
        lines[i] = b"|".join(cells) + line[len(raw):]
        changed_rows += 1
    return b"".join(lines) if changed_rows else None


def classify(base, head):
    if not re.fullmatch(r"[0-9a-fA-F]{40}", base) or not re.fullmatch(r"[0-9a-fA-F]{40}", head) or base == head:
        return "invalid or empty revision range"
    try:
        if git("rev-parse", "--verify", f"{base}^{{commit}}").strip().decode() != base.lower():
            return "missing base commit"
        if git("rev-parse", "--verify", f"{head}^{{commit}}").strip().decode() != head.lower():
            return "missing head commit"
        if subprocess.run(["git", "merge-base", "--is-ancestor", base, head], check=False).returncode:
            return "base is not an ancestor of head"
        changes = git("diff", "--raw", "-z", "--no-ext-diff", "--no-renames", base, head).split(b"\0")
        if changes == [b""]:
            return "empty tree diff"
        if changes[-1] != b"":
            return "malformed diff"
        if (len(changes) - 1) % 2:
            return "malformed diff"
        for offset in range(0, len(changes) - 1, 2):
            raw, path = changes[offset:offset + 2]
            fields = raw.split()
            if len(fields) != 5 or fields[0] != b":100644" or fields[1] != b"100644" or fields[4] != b"M":
                return "non-regular, added, deleted, renamed, or mode change"
            artifact_kind = next((kind for pattern, kind in ARTIFACTS if pattern.fullmatch(path)), None)
            if path not in INDEX and artifact_kind is None:
                return "path is outside SpecScore status files"
            old = git("show", base + ":" + path.decode("ascii"))
            new = git("show", head + ":" + path.decode("ascii"))
            if path in INDEX:
                normalized_old = normalize_index(old, INDEX[path])
                normalized_new = normalize_index(new, INDEX[path])
            else:
                normalized_old = normalize_document(old, artifact_kind)
                normalized_new = normalize_document(new, artifact_kind)
            if normalized_old is None or normalized_new is None or normalized_old != normalized_new or old == new:
                return "content outside verified status slots changed"
        return None
    except (OSError, subprocess.CalledProcessError, UnicodeError, ValueError):
        return "Git revision or blob inspection failed"


if __name__ == "__main__":
    reason = classify(*sys.argv[1:]) if len(sys.argv) == 3 else "expected BASE and HEAD"
    print("metadata-only" if reason is None else f"full: {reason}")
