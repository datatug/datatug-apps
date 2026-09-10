import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('build-info.ts (as committed to git)', () => {
  it('keeps version, gitHash and buildTimestamp as placeholders in the committed blob', () => {
    // `sneat-stamp-build-info` (the `stamp-build-info` Nx target) never
    // touches this file — it stamps a gitignored copy,
    // `build-info.generated.ts`, that an Angular `fileReplacements` config
    // (apps/datatug-app/project.json) swaps in at build time. So reading
    // this file straight off disk here should always see the committed
    // placeholders regardless of build/serve ordering. Reading the
    // *committed* blob via `git show HEAD:...` anyway (rather than the
    // working copy) is a belt-and-braces check against exactly that
    // invariant — the same one @sneat/build-info's own README documents
    // for any consumer of the shared bin.
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

    expect(committed).toContain("version: 'version t0be$et'");
    expect(committed).toContain("gitHash: 'gitHash t0be$et'");
    expect(committed).toContain("buildTimestamp: 'timestamp t0be$et'");
  });
});
