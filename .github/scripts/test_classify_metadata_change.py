"""Git fixture tests for the metadata-only CI fast path."""

import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("classifier", Path(__file__).with_name("classify-metadata-change.py"))
classifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(classifier)


class ClassificationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, self.previous)
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.write("spec/plans/example.md", "---\nformat: https://specscore.md/plan-specification\nstatus: Draft\n---\n# Plan: Example\n\n**Status:** Draft\n\nProse.\n")
        self.write("spec/plans/README.md", "---\nformat: https://specscore.md/plans-index-specification\n---\n\n# Plans\n\n## Contents\n\n| Plan | Status | Owner |\n| --- | --- | --- |\n| [example](example.md) | Draft | alex |\n")
        self.base = self.commit()

    def git(self, *args):
        return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL).decode().strip()

    def write(self, path, data):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(data)

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD")

    def result(self):
        return classifier.classify(self.base, self.commit())

    def test_status_and_corresponding_index_are_eligible(self):
        self.write("spec/plans/example.md", "---\nformat: https://specscore.md/plan-specification\nstatus: Approved\n---\n# Plan: Example\n\n**Status:** Approved\n\nProse.\n")
        self.write("spec/plans/README.md", "---\nformat: https://specscore.md/plans-index-specification\n---\n\n# Plans\n\n## Contents\n\n| Plan | Status | Owner |\n| --- | --- | --- |\n| [example](example.md) | Approved | alex |\n")
        self.assertIsNone(self.result())

    def test_nested_plan_readme_and_index_link_are_eligible(self):
        self.write("spec/plans/nested/README.md", "---\nformat: https://specscore.md/plan-specification\nstatus: Draft\n---\n# Plan: Nested\n\n**Status:** Draft\n")
        self.write("spec/plans/README.md", "---\nformat: https://specscore.md/plans-index-specification\n---\n\n# Plans\n\n## Contents\n\n| Plan | Status | Owner |\n| --- | --- | --- |\n| [nested](nested/README.md) | Draft | alex |\n")
        self.base = self.commit()
        self.write("spec/plans/nested/README.md", "---\nformat: https://specscore.md/plan-specification\nstatus: Approved\n---\n# Plan: Nested\n\n**Status:** Approved\n")
        self.write("spec/plans/README.md", "---\nformat: https://specscore.md/plans-index-specification\n---\n\n# Plans\n\n## Contents\n\n| Plan | Status | Owner |\n| --- | --- | --- |\n| [nested](nested/README.md) | Approved | alex |\n")
        self.assertIsNone(self.result())

    def test_later_task_status_is_not_masked_but_top_status_can_change(self):
        self.write("spec/plans/example.md", "---\nformat: https://specscore.md/plan-specification\nstatus: Draft\n---\n# Plan: Example\n\n**Status:** Draft\n\n## Tasks\n\n**Status:** queued\n")
        self.base = self.commit()
        self.write("spec/plans/example.md", "---\nformat: https://specscore.md/plan-specification\nstatus: Approved\n---\n# Plan: Example\n\n**Status:** Approved\n\n## Tasks\n\n**Status:** queued\n")
        self.assertIsNone(self.result())

    def test_later_task_status_change_is_full(self):
        self.write("spec/plans/example.md", "---\nformat: https://specscore.md/plan-specification\nstatus: Draft\n---\n# Plan: Example\n\n**Status:** Draft\n\n## Tasks\n\n**Status:** complete\n")
        self.assertIsNotNone(self.result())

    def test_prose_or_source_mixed_with_status_is_full(self):
        self.write("spec/plans/example.md", "---\nformat: https://specscore.md/plan-specification\nstatus: Approved\n---\n# Plan: Example\n\n**Status:** Approved\n\nChanged prose.\n")
        self.assertIsNotNone(self.result())

    def test_index_other_column_change_is_full(self):
        self.write("spec/plans/README.md", "---\nformat: https://specscore.md/plans-index-specification\n---\n\n# Plans\n\n## Contents\n\n| Plan | Status | Owner |\n| --- | --- | --- |\n| [example](example.md) | Approved | somebody else |\n")
        self.assertIsNotNone(self.result())

    def test_appended_fake_status_table_is_full(self):
        self.write("spec/plans/README.md", "---\nformat: https://specscore.md/plans-index-specification\n---\n\n# Plans\n\n## Contents\n\n| Plan | Status | Owner |\n| --- | --- | --- |\n| [example](example.md) | Draft | alex |\n\n## Example\n\n| Plan | Status | Owner |\n| --- | --- | --- |\n| [fake](fake.md) | Approved | alex |\n")
        self.assertIsNotNone(self.result())

    def test_unlinked_row_in_lifecycle_table_is_full(self):
        self.write("spec/plans/README.md", "---\nformat: https://specscore.md/plans-index-specification\n---\n\n# Plans\n\n## Contents\n\n| Plan | Status | Owner |\n| --- | --- | --- |\n| example | Approved | alex |\n")
        self.assertIsNotNone(self.result())

    def test_cumulative_range_detects_intervening_code_change(self):
        self.write("src/app.ts", "export const changed = true;\n")
        self.commit()
        self.write("spec/plans/example.md", "---\nformat: https://specscore.md/plan-specification\nstatus: Approved\n---\n# Plan: Example\n\n**Status:** Approved\n\nProse.\n")
        self.assertIsNotNone(self.result())

    def test_non_spec_markdown_is_full(self):
        self.write("docs/example.md", "Status: Approved\n")
        self.assertIsNotNone(self.result())

    def test_noncanonical_nested_spec_markdown_is_full(self):
        self.write("spec/plans/nested/example.md", "---\nformat: https://specscore.md/plan-specification\nstatus: Approved\n---\n# Plan: Nested\n\n**Status:** Approved\n")
        self.assertIsNotNone(self.result())

    def test_noncanonical_frontmatter_format_is_full(self):
        self.write("spec/plans/example.md", "---\nformat: example\nstatus: Approved\n---\n# Plan: Example\n\n**Status:** Approved\n")
        self.assertIsNotNone(self.result())

    def test_added_and_deleted_files_are_full(self):
        self.write("spec/plans/added.md", "---\nstatus: Draft\n---\n")
        self.assertIsNotNone(self.result())

    def test_mode_change_is_full(self):
        (self.root / "spec/plans/example.md").chmod(0o755)
        self.assertIsNotNone(self.result())

    def test_symlink_replacement_is_full(self):
        (self.root / "spec/plans/example.md").unlink()
        (self.root / "spec/plans/example.md").symlink_to("README.md")
        self.assertIsNotNone(self.result())

    def test_rename_is_full(self):
        self.git("mv", "spec/plans/example.md", "spec/plans/renamed.md")
        self.assertIsNotNone(self.result())

    def test_hostile_filename_is_full(self):
        self.write("spec/plans/odd\nname.md", "---\nstatus: Draft\n---\n")
        self.assertIsNotNone(self.result())

    def test_empty_and_missing_ranges_are_full(self):
        self.assertIsNotNone(classifier.classify(self.base, self.base))
        self.assertIsNotNone(classifier.classify("0" * 40, self.base))

    def test_binary_is_full(self):
        (self.root / "spec/plans/example.md").write_bytes(b"---\nstatus: Approved\n---\n\0")
        self.assertIsNotNone(self.result())

    def test_duplicate_status_is_full(self):
        self.write("spec/plans/example.md", "---\nformat: https://specscore.md/plan-specification\nstatus: Draft\nstatus: Approved\n---\n# Plan: Example\n\n**Status:** Approved\n\nProse.\n")
        self.assertIsNotNone(self.result())

    def test_status_in_prose_section_is_full(self):
        self.write("spec/plans/example.md", "---\nformat: https://specscore.md/plan-specification\nstatus: Draft\n---\n# Plan: Example\n\n## Notes\n\n**Status:** Approved\n\nProse.\n")
        self.assertIsNotNone(self.result())


if __name__ == "__main__":
    unittest.main()
