import {
  cp,
  lstat,
  mkdir,
  readlink,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const workspace = process.cwd();
const published = path.join(workspace, 'node_modules', '@sneat', 'auth-ui');
const backup = `${published}.wb-published`;
const canonicalWorkspace = path.dirname(
  execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: workspace, encoding: 'utf8' },
  ).trim(),
);
const localCandidates = [
  process.env.SNEAT_AUTH_UI_DIST_DIR,
  path.resolve(workspace, '../../sneat-co/sneat-libs/dist/libs/auth/ui'),
  path.resolve(
    canonicalWorkspace,
    '../../sneat-co/sneat-libs/dist/libs/auth/ui',
  ),
].filter(Boolean);
const local = localCandidates.find((candidate) =>
  existsSync(path.join(candidate, 'package.json')),
);
const marker = path.join(published, '.wb-local-auth-ui');

async function exists(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function restore() {
  const current = await exists(published);
  if (
    current?.isSymbolicLink() &&
    path.resolve(path.dirname(published), await readlink(published)) === local
  ) {
    await unlink(published);
  } else if (await exists(marker)) {
    await rm(published, { recursive: true });
  }
  if (await exists(backup)) {
    if (await exists(published)) {
      throw new Error(`Refusing to overwrite unexpected ${published}`);
    }
    await rename(backup, published);
  }
}

async function link() {
  if (!local) {
    throw new Error(
      `Build the shared auth UI first; checked ${localCandidates.join(', ')}. Set SNEAT_AUTH_UI_DIST_DIR to override.`,
    );
  }
  await mkdir(path.dirname(published), { recursive: true });
  const current = await exists(published);
  if (await exists(marker)) {
    return;
  }
  if (await exists(backup)) {
    await restore();
  }
  if (await exists(published)) {
    await rename(published, backup);
  }
  try {
    // A copy intentionally lives under this workspace's node_modules so the
    // library's peer dependencies resolve from the consuming application.
    await cp(local, published, { recursive: true });
    await writeFile(marker, 'temporary local @sneat/auth-ui package\n');
  } catch (error) {
    await restore();
    throw error;
  }
}

switch (process.argv[2]) {
  case 'link':
    await link();
    break;
  case 'restore':
    await restore();
    break;
  default:
    throw new Error('usage: node tools/local-auth-ui-link.mjs <link|restore>');
}
