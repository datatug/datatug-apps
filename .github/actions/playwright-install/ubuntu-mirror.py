"""Switch only the slow GitHub Ubuntu Azure mirror after an install failure."""

from pathlib import Path
import re
import sys


def active_source(line: str) -> bool:
    return bool(re.match(r"\s*(?:URIs:|deb(?:-src)?\s)", line))


def replace_mirror(text: str, mirror_list: bool = False) -> str:
    lines = []
    for line in text.splitlines(keepends=True):
        # Keep comments, signing options, suites and non-Ubuntu repositories intact.
        if mirror_list or active_source(line):
            source, separator, comment = line.partition("#")
            source = re.sub(
                (r"^(\s*https?://)azure\.archive\.ubuntu\.com(?=/ubuntu/?(?:\s|$))"
                 if mirror_list else r"(https?://)azure\.archive\.ubuntu\.com(?=/ubuntu/?(?:\s|$))"),
                r"\1archive.ubuntu.com",
                source,
            )
            line = source + separator + comment
        lines.append(line)
    return "".join(lines)


def repair(root: Path) -> None:
    root = root.resolve()
    files = [root / "sources.list"]
    files.extend((root / "sources.list.d").glob("*.list"))
    files.extend((root / "sources.list.d").glob("*.sources"))
    mirrors = set()
    for path in files:
        if path.is_file() and path.resolve().is_relative_to(root):
            before = path.read_text()
            for line in before.splitlines():
                if not active_source(line):
                    continue
                source = line.partition("#")[0]
                for reference in re.findall(r"(?<!\S)mirror\+file:(/[^\s]+)", source):
                    # Resolve only references within /etc/apt, including symlinks.
                    # Map that prefix to root so the same filesystem boundary is testable.
                    try:
                        relative = Path(reference).relative_to("/etc/apt")
                    except ValueError:
                        continue
                    target = (root / relative).resolve()
                    if target.is_relative_to(root) and target.is_file():
                        mirrors.add(target)
            after = replace_mirror(before)
            if after != before:
                path.write_text(after)
                print(f"Ubuntu mirror fallback: {path}")
    for path in mirrors:
        before = path.read_text()
        after = replace_mirror(before, mirror_list=True)
        if after != before:
            path.write_text(after)
            print(f"Ubuntu mirror-list fallback: {path}")


if __name__ == "__main__":
    repair(Path(sys.argv[1] if len(sys.argv) > 1 else "/etc/apt"))
