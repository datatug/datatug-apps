#!/usr/bin/env node
/**
 * check-card-headers.mjs
 *
 * Rule (AGENTS.md, "Card headers"): every `<ion-card>` starts with exactly one
 * header row, `<ion-item-divider color="light">` (title in `ion-label`,
 * actions in `slot="end"`). Never a bare `ion-card-header`, never a
 * header-less card. The only exception: an error card, `<ion-card
 * color="danger">`, whose divider is `color="danger"`.
 *
 * The check parses every `*.component.html` under libs/ and apps/ with
 * Angular's own template parser (`@angular/compiler`, already a dependency),
 * so `@if`/`@for`/`@switch`/`@defer` blocks and `<ng-template>` are real
 * nodes, not text. A card passes when the first non-text node in it is the
 * divider; when that node is a control-flow block, the first element of EVERY
 * branch must be the divider. No regex over the markup.
 *
 * Allowlist: tools/card-header-allowlist.txt, lines `<repo-relative path>: <N>`
 * where N is the number of violating cards in that file. The list may only
 * shrink: the check fails when a file has MORE violations than listed (a new
 * violation), and when it has FEWER (a stale entry: lower or delete it).
 *
 * `--print-allowlist` prints the current counts in allowlist format (to audit
 * or shrink the list; never to grow it).
 *
 * Exit code: 0 when clean, 1 otherwise.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTemplate } from '@angular/compiler';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const allowlistPath = join(__dirname, 'card-header-allowlist.txt');
const SCAN_ROOTS = ['libs', 'apps'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', '.nx', '.git']);

const nodeType = (n) => n?.constructor?.name;

/** Static value of attribute `name`, or undefined. Bound inputs do not count. */
function staticAttr(el, name) {
  return el.attributes.find((a) => a.name === name)?.value;
}

/** Child lists of a control-flow block or ng-template ([] for a plain node). */
function branchesOf(node) {
  switch (nodeType(node)) {
    case 'IfBlock':
      return node.branches.map((b) => b.children);
    case 'ForLoopBlock':
      // An @empty branch replaces the loop body, so it needs a header too only
      // if the loop itself renders the first row; check the body only.
      return [node.children];
    case 'SwitchBlock':
      return node.groups.map((g) => g.children);
    case 'DeferredBlock':
      return [node.children];
    case 'Template':
      return [node.children];
    default:
      return null;
  }
}

/** Is the first meaningful node of `children` a valid header (or blocks of them)? */
function startsWithHeader(children, isDangerCard) {
  const first = children.find((n) => {
    const t = nodeType(n);
    if (t === 'Text') return n.value.trim() !== '';
    return t !== 'Comment';
  });
  if (!first) return false;
  const branches = branchesOf(first);
  if (branches) {
    return (
      branches.length > 0 &&
      branches.every((b) => startsWithHeader(b, isDangerCard))
    );
  }
  if (nodeType(first) !== 'Element' || first.name !== 'ion-item-divider')
    return false;
  const color = staticAttr(first, 'color');
  return color === 'light' || (isDangerCard && color === 'danger');
}

function collectCards(nodes, out) {
  for (const n of nodes) {
    if (nodeType(n) === 'Element' && n.name === 'ion-card') out.push(n);
    const kids = [];
    const b = branchesOf(n);
    if (b) kids.push(...b);
    else if (Array.isArray(n.children)) kids.push(n.children);
    if (nodeType(n) === 'ForLoopBlock' && n.empty) kids.push(n.empty.children);
    if (nodeType(n) === 'DeferredBlock') {
      for (const s of [n.placeholder, n.loading, n.error])
        if (s) kids.push(s.children);
    }
    for (const k of kids) collectCards(k, out);
  }
}

/**
 * @param {string} html template source
 * @returns {{ violations: {line:number, reason:string}[], parseErrors: string[] }}
 */
export function findViolations(html, fileName = 'fixture.component.html') {
  const { nodes, errors } = parseTemplate(html, fileName, {
    preserveWhitespaces: true,
  });
  const cards = [];
  collectCards(nodes, cards);
  const violations = [];
  for (const card of cards) {
    const isDangerCard = staticAttr(card, 'color') === 'danger';
    if (startsWithHeader(card.children, isDangerCard)) continue;
    const first = card.children.find((n) => nodeType(n) === 'Element');
    const reason =
      first?.name === 'ion-card-header'
        ? 'bare <ion-card-header>; use <ion-item-divider color="light">'
        : 'first child is not <ion-item-divider color="light">';
    violations.push({ line: card.sourceSpan.start.line + 1, reason });
  }
  return { violations, parseErrors: (errors ?? []).map((e) => e.msg) };
}

/** Parses allowlist text into Map<path, count>. */
export function parseAllowlist(text) {
  const map = new Map();
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.lastIndexOf(':');
    map.set(l.slice(0, i).trim(), Number(l.slice(i + 1)));
  }
  return map;
}

/** Compares per-file counts with the allowlist. Returns failure messages. */
export function compare(counts, allow) {
  const problems = [];
  for (const [file, n] of counts) {
    const allowed = allow.get(file) ?? 0;
    if (n > allowed)
      problems.push(
        `NEW violation: ${file} has ${n} card(s) without a valid header (allowlisted: ${allowed})`,
      );
  }
  for (const [file, allowed] of allow) {
    const n = counts.get(file) ?? 0;
    if (n < allowed)
      problems.push(
        `STALE allowlist entry: ${file} lists ${allowed} but has ${n}; lower or delete it in tools/card-header-allowlist.txt`,
      );
  }
  return problems;
}

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.component.html')) out.push(p);
  }
}

function main() {
  const files = [];
  for (const r of SCAN_ROOTS) walk(join(repoRoot, r), files);
  files.sort();
  const counts = new Map();
  const details = new Map();
  const failures = [];
  for (const f of files) {
    const rel = relative(repoRoot, f).split('\\').join('/');
    const { violations, parseErrors } = findViolations(
      readFileSync(f, 'utf8'),
      rel,
    );
    if (parseErrors.length)
      failures.push(`PARSE error in ${rel}: ${parseErrors[0]}`);
    if (violations.length) {
      counts.set(rel, violations.length);
      details.set(rel, violations);
    }
  }
  if (process.argv.includes('--print-allowlist')) {
    for (const [file, n] of counts) console.log(`${file}: ${n}`);
    return;
  }
  const allow = existsSync(allowlistPath)
    ? parseAllowlist(readFileSync(allowlistPath, 'utf8'))
    : new Map();
  const problems = [...failures, ...compare(counts, allow)];
  for (const p of problems) console.error(p);
  for (const [file, vs] of details) {
    if ((allow.get(file) ?? 0) < vs.length)
      for (const v of vs) console.error(`  ${file}:${v.line}  ${v.reason}`);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(
    `check:card-headers scanned ${files.length} templates; ${total} violating card(s) in ${counts.size} file(s), ${[...allow.values()].reduce((a, b) => a + b, 0)} allowlisted.`,
  );
  if (problems.length) {
    console.error(
      'See AGENTS.md "Card headers" for the rule and the canonical snippet.',
    );
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main();
