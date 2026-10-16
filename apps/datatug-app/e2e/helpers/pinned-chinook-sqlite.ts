import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext } from '@playwright/test';

// This is the exact public artifact tracked by demo-db/chinook at 85ad3b4d.
// Browser execution still uses the real SQLite worker and its source admission.
export const CHINOOK_SQLITE_URL = 'https://chinook.demodb.dev/data/chinook.sqlite';
const BUNDLED_CHINOOK_URL = '/assets/showcase/chinook.sqlite';
const BUNDLED_RIGHTS_URL = '/assets/showcase/chinook-source-rights.json';
const CHINOOK_SQLITE_BYTES = 1_007_616;
const CHINOOK_SQLITE_SHA256 = '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15';
const CHINOOK_COMPARE_URL = 'https://chinook.demodb.dev/data/compare/3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f.sqlite';
const CHINOOK_COMPARE_SHA256 = '3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f';

function readPinnedFixture(name: string, size: number, sha256: string): Buffer {
  const bytes = readFileSync(join(__dirname, '../../src/assets/showcase', name));
  if (bytes.byteLength !== size || createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw new Error(`The checked-in ${name} fixture does not match its admitted digest.`);
  }
  return bytes;
}

export function loadPinnedChinookSqlite(demoRepo: string): Buffer {
  const catalog = JSON.parse(readFileSync(join(demoRepo, 'demo-project-1/connections/demo-db.json'), 'utf8')) as {
    connections: {
      id: string;
      fixtureSha256: string;
      browserFixture: {
        url: string;
        bytes: number;
        sourceRights: { url: string; bytes: number; sha256: string };
      };
    }[];
  };
  const connection = catalog.connections.find(({ id }) => id === 'chinook-sqlite');
  if (
    connection?.browserFixture.url !== BUNDLED_CHINOOK_URL ||
    connection.browserFixture.bytes !== CHINOOK_SQLITE_BYTES ||
    connection.fixtureSha256 !== CHINOOK_SQLITE_SHA256 ||
    connection.browserFixture.sourceRights?.url !== BUNDLED_RIGHTS_URL
  ) {
    throw new Error('The demo catalog no longer admits the pinned Chinook browser fixture.');
  }

  const rights = connection.browserFixture.sourceRights;
  readPinnedFixture('chinook-source-rights.json', rights.bytes, rights.sha256);

  return readPinnedFixture('chinook.sqlite', CHINOOK_SQLITE_BYTES, CHINOOK_SQLITE_SHA256);
}

async function servePinnedFixture(context: BrowserContext, url: string, bytes: Buffer): Promise<void> {
  await context.route(url, async (route) => {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'content-type': 'application/vnd.sqlite3',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (route.request().method() !== 'GET') {
      await route.abort();
      return;
    }
    await route.fulfill({ status: 200, headers, body: bytes });
  });
}

export async function installPinnedChinookSqlite(context: BrowserContext, demoRepo: string): Promise<void> {
  // Only the comparison baseline still names this public URL. The catalog's
  // relative application asset is deliberately served by the built app.
  await servePinnedFixture(context, CHINOOK_SQLITE_URL, loadPinnedChinookSqlite(demoRepo));
}

export async function installPinnedChinookComparison(context: BrowserContext): Promise<void> {
  await servePinnedFixture(
    context,
    CHINOOK_COMPARE_URL,
    readPinnedFixture(`chinook-candidate-${CHINOOK_COMPARE_SHA256}.sqlite`, CHINOOK_SQLITE_BYTES, CHINOOK_COMPARE_SHA256),
  );
}
