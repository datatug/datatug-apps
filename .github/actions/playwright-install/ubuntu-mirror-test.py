import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

spec = importlib.util.spec_from_file_location("mirror", Path(__file__).with_name("ubuntu-mirror.py"))
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)


class UbuntuMirrorTest(unittest.TestCase):
    def test_referenced_mirror_list_and_filesystem_boundary(self):
        with TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "apt"
            sources = root / "sources.list.d"
            sources.mkdir(parents=True)
            source = """Types: deb
URIs: mirror+file:/etc/apt/apt-mirrors.txt
Suites: noble noble-updates noble-security
Components: main universe
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
"""
            (sources / "ubuntu.sources").write_text(source)
            entries = """# http://azure.archive.ubuntu.com/ubuntu/ remains a comment
http://azure.archive.ubuntu.com/ubuntu/ priority:1 # keep options
https://security.ubuntu.com/ubuntu/ priority:2
https://azure.archive.ubuntu.com.example/ubuntu/
https://azure.archive.ubuntu.com/ubuntu/other
https://packages.microsoft.com/repos/code
"""
            target = root / "apt-mirrors.txt"
            target.write_text(entries)
            outside = base / "outside.txt"
            outside.write_text(entries)
            (root / "escape.txt").symlink_to(outside)
            (root / "unreferenced.txt").write_text(entries)
            (root / "sources.list").write_text("""# deb mirror+file:/etc/apt/unreferenced.txt noble main
deb mirror+file:/etc/apt/escape.txt noble main
deb mirror+file:/etc/apt/../outside.txt noble main
deb mirror+file:/tmp/outside.txt noble main
""")
            mirror.repair(root)
            self.assertEqual(target.read_text(), entries.replace(
                "http://azure.archive.ubuntu.com/ubuntu/ priority:1",
                "http://archive.ubuntu.com/ubuntu/ priority:1",
            ))
            self.assertEqual((sources / "ubuntu.sources").read_text(), source)
            self.assertEqual(outside.read_text(), entries)
            self.assertEqual((root / "unreferenced.txt").read_text(), entries)
            first = target.read_text()
            mirror.repair(root)
            self.assertEqual(target.read_text(), first)

    def test_noble_deb822_preserves_suites_signing_and_other_hosts(self):
        source = """Types: deb
URIs: http://azure.archive.ubuntu.com/ubuntu/
Suites: noble noble-updates noble-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: http://security.ubuntu.com/ubuntu/
Suites: noble-security
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
"""
        expected = source.replace("http://azure.archive.ubuntu.com/ubuntu/", "http://archive.ubuntu.com/ubuntu/")
        self.assertEqual(mirror.replace_mirror(source), expected)
        self.assertEqual(mirror.replace_mirror(expected), expected)

    def test_legacy_lists_options_comments_and_similarly_named_hosts(self):
        source = """# deb http://azure.archive.ubuntu.com/ubuntu noble main
deb [arch=amd64 signed-by=/keys/ubuntu.gpg] https://azure.archive.ubuntu.com/ubuntu noble-security main # azure mirror
deb-src http://azure.archive.ubuntu.com/ubuntu/ noble main
deb https://packages.microsoft.com/repos/code stable main
deb https://azure.archive.ubuntu.com.example/ubuntu noble main
"""
        expected = source.replace(
            "https://azure.archive.ubuntu.com/ubuntu noble-security",
            "https://archive.ubuntu.com/ubuntu noble-security",
        ).replace("deb-src http://azure.archive.ubuntu.com/ubuntu/", "deb-src http://archive.ubuntu.com/ubuntu/")
        self.assertEqual(mirror.replace_mirror(source), expected)


if __name__ == "__main__":
    unittest.main()
