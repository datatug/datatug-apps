import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("mirror", Path(__file__).with_name("ubuntu-mirror.py"))
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)


class UbuntuMirrorTest(unittest.TestCase):
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
