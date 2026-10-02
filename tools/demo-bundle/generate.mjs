#!/usr/bin/env node
/**
 * Demo bundle: the DataTug demo project's knowledge and data, as static files
 * built from ONE pinned commit of datatug/datatug-demo-projects (tools/demo-bundle/pin.json).
 *
 *   node tools/demo-bundle/generate.mjs            regenerate the bundle (writes files)
 *   node tools/demo-bundle/generate.mjs --check    offline: the committed bundle matches its own
 *                                                  hashes and the pin (what CI runs)
 *   node tools/demo-bundle/generate.mjs --check --source
 *                                                  also regenerate from the pinned commit and fail
 *                                                  on any difference (drift)
 *
 * Writes
 *   libs/datatug/main/src/lib/demo/bundle/demo-project.bundle.json   saved query, schema, entity
 *                                                                    mappings, attribution, hashes
 *   apps/datatug-app/src/assets/demo-data/ovdb/<database>/<collection>.json
 *                                                                    the rows the demo's three sources
 *                                                                    serve, as OVDB {key, data} records
 *
 * Sources are read with `git show <commit>:<path>` from a checkout of the demo project repo, so the
 * working tree and the checked-out branch never matter and nothing in that checkout is touched.
 * Find the checkout with DATATUG_DEMO_PROJECTS_DIR, else a `datatug-demo-projects` directory beside
 * (or under `datatug/` beside) any ancestor of this repository. The Chinook rows come from the pinned
 * Chinook SQLite file (CHINOOK_SQLITE, else a sibling `chinook-database` checkout); its SHA-256 must
 * equal the one in the demo project's fixtures/chinook/phase1-acceptance.json.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pin = JSON.parse(readFileSync(join(root, 'tools/demo-bundle/pin.json'), 'utf8')).demoProjects;
const bundlePath = 'libs/datatug/main/src/lib/demo/bundle/demo-project.bundle.json';
const dataDir = 'apps/datatug-app/src/assets/demo-data/ovdb';
const project = pin.project;
const queryId = 'sales/chinook-sales-per-capita';

const attribution = [
  {
    id: 'world-bank',
    what: 'Population, total (SP.POP.TOTL), World Development Indicators',
    text: 'Data (c) The World Bank, made available under Creative Commons Attribution 4.0 International (CC BY 4.0). Modified: only the most recent observation per country is kept, re-keyed by ISO 3166-1 alpha-2 code. The World Bank does not endorse this data or its changes.',
    license: 'CC BY 4.0',
    url: 'https://data.worldbank.org/indicator/SP.POP.TOTL',
  },
  {
    id: 'chinook',
    what: 'Chinook sample database (Invoice)',
    text: 'Copyright (c) 2008-2017 Luis Rocha, MIT license.',
    license: 'MIT',
    url: 'https://github.com/lerocha/chinook-database',
  },
  {
    id: 'geonames',
    what: 'Country reference data (ISO codes and names behind the alias table)',
    text: 'Country records derive from the GeoNames geographical database, (c) GeoNames, licensed under CC BY 4.0. Derived and modified; GeoNames does not endorse it.',
    license: 'CC BY 4.0',
    url: 'https://www.geonames.org/',
  },
];

function fail(message) {
  console.error(`demo-bundle: ${message}`);
  process.exit(1);
}

function ancestors() {
  const list = [];
  for (let dir = root; ; dir = dirname(dir)) {
    list.push(dir);
    if (dirname(dir) === dir) break;
  }
  return list;
}

function findDemoRepo() {
  const fromEnv = process.env['DATATUG_DEMO_PROJECTS_DIR'];
  if (fromEnv) return fromEnv;
  for (const dir of ancestors()) {
    for (const candidate of [join(dir, 'datatug-demo-projects'), join(dir, 'datatug', 'datatug-demo-projects')]) {
      if (existsSync(join(candidate, '.git'))) return candidate;
    }
  }
  return fail('no datatug-demo-projects checkout found; set DATATUG_DEMO_PROJECTS_DIR');
}

function git(repo, args, options = {}) {
  return execFileSync('git', ['-C', repo, ...args], { maxBuffer: 64 * 1024 * 1024, ...options });
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;

function readSource() {
  const repo = findDemoRepo();
  try {
    git(repo, ['cat-file', '-e', `${pin.commit}^{commit}`]);
  } catch {
    fail(`commit ${pin.commit} is not in ${repo}; run: git -C ${repo} fetch origin`);
  }
  const blobs = {};
  const show = (path) => {
    const full = `${project}/${path}`;
    blobs[full] = git(repo, ['rev-parse', `${pin.commit}:${full}`]).toString().trim();
    return git(repo, ['show', `${pin.commit}:${full}`]);
  };
  const list = (path) => git(repo, ['ls-tree', '--name-only', `${pin.commit}:${project}/${path}`]).toString().split('\n').filter(Boolean);
  return { show, list, blobs };
}

function chinookInvoiceRows(chinookPin, columns) {
  let file = process.env['CHINOOK_SQLITE'];
  if (!file) {
    for (const dir of ancestors()) {
      for (const base of [join(dir, 'chinook-database'), join(dir, 'datatug', 'chinook-database')]) {
        const candidate = join(base, chinookPin.path);
        if (existsSync(candidate)) { file = candidate; break; }
      }
      if (file) break;
    }
  }
  if (!file || !existsSync(file)) fail(`pinned Chinook SQLite not found (${chinookPin.repository} @ ${chinookPin.revision}, ${chinookPin.path}); set CHINOOK_SQLITE`);
  const actual = sha256(readFileSync(file));
  if (actual !== chinookPin.sha256) fail(`${file} has SHA-256 ${actual}, expected the pinned ${chinookPin.sha256}`);
  const script = [
    'import json, sqlite3, sys',
    'c = sqlite3.connect("file:%s?mode=ro" % sys.argv[1], uri=True)',
    'cols = sys.argv[2].split(",")',
    'rows = c.execute("select %s from Invoice order by InvoiceId" % ",".join(cols)).fetchall()',
    'print(json.dumps([dict(zip(cols, r)) for r in rows]))',
  ].join('\n');
  const out = execFileSync('python3', ['-c', script, file, columns.join(',')], { maxBuffer: 64 * 1024 * 1024 }).toString();
  return JSON.parse(out).map((row) => ({ key: String(row['InvoiceId']), data: row }));
}

function build() {
  const { show, list, blobs } = readSource();
  const json = (path) => JSON.parse(show(path).toString('utf8'));
  const chinookPin = json('fixtures/chinook/phase1-acceptance.json').database;
  const meta = json('queries/sales/chinook-sales-per-capita.query.json');
  const dtql = show('queries/sales/chinook-sales-per-capita.query.dtql').toString('utf8');

  const schema = {};
  for (const table of list('dbmodels/chinook/main/tables').sort()) {
    schema[table] = json(`dbmodels/chinook/main/tables/${table}/main.${table}.columns.json`).columns.map((column) => column.name);
  }
  const country = json('entities/Country/Country.entity.json');
  const entities = { Country: { fields: country.fields.map((field) => ({ id: field.id, mappings: field.mappings ?? [] })) } };

  const data = [];
  const files = {};
  const addSource = (database, name, records, columns, origin) => {
    const text = JSON.stringify(records);
    const file = `${database}/${name}.json`;
    files[`${dataDir}/${file}`] = text;
    data.push({ id: `${database}.${name}`, file, rows: records.length, columns, sha256: sha256(text), origin });
  };

  const invoiceTable = meta.federation.tables.find((table) => table.database === 'chinook' && table.name === 'Invoice');
  const invoiceColumns = ['InvoiceId', ...invoiceTable.fields.filter((field) => field !== 'InvoiceId')];
  addSource('chinook', 'Invoice', chinookInvoiceRows(chinookPin, invoiceColumns), invoiceColumns,
    `Chinook SQLite ${chinookPin.repository} @ ${chinookPin.revision} (sha256 ${chinookPin.sha256}); columns the saved query declares, key = InvoiceId as text`);
  for (const name of ['country_aliases', 'population_wb']) {
    const fields = meta.federation.tables.find((table) => table.database === 'geo' && table.name === name).fields;
    const records = list(`data/geo/${name}/$records`).filter((entry) => entry.endsWith('.json')).sort()
      .map((entry) => ({ key: entry.replace(/\.json$/, ''), data: JSON.parse(show(`data/geo/${name}/$records/${entry}`).toString('utf8')) }));
    const columns = [...new Set([...fields, ...Object.keys(records[0].data)])];
    addSource('geo', name, records, columns, `${project}/data/geo/${name}/$records/*.json @ ${pin.commit}`);
  }

  const bundle = {
    bundleVersion: 1,
    generatedBy: 'tools/demo-bundle/generate.mjs',
    pin: { repository: pin.repository, commit: pin.commit, project, chinook: chinookPin },
    attribution,
    schema: { chinook: schema },
    entities,
    queries: {
      [queryId]: {
        id: meta.id, title: meta.title, purpose: meta.purpose, dtql,
        federation: { ovdbBaseUrl: meta.federation.ovdbBaseUrl, tables: meta.federation.tables },
        recordsets: meta.recordsets,
      },
    },
    data,
    sourceBlobs: Object.fromEntries(Object.entries(blobs).sort(([a], [b]) => a.localeCompare(b))),
  };
  return { bundleText: pretty(bundle), files };
}

function write({ bundleText, files }) {
  const dir = join(root, dataDir);
  rmSync(dir, { recursive: true, force: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(dirname(join(root, bundlePath)), { recursive: true });
  writeFileSync(join(root, bundlePath), bundleText);
}

function checkOffline() {
  const problems = [];
  if (!existsSync(join(root, bundlePath))) return [`${bundlePath} is missing; run pnpm demo:bundle`];
  const bundle = JSON.parse(readFileSync(join(root, bundlePath), 'utf8'));
  if (bundle.pin?.commit !== pin.commit) problems.push(`bundle was built from ${bundle.pin?.commit}, pin.json says ${pin.commit}`);
  for (const source of bundle.data) {
    const path = join(root, dataDir, source.file);
    if (!existsSync(path)) { problems.push(`${dataDir}/${source.file} is missing`); continue; }
    const text = readFileSync(path, 'utf8');
    if (sha256(text) !== source.sha256) problems.push(`${dataDir}/${source.file} does not match the bundle's hash`);
    if (JSON.parse(text).length !== source.rows) problems.push(`${dataDir}/${source.file} has a different row count than the bundle says`);
  }
  const onDisk = new Set();
  for (const database of existsSync(join(root, dataDir)) ? readdirSync(join(root, dataDir)) : []) {
    for (const file of readdirSync(join(root, dataDir, database))) onDisk.add(`${database}/${file}`);
  }
  for (const file of onDisk) if (!bundle.data.some((source) => source.file === file)) problems.push(`${dataDir}/${file} is not listed in the bundle`);
  return problems;
}

function checkSource() {
  const built = build();
  const problems = [];
  const current = existsSync(join(root, bundlePath)) ? readFileSync(join(root, bundlePath), 'utf8') : '';
  if (current !== built.bundleText) problems.push(`${bundlePath} differs from a fresh build of ${pin.commit}`);
  for (const [path, text] of Object.entries(built.files)) {
    const have = existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : undefined;
    if (have !== text) problems.push(`${path} differs from a fresh build of ${pin.commit}`);
  }
  return problems;
}

const args = new Set(process.argv.slice(2));
if (args.has('--check')) {
  const problems = [...checkOffline(), ...(args.has('--source') ? checkSource() : [])];
  if (problems.length) fail(`drift:\n  - ${problems.join('\n  - ')}\nRun: pnpm demo:bundle`);
  console.log(`demo-bundle: ok (${pin.project} @ ${pin.commit.slice(0, 10)}${args.has('--source') ? ', rebuilt from source' : ', offline'})`);
} else {
  const built = build();
  write(built);
  console.log(`demo-bundle: wrote ${bundlePath} and ${Object.keys(built.files).length} data files from ${pin.commit.slice(0, 10)}`);
}
