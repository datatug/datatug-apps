#!/usr/bin/env node
// Stamps the DataTug web app's build metadata (git hash + UTC build
// timestamp) ahead of an Angular build/serve, so the side-menu build-info
// panel (libs/datatug/main/src/lib/menu/build-info/) and the curl-able
// apps/datatug-app/src/build-info.json (copied to the build output root by
// datatug-app's `build` assets config, see project.json) both show the
// actual commit and build time instead of the placeholders committed to
// build-info.ts.
//
// Wired as an Nx dependency of datatug-app's `build` and `serve` targets
// (apps/datatug-app/project.json -> targets.build/serve.dependsOn), so this
// always runs automatically before either — no manual step. It is also run
// before `serve` (not just `build`) so the app's own e2e smoke test
// (apps/datatug-app/e2e/build-info.spec.ts), which runs against the dev
// server like every other spec in that project, sees real values too.
//
// Commit SHA source, in priority order:
//   1. WORKERS_CI_COMMIT_SHA  - injected by Cloudflare Workers Builds
//      (confirmed in Cloudflare's docs: "Access git commit sha and branch
//      name as environment variables in Workers Builds",
//      https://developers.cloudflare.com/changelog/post/2025-06-10-default-env-vars/
//      and https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#environment-variables)
//   2. CF_PAGES_COMMIT_SHA    - Cloudflare Pages' equivalent env var, kept
//      only as a defensive fallback in case this project is ever fronted by
//      Pages instead of a Workers Build (datatug.app currently uses
//      Workers Builds per wrangler.jsonc's `assets` config, not Pages)
//   3. `git rev-parse HEAD`   - GitHub Actions CI (actions/checkout leaves a
//      normal working tree) and local runs; also the final fallback if
//      Cloudflare ever stops injecting the var above
//
// The UTC build timestamp is `new Date().toISOString()` (no `date -u`
// subprocess) so it is identical and portable across GitHub Actions'
// ubuntu-latest runners, Cloudflare's build container, and a developer's
// own machine.
//
// This script never touches git history and never makes a commit; it only
// rewrites the two placeholder values in build-info.ts *in the working
// tree* and (re)writes build-info.json. Never `git add`/`git commit` after
// running it manually — the committed build-info.ts must keep its
// placeholders (see the TODO at the top of that file, and
// build-info.spec.ts's "keeps placeholders committed" test, which reads the
// *committed* blob via `git show HEAD:...` so a stamped working tree never
// fools it).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const BUILD_INFO_TS = path.join(
  repoRoot,
  'libs/datatug/main/src/lib/menu/build-info/build-info.ts',
);
const BUILD_INFO_JSON = path.join(
  repoRoot,
  'apps/datatug-app/src/build-info.json',
);

function resolveGitHash() {
  const fromCloudflare =
    process.env['WORKERS_CI_COMMIT_SHA'] ||
    process.env['CF_PAGES_COMMIT_SHA'];
  if (fromCloudflare) return fromCloudflare;
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

function readVersion() {
  const pkg = JSON.parse(
    readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
  );
  return pkg.version;
}

const gitHash = resolveGitHash();
const buildTimestamp = new Date().toISOString();
const version = readVersion();

// --- build-info.ts: in-place replacement ---
// `version` is a plain literal in build-info.ts (not a package.json import
// - see that file's header comment for why), so it is rewritten here too,
// same as gitHash/buildTimestamp; it just isn't part of the
// never-commit-a-real-value contract those two are (build-info.spec.ts
// only guards gitHash/buildTimestamp).
let ts = readFileSync(BUILD_INFO_TS, 'utf8');
const beforeTs = ts;
ts = ts.replace(/version:\s*'[^']*'/, `version: '${version}'`);
ts = ts.replace(/gitHash:\s*'[^']*'/, `gitHash: '${gitHash}'`);
ts = ts.replace(
  /buildTimestamp:\s*'[^']*'/,
  `buildTimestamp: '${buildTimestamp}'`,
);
if (ts === beforeTs) {
  throw new Error(
    `[stamp-build-info] version/gitHash/buildTimestamp fields not found in ${BUILD_INFO_TS} - did its shape change?`,
  );
}
writeFileSync(BUILD_INFO_TS, ts);

// --- build-info.json: static, curl-able asset (gitignored, never committed) ---
writeFileSync(
  BUILD_INFO_JSON,
  JSON.stringify({ version, gitHash, buildTimestamp }, null, 2) + '\n',
);

console.log(
  `[stamp-build-info] version=${version} gitHash=${gitHash.substring(0, 7)} buildTimestamp=${buildTimestamp}`,
);
