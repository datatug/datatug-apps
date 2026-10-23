"""Switch only the slow GitHub Ubuntu Azure mirror after an install failure."""

from pathlib import Path
import re
import sys


def replace_mirror(text: str) -> str:
    lines = []
    for line in text.splitlines(keepends=True):
        # Keep comments, signing options, suites and non-Ubuntu repositories intact.
        if re.match(r"\s*(?:URIs:|deb(?:-src)?\s)", line):
            source, separator, comment = line.partition("#")
            source = re.sub(
                r"(https?://)azure\.archive\.ubuntu\.com(?=/ubuntu(?:/|\s|$))",
                r"\1archive.ubuntu.com",
                source,
            )
            line = source + separator + comment
        lines.append(line)
    return "".join(lines)


if __name__ == "__main__":
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "/etc/apt")
    files = [root / "sources.list"]
    files.extend((root / "sources.list.d").glob("*.list"))
    files.extend((root / "sources.list.d").glob("*.sources"))
    for path in files:
        if path.is_file():
            before = path.read_text()
            after = replace_mirror(before)
            if after != before:
                path.write_text(after)
                print(f"Ubuntu mirror fallback: {path}")
