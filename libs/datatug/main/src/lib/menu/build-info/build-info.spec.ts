import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('build-info.ts (as committed to git)', () => {
  it('keeps gitHash and buildTimestamp as placeholders in the committed blob', () => {
    // tools/stamp-build-info.mjs rewrites gitHash/buildTimestamp *in the
    // working tree* before a build/serve (an Nx dependency of both
    // datatug-app targets), so reading this file straight off disk here
    // would be racy under `nx run-many -t lint,test,build` (the `test`
    // target has no dependsOn relationship to `build`, so ordering isn't
    // guaranteed). Reading the committed blob via `git show HEAD:...`
    // instead asserts what actually mirrors sneat-libs' build-info.ts TODO
    // intent: the *committed* file must never carry a real stamped value,
    // regardless of what a concurrent build already did to the working
    // copy.
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: __dirname,
      encoding: 'utf8',
    }).trim();
    const relPath = path
      .relative(repoRoot, path.join(__dirname, 'build-info.ts'))
      .split(path.sep)
      .join('/');

    let committed: string;
    try {
      committed = execFileSync('git', ['show', `HEAD:${relPath}`], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
    } catch (e) {
      throw new Error(
        `Could not read the committed blob for ${relPath} via ` +
          `'git show HEAD:...' (not committed yet?). Original error: ${
            (e as Error).message
          }`,
      );
    }

    expect(committed).toContain("gitHash: 'gitHash t0be$et'");
    expect(committed).toContain("buildTimestamp: 'timestamp t0be$et'");
  });
});
