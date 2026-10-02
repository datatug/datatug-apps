import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The repository root, found from wherever the test runner started (the workspace root or a project folder). */
export function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'tools/demo-bundle/pin.json'))) return dir;
    if (dirname(dir) === dir) throw new Error('repository root not found');
  }
}

export const demoDirOnDisk = (): string => join(repoRoot(), 'libs/datatug/main/src/lib/demo');
export const assetsDirOnDisk = (): string => join(repoRoot(), 'apps/datatug-app/src/assets/demo-data/ovdb');
