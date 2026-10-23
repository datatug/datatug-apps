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
 * The check parses every `*.html` under libs/ and apps/, plus the inline
 * `template:` literals of non-spec `*.ts` files (allowlisted under the `.ts`
 * path), with Angular's own template parser (`@angular/compiler`, already a dependency),
 * so `@if`/`@for`/`@switch`/`@defer` blocks and `<ng-template>` are real
 * nodes, not text. A card passes when the first non-text node in it is the
 * divider; when that node is a control-flow block, the first element of EVERY
 * branch must be the divider; `ng-container` is looked through; a missing
 * branch (`@if` without `@else`, `@switch` without `@default`, `@for` without
 * `@empty`) counts as no header, and `<ng-template>`/`@defer` never pass. No
 * regex over the markup. A malformed allowlist count fails the check.
 * `--base-allowlist <file>` additionally fails if the allowlist grew vs that
 * copy (CI passes the base branch's file on pull_request and merge_group).
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
import ts from 'typescript';

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

/**
 * Branches that must EACH start with the header when a control-flow block is
 * the card's first node, or null when the block can never count as a header
 * (`<ng-template>` and `@defer` render lazily or on demand). A missing branch
 * (an `@if` without `@else`, a `@switch` without `@default`, a `@for` without
 * `@empty`) renders no header, so it is a branch that fails.
 */
function headerBranches(node) {
  switch (nodeType(node)) {
    case 'IfBlock':
      return [
        ...node.branches.map((b) => b.children),
        ...(node.branches.some((b) => b.expression === null) ? [] : [[]]),
      ];
    case 'ForLoopBlock':
      return [node.children, node.empty ? node.empty.children : []];
    case 'SwitchBlock': {
      const hasDefault = node.groups.some((g) =>
        g.cases.some((c) => c.expression === null),
      );
      return [
        ...node.groups.map((g) => g.children),
        ...(hasDefault ? [] : [[]]),
      ];
    }
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
  const t = nodeType(first);
  if (t === 'Template' || t === 'DeferredBlock') return false;
  const branches = headerBranches(first);
  if (branches) {
    return branches.every((b) => startsWithHeader(b, isDangerCard));
  }
  if (t === 'Element' && first.name === 'ng-container') {
    return startsWithHeader(first.children, isDangerCard);
  }
  if (t !== 'Element' || first.name !== 'ion-item-divider') return false;
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
export function findViolations(
  html,
  fileName = 'fixture.component.html',
  lineOffset = 0,
) {
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
    violations.push({
      line: card.sourceSpan.start.line + 1 + lineOffset,
      reason,
    });
  }
  return { violations, parseErrors: (errors ?? []).map((e) => e.msg) };
}

/**
 * Parses allowlist text into Map<path, count>. A malformed line keeps a NaN
 * count so `compare` can fail on it.
 */
export function parseAllowlist(text) {
  const map = new Map();
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.lastIndexOf(':');
    if (i < 0) {
      map.set(l, NaN);
      continue;
    }
    const num = l.slice(i + 1).trim();
    map.set(
      l.slice(0, i).trim(),
      /^[1-9][0-9]*$/.test(num) ? Number(num) : NaN,
    );
  }
  return map;
}

/** Compares per-file counts with the allowlist. Returns failure messages. */
export function compare(counts, allow) {
  const problems = [];
  for (const [file, allowed] of allow) {
    if (!Number.isInteger(allowed) || allowed < 1)
      problems.push(
        `MALFORMED allowlist entry: "${file}" needs a positive integer count (\`path: N\`)`,
      );
  }
  for (const [file, n] of counts) {
    const allowed = allow.get(file) ?? 0;
    if (n > (Number.isInteger(allowed) ? allowed : 0))
      problems.push(
        `NEW violation: ${file} has ${n} card(s) without a valid header (allowlisted: ${Number.isInteger(allowed) ? allowed : 0})`,
      );
  }
  for (const [file, allowed] of allow) {
    if (!Number.isInteger(allowed)) continue;
    const n = counts.get(file) ?? 0;
    if (n < allowed)
      problems.push(
        `STALE allowlist entry: ${file} lists ${allowed} but has ${n}; lower or delete it in tools/card-header-allowlist.txt`,
      );
  }
  return problems;
}

/** Shrink-only: no file added to, and no count raised in, the allowlist vs its base copy. */
export function compareToBase(allow, base) {
  const problems = [];
  for (const [file, n] of allow) {
    const was = base.get(file);
    if (was === undefined)
      problems.push(
        `ALLOWLIST GREW: ${file} was added (${n}); the list may only shrink`,
      );
    else if (n > was)
      problems.push(`ALLOWLIST GREW: ${file} rose from ${was} to ${n}`);
  }
  return problems;
}

/**
 * Inline `template:` literals of @Component classes in a .ts source:
 * [{ text, lineOffset }]. Substitutions in a template literal become empty.
 */
export function inlineTemplates(source, fileName = 'x.ts') {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const out = [];
  (function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'template'
    ) {
      const init = node.initializer;
      let text = null;
      if (ts.isStringLiteralLike(init)) text = init.text;
      else if (ts.isTemplateExpression(init))
        text =
          init.head.text +
          init.templateSpans.map((sp) => sp.literal.text).join('');
      if (text !== null) {
        const line = sf.getLineAndCharacterOfPosition(init.getStart()).line;
        out.push({ text, lineOffset: line });
      }
    }
    ts.forEachChild(node, visit);
  })(sf);
  return out;
}

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (
      e.name.endsWith('.html') ||
      (e.name.endsWith('.ts') &&
        !e.name.endsWith('.d.ts') &&
        !/\.(spec|test)\.ts$/.test(e.name))
    )
      out.push(p);
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
    const src = readFileSync(f, 'utf8');
    const templates = f.endsWith('.html')
      ? [{ text: src, lineOffset: 0 }]
      : src.includes('<ion-card')
        ? inlineTemplates(src, rel)
        : [];
    const violations = [];
    for (const t of templates) {
      const r = findViolations(t.text, rel, t.lineOffset);
      violations.push(...r.violations);
      if (r.parseErrors.length)
        failures.push(`PARSE error in ${rel}: ${r.parseErrors[0]}`);
    }
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
  const baseIdx = process.argv.indexOf('--base-allowlist');
  if (baseIdx > 0)
    problems.push(
      ...compareToBase(
        allow,
        parseAllowlist(readFileSync(process.argv[baseIdx + 1], 'utf8')),
      ),
    );
  for (const p of problems) console.error(p);
  for (const [file, vs] of details) {
    if ((allow.get(file) ?? 0) < vs.length)
      for (const v of vs) console.error(`  ${file}:${v.line}  ${v.reason}`);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(
    `check:card-headers scanned ${files.length} files; ${total} violating card(s) in ${counts.size} file(s), ${[...allow.values()].reduce((a, b) => a + b, 0)} allowlisted.`,
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
