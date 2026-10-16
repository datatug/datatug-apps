"""Keep private release authentication on every real application build path."""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
TOKEN_ENV = "GH_TOKEN: ${{ steps.core-artifact-token.outputs.token }}"


class PrivateCoreWorkflowTests(unittest.TestCase):
    def test_every_app_build_or_server_command_receives_core_read_token(self):
        count = 0
        for filename in ("ci.yml", "checkout-provider-test.yml"):
            workflow = (ROOT / ".github/workflows" / filename).read_text()
            for job in re.split(r"(?m)(?=^  [\w-]+:\n)", workflow):
                consumer_steps = []
                for step in re.split(r"(?m)(?=^      - )", job):
                    if re.search(r"(?:--target=(?:build|e2e)|datatug-app:(?:build|e2e)|tools/recordsetcompare/build_app\.py)", step):
                        consumer_steps.append(step)
                if not consumer_steps:
                    continue
                count += 1
                self.assertEqual(job.count("uses: ./.github/actions/private-core-artifact"), 1)
                self.assertLess(job.index("uses: ./.github/actions/private-core-artifact"), job.index("uses: ./.github/actions/pnpm"))
                for step in consumer_steps:
                    self.assertIn(TOKEN_ENV, step)
                # Normal job token remains available for public CLI release reads.
                for step in re.split(r"(?m)(?=^      - )", job):
                    if "gh release download" in step:
                        self.assertNotIn(TOKEN_ENV, step)
        self.assertEqual(count, 10)

    def test_artifact_action_requests_only_core_read_permissions(self):
        action = (ROOT / ".github/actions/private-core-artifact/action.yml").read_text()
        for required in ("client-id: Iv23li26w131Kv6u3IdM", "owner: datatug", "repositories: datatug-core", "permission-contents: read", "permission-attestations: read"):
            self.assertIn(required, action)
        self.assertNotIn("GITHUB_ENV", action)
        self.assertNotIn(": write", action)
        deploy = (ROOT / ".github/workflows/deploy.yml").read_text()
        self.assertIn("build-github-app-repositories: datatug-core", deploy)
        self.assertIn("BUILD_GITHUB_APP_PRIVATE_KEY: ${{ secrets.SneatReleaser }}", deploy)
        self.assertNotIn("build-github-auth: true", deploy)


if __name__ == "__main__":
    unittest.main()
