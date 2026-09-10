#!/usr/bin/env node
/**
 * check-zoneless-fields.mjs
 *
 * This app runs `provideZonelessChangeDetection()` (apps/datatug-app/src/main.ts,
 * `polyfills: []` in apps/datatug-app/project.json — there is no Zone.js). Under
 * zoneless change detection, assigning a plain class field from inside an async
 * callback (`subscribe`, `then`, `catch`, `finally`, `setTimeout`, `setInterval`)
 * never schedules a repaint by itself — nothing tells Angular's zoneless scheduler
 * that component state changed. The fix is to expose that state as a `signal()`
 * (or `computed()`/`linkedSignal()`/`model()`) and write it with `.set()`/`.update()`
 * instead of `=`; a signal write notifies change detection directly. See
 * AGENTS.md's "Change detection & state (zoneless-ready)" section and
 * libs/datatug/main/src/lib/pages/signed-in/project/project-page.component.ts
 * (PR #95) for the worked example, including the recommended unit-test shape
 * (a `Subject` that emits strictly after construction, asserting the DOM updates
 * with no manual `detectChanges()`/event).
 *
 * This script statically scans `libs/**\/*.component.ts` and `apps/**\/*.component.ts`
 * for that exact bug shape using the TypeScript compiler API (an AST walk, not
 * regex, so it isn't fooled by comments/strings and it resolves the assigned
 * field back to its class-level declaration):
 *
 *   - Finds call expressions shaped like `x.subscribe(cb)`, `x.then(cb)`,
 *     `x.catch(cb)`, `x.finally(cb)`, `setTimeout(cb, ...)`, `setInterval(cb, ...)`
 *     whose relevant argument(s) are a function/arrow-function body.
 *   - Inside that callback's body (at any depth), finds assignment expressions
 *     (`=`, `+=`, `-=`, `*=`, `/=`, `??=`, `||=`, `&&=`, …) whose target is
 *     `this.<field>` — including a `this.<field>` reached via array/object
 *     destructuring assignment (`[this.storeId, this.projectId] = p.split(...)`,
 *     `({ a: this.a } = obj)`), the same zoneless-unsafe shape as a plain
 *     `this.field = ...`, just via pattern syntax.
 *   - Resolves `<field>` to its `PropertyDeclaration` on the enclosing class.
 *     If that property's initializer is a call to `signal(`, `model(`,
 *     `input(`, `computed(`, or `linkedSignal(` it is NOT reported. Fields
 *     with no matching class-level declaration (e.g. inherited) are reported
 *     too, since the common case is a plain `protected foo?: Bar;` field —
 *     they're tagged "(field not found on enclosing class — check manually)"
 *     so a human can double-check.
 *
 * Known limitations (by design, to keep this a fast, dependency-free static
 * check rather than a full type-aware analysis):
 *   - Interprocedural writes are NOT traced: a plain field written by a
 *     private method that is itself *called from* a tracked callback (e.g.
 *     `.subscribe(() => this.setFoo(x))` where `setFoo()` does `this.foo = x`)
 *     is just as zoneless-unsafe, but this script only looks at code
 *     lexically inside the callback body, so it won't be flagged. Found in
 *     practice in board/ui/pages/boards/boards-page.component.ts during the
 *     fix/zoneless-batch-a PR — fixed by inspection, not by this tool.
 *   - In-place mutation of a Record/array reachable from `this` (bracket
 *     assignment, `delete this.field[k]`, `.push()`/`.splice()` on a value
 *     read from a signal without a following `.set()`/`.update()`) is not
 *     flagged — only reassignment of `this.<field>` itself is.
 *
 * Every file with at least one such assignment is a "violation" UNLESS the
 * file's repo-relative path is listed in tools/zoneless-allowlist.txt — the
 * allowlist exists so this check can be turned on before every occurrence in
 * the repo is fixed. It is meant to only ever shrink: remove a file from it
 * once that file's async-written fields are converted to signals, and never
 * add a newly-authored file to it.
 *
 * Usage:
 *   node tools/check-zoneless-fields.mjs           # human-readable report
 *   node tools/check-zoneless-fields.mjs --json     # machine-readable report
 *
 * Exit code: 0 if there are no offenses outside the allowlist, 1 otherwise.
 * (Offenses inside allowlisted files are still printed, just don't fail the
 * build — that's how this repo's PR history reports "before/after" counts.)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const allowlistPath = join(__dirname, 'zoneless-allowlist.txt');

const TRACKED_METHOD_NAMES = new Set(['subscribe', 'then', 'catch', 'finally']);
const TRACKED_GLOBAL_FN_NAMES = new Set(['setTimeout', 'setInterval']);
const SIGNAL_FACTORY_NAMES = new Set([
  'signal',
  'model',
  'input',
  'computed',
  'linkedSignal',
]);
const ASSIGNMENT_OPERATOR_KINDS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
]);

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.worktrees',
  '.nx',
  'out-tsc',
]);

/** Repo-relative recursive walk for `<root>/**\/*.component.ts` (excluding *.spec.ts). */
function findComponentFiles() {
  const roots = ['libs', 'apps'];
  const out = [];

  function walk(relDir) {
    const absDir = join(repoRoot, relDir);
    let entries;
    try {
      entries = readdirSync(absDir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIR_NAMES.has(name)) continue;
      const relPath = join(relDir, name);
      const absPath = join(repoRoot, relPath);
      const stat = statSync(absPath, { throwIfNoEntry: false });
      if (!stat) continue;
      if (stat.isDirectory()) {
        walk(relPath);
      } else if (
        stat.isFile() &&
        name.endsWith('.component.ts') &&
        !name.endsWith('.spec.ts')
      ) {
        out.push(relPath);
      }
    }
  }

  for (const root of roots) {
    if (existsSync(join(repoRoot, root))) walk(root);
  }
  return out.sort();
}

