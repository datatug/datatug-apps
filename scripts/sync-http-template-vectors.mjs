#!/usr/bin/env node
// Copies the shared HTTP query parameter test vectors from DataTug Core so the
// TypeScript substituter (libs/datatug/main/src/lib/queries/http-template.ts)
// runs exactly the vectors the Go one does.
//
// Usage: node scripts/sync-http-template-vectors.mjs <path-to-datatug-core-checkout>
//    or: node scripts/sync-http-template-vectors.mjs --ref <git-ref>   (reads datatug/datatug-core through `gh api`)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = 'pkg/datatug/testdata/http_template_vectors.json';
const TARGET = 'libs/datatug/main/src/lib/queries/http-template-vectors.json';

const [arg, value] = process.argv.slice(2);
let text;
if (arg === '--ref') {
  const json = execFileSync('gh', ['api', `repos/datatug/datatug-core/contents/${SOURCE}?ref=${value ?? 'main'}`], { encoding: 'utf8' });
  text = Buffer.from(JSON.parse(json).content, 'base64').toString('utf8');
} else if (arg) {
  text = readFileSync(join(arg, SOURCE), 'utf8');
} else {
  console.error('usage: sync-http-template-vectors.mjs <datatug-core checkout> | --ref <git-ref>');
  process.exit(2);
}
JSON.parse(text); // refuse a corrupt copy
writeFileSync(TARGET, text);
console.log(`wrote ${TARGET}`);
