#!/usr/bin/env python3
"""Build datatug-app and verify the exact emitted RecordsetCompare assets."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    build = subprocess.run(
        ["pnpm", "exec", "nx", "run", "datatug-app:build"],
        cwd=ROOT,
        check=False,
    )
    if build.returncode:
        return build.returncode
    verify = subprocess.run(
        [sys.executable, "tools/recordsetcompare/consume.py", "verify-dist"],
        cwd=ROOT,
        check=False,
    )
    return verify.returncode


if __name__ == "__main__":
    raise SystemExit(main())