function loadAllowlist() {
  if (!existsSync(allowlistPath)) return new Set();
  return new Set(
    readFileSync(allowlistPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  );
}

/** Collects, per class, a map of field-name -> whether it's signal-like. */
function collectClassSignalFields(sourceFile) {
  /** @type {Map<ts.ClassDeclaration, Map<string, boolean>>} */
  const perClass = new Map();

  function visit(node) {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const fields = new Map();
      for (const member of node.members) {
        if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
          let isSignalLike = false;
          const init = member.initializer;
          if (
            init &&
            ts.isCallExpression(init) &&
            ts.isIdentifier(init.expression) &&
            SIGNAL_FACTORY_NAMES.has(init.expression.text)
          ) {
            isSignalLike = true;
          }
          fields.set(member.name.text, isSignalLike);
        }
      }
      perClass.set(node, fields);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return perClass;
}

function isTrackedCallbackCall(node) {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (
    ts.isPropertyAccessExpression(callee) &&
    TRACKED_METHOD_NAMES.has(callee.name.text)
  ) {
    return callee.name.text;
  }
  if (ts.isIdentifier(callee) && TRACKED_GLOBAL_FN_NAMES.has(callee.text)) {
    return callee.text;
  }
  return null;
}

function isFunctionLike(node) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

// RxJS `subscribe()` (and legacy `Observer`/`Subscriber`) accepts either a
// plain next-handler function OR an observer object `{next, error, complete}`
// — the object form is at least as common in this codebase, and was
// previously invisible to this detector.
const OBSERVER_METHOD_NAMES = new Set(['next', 'error', 'complete']);

/**
 * Returns every function-like node reachable from a tracked call's arguments
 * that should be treated as "inside the callback": direct function arguments
 * (`.subscribe(fn)`, `.then(fn, fn)`), and — for an observer-object argument
 * (`.subscribe({ next: fn, error: fn })`) — each of its next/error/complete
 * handlers, whether written as a property function or a shorthand method.
 */
function collectCallbackFunctionNodes(callNode) {
  const nodes = [];
  for (const arg of callNode.arguments) {
    if (isFunctionLike(arg)) {
      nodes.push(arg);
      continue;
    }
    if (ts.isObjectLiteralExpression(arg)) {
      for (const prop of arg.properties) {
        if (!prop.name || !ts.isIdentifier(prop.name)) continue;
        if (!OBSERVER_METHOD_NAMES.has(prop.name.text)) continue;
        if (ts.isPropertyAssignment(prop) && isFunctionLike(prop.initializer)) {
          nodes.push(prop.initializer);
        } else if (ts.isMethodDeclaration(prop)) {
          nodes.push(prop);
        }
      }
    }
  }
  return nodes;
}

/**
 * Walks a source file exactly once (single traversal — a node is never visited
 * via two independent paths, which would double-count assignments inside
 * nested tracked calls, e.g. a `.subscribe()` inside another `.subscribe()`'s
 * callback), returning offenses: { line, column, field, kind, knownField }.
 */
function findOffenses(sourceFile) {
  const perClassFields = collectClassSignalFields(sourceFile);
  const offenses = [];
  const classStack = [];

  function enclosingFieldIsSignal(name) {
    for (let i = classStack.length - 1; i >= 0; i--) {
      const fields = perClassFields.get(classStack[i]);
      if (fields && fields.has(name)) {
        return fields.get(name);
      }
    }
    return undefined; // unknown field (not declared in any enclosing class)
  }

  /** Reports `target` (a `this.<field>` PropertyAccessExpression) as an
   * offense, unless that field is a known signal-like class member. */
  function reportIfThisPropertyTarget(target, kindLabel) {
    if (
      !ts.isPropertyAccessExpression(target) ||
      target.expression.kind !== ts.SyntaxKind.ThisKeyword
    ) {
      return;
    }
    const fieldName = target.name.text;
    const signalLike = enclosingFieldIsSignal(fieldName);
    if (signalLike !== true) {
      const pos = sourceFile.getLineAndCharacterOfPosition(
        target.getStart(sourceFile),
      );
      offenses.push({
        line: pos.line + 1,
        column: pos.character + 1,
        field: fieldName,
        kind: kindLabel,
        knownField: signalLike !== undefined,
      });
    }
  }

  function reportIfThisAssignment(node, kindLabel) {
    if (
      !ts.isBinaryExpression(node) ||
      !ASSIGNMENT_OPERATOR_KINDS.has(node.operatorToken.kind)
    ) {
      return;
    }
    const left = node.left;
    if (ts.isPropertyAccessExpression(left)) {
      reportIfThisPropertyTarget(left, kindLabel);
      return;
    }
    // Destructuring assignment, e.g. `[this.storeId, this.projectId] = p`
    // or `({ a: this.a, b: this.b } = obj)` — exactly as zoneless-unsafe as
    // a plain `this.field = ...`, just via pattern syntax.
    if (ts.isArrayLiteralExpression(left)) {
      for (const element of left.elements) {
        // An element may itself be `this.x = defaultValue` (a default in
        // the pattern) — unwrap one level to reach the real target.
        const target =
          ts.isBinaryExpression(element) &&
          element.operatorToken.kind === ts.SyntaxKind.EqualsToken
            ? element.left
            : element;
        reportIfThisPropertyTarget(target, kindLabel);
      }
    } else if (ts.isObjectLiteralExpression(left)) {
      for (const prop of left.properties) {
        if (ts.isShorthandPropertyAssignment(prop)) continue; // `{ this }` isn't valid JS; nothing to do
        if (ts.isPropertyAssignment(prop)) {
          const target =
            ts.isBinaryExpression(prop.initializer) &&
            prop.initializer.operatorToken.kind === ts.SyntaxKind.EqualsToken
              ? prop.initializer.left
              : prop.initializer;
          reportIfThisPropertyTarget(target, kindLabel);
        }
      }
    }
  }

  // Maps a callback function node (found at ANY depth under a tracked call's
  // arguments — a direct arg, or a next/error/complete handler nested inside
  // an observer-object arg) to the tracked call's kind label. Populated
  // lazily as tracked calls are discovered during the single traversal below.
  const trackedFunctionNodeKind = new Map();

  // `activeKind` is the name of the nearest enclosing tracked callback
  // (subscribe/then/catch/finally/setTimeout/setInterval) this node is
  // nested inside, or undefined if none. It is threaded through a SINGLE
  // recursive descent so every node is visited exactly once, however deep
  // the callback function node sits below the call expression.
  function visit(node, activeKind) {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      classStack.push(node);
      ts.forEachChild(node, (child) => visit(child, undefined));
      classStack.pop();
      return;
    }

    if (activeKind) {
      reportIfThisAssignment(node, activeKind);
    }

    const trackedKind = isTrackedCallbackCall(node);
    if (trackedKind) {
      for (const fnNode of collectCallbackFunctionNodes(node)) {
        trackedFunctionNodeKind.set(fnNode, trackedKind);
      }
    }

    ts.forEachChild(node, (child) => {
      const childActiveKind = trackedFunctionNodeKind.get(child) ?? activeKind;
      visit(child, childActiveKind);
    });
  }

  visit(sourceFile, undefined);
  return offenses;
}

