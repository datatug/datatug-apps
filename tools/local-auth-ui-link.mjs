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
import path from 'node:path';

const workspace = process.cwd();
const published = path.join(workspace, 'node_modules', '@sneat', 'auth-ui');
const backup = `${published}.wb-published`;
const local = path.resolve(
  workspace,
  '../../sneat-co/sneat-libs/dist/libs/auth/ui',
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
  const localPackage = path.join(local, 'package.json');
  if (!(await exists(localPackage))) {
    throw new Error(`Build the shared auth UI first; missing ${localPackage}`);
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