function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');

  const files = findComponentFiles();
  const allowlist = loadAllowlist();

  /** @type {{file: string, offenses: ReturnType<typeof findOffenses>}[]} */
  const results = [];

  for (const relPath of files) {
    const abs = join(repoRoot, relPath);
    const text = readFileSync(abs, 'utf8');
    const sourceFile = ts.createSourceFile(
      abs,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const offenses = findOffenses(sourceFile);
    if (offenses.length > 0) {
      results.push({ file: relPath, offenses });
    }
  }

  results.sort((a, b) => b.offenses.length - a.offenses.length);

  const blocking = results.filter((r) => !allowlist.has(r.file));
  const allowlisted = results.filter((r) => allowlist.has(r.file));
  const staleAllowlistEntries = [...allowlist].filter(
    (f) => !results.some((r) => r.file === f),
  );

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          totalFiles: files.length,
          totalOffenseFiles: results.length,
          totalOffenses: results.reduce((n, r) => n + r.offenses.length, 0),
          blocking: blocking.map((r) => ({ file: r.file, count: r.offenses.length })),
          allowlisted: allowlisted.map((r) => ({ file: r.file, count: r.offenses.length })),
          staleAllowlistEntries,
        },
        null,
        2,
      ),
    );
    process.exit(blocking.length > 0 ? 1 : 0);
    return;
  }

  console.log(`check-zoneless-fields: scanned ${files.length} component file(s)`);
  console.log(
    `  offending files: ${results.length} (${results.reduce((n, r) => n + r.offenses.length, 0)} field write(s))`,
  );
  console.log('');

  if (results.length > 0) {
    console.log('Inventory (file -> plain-field async writes):');
    for (const r of results) {
      const tag = allowlist.has(r.file) ? ' [allowlisted]' : '';
      console.log(`  ${String(r.offenses.length).padStart(3)}  ${r.file}${tag}`);
    }
    console.log('');
  }

  if (blocking.length > 0) {
    console.log('Blocking offenses (file not in tools/zoneless-allowlist.txt):');
    for (const r of blocking) {
      for (const o of r.offenses) {
        console.log(
          `  ${r.file}:${o.line}:${o.column}  this.${o.field} = ... inside .${o.kind}(...)` +
            (o.knownField ? '' : '  (field not found on enclosing class — check manually)'),
        );
      }
    }
    console.log('');
  }

  if (staleAllowlistEntries.length > 0) {
    console.log('Note: these allowlist entries have zero current offenses (safe to remove):');
    for (const f of staleAllowlistEntries) console.log(`  ${f}`);
    console.log('');
  }

  if (blocking.length === 0) {
    console.log('OK: no zoneless-unsafe field writes outside the allowlist.');
  } else {
    console.log(
      `FAIL: ${blocking.length} file(s) with zoneless-unsafe field writes are not in tools/zoneless-allowlist.txt.`,
    );
    console.log(
      'Fix: convert the field(s) to signal()/computed()/linkedSignal() (see AGENTS.md and ' +
        'libs/datatug/main/src/lib/pages/signed-in/project/project-page.component.ts), or, if fixing it is ' +
        'out of scope for this change, add its repo-relative path to tools/zoneless-allowlist.txt.',
    );
  }

  process.exit(blocking.length > 0 ? 1 : 0);
}

main();
