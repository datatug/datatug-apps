// Fixture-based unit tests for tools/check-zoneless-fields.mjs's findOffenses().
//
// Uses Node's built-in test runner (node:test — no extra dependency, matching
// the detector's own "fast, dependency-free static check" design) against
// small in-memory TypeScript fixtures, rather than the repo's real
// *.component.ts files, so each test isolates exactly one AST shape.
//
// Run: node --test tools/__tests__/check-zoneless-fields.test.mjs
// (wired into package.json as `pnpm run test:check-zoneless-fields`, and into
// CI immediately after `check:zoneless` — see .github/workflows/ci.yml.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { findOffenses } from '../check-zoneless-fields.mjs';

/** Wraps `classBody` in a minimal `@Component` class and parses it exactly
 * like the real detector does (`setParentNodes: true` — the new in-place-
 * mutation checks resolve `.parent` pointers to find the enclosing tracked
 * callback). */
function offensesFor(classBody, className = 'FixtureComponent') {
  const source = `
    import { Component, signal } from '@angular/core';
    @Component({ selector: 'x' })
    export class ${className} {
      ${classBody}
    }
  `;
  const sourceFile = ts.createSourceFile(
    'fixture.component.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return findOffenses(sourceFile);
}

// --- Regression: the original "this.field = ..." reassignment shape -------

test('flags a plain field reassigned inside .subscribe()', () => {
  const offenses = offensesFor(`
    private plain?: string;
    ngOnInit() {
      this.svc.get().subscribe((v) => { this.plain = v; });
    }
  `);
  assert.equal(offenses.length, 1);
  assert.equal(offenses[0].field, 'plain');
  assert.equal(offenses[0].kind, 'subscribe');
});

test('does not flag a signal field reassigned via .set() inside .subscribe()', () => {
  const offenses = offensesFor(`
    private readonly sig = signal<string | undefined>(undefined);
    ngOnInit() {
      this.svc.get().subscribe((v) => { this.sig.set(v); });
    }
  `);
  assert.equal(offenses.length, 0);
});

test('flags a destructuring assignment into two plain fields inside .subscribe()', () => {
  const offenses = offensesFor(`
    private a?: string;
    private b?: string;
    ngOnInit() {
      this.svc.get().subscribe((p) => { [this.a, this.b] = p.split('/'); });
    }
  `);
  assert.equal(offenses.length, 2);
});

// --- (a) element-access assignment rooted at this.<field> ------------------

test('flags this.field[k] = v on a plain field inside .subscribe()', () => {
  const offenses = offensesFor(`
    private readonly isDeleting: Record<string, boolean> = {};
    remove(id: string) {
      this.svc.remove(id).subscribe(() => { this.isDeleting[id] = false; });
    }
  `);
  assert.equal(offenses.length, 1);
  assert.equal(offenses[0].field, 'isDeleting');
  assert.equal(offenses[0].shape, 'elementAccessAssign');
});

test('flags a nested this.f.x[k] = v, attributing it to the root field f', () => {
  const offenses = offensesFor(`
    private readonly f: { x: Record<string, boolean> } = { x: {} };
    ngOnInit() {
      this.svc.get().subscribe(() => { this.f.x['k'] = true; });
    }
  `);
  assert.equal(offenses.length, 1);
  assert.equal(offenses[0].field, 'f');
  assert.equal(offenses[0].shape, 'elementAccessAssign');
});

test('does not flag this.field[k] = v outside any tracked callback', () => {
  const offenses = offensesFor(`
    private readonly isDeleting: Record<string, boolean> = {};
    remove(id: string) {
      this.isDeleting[id] = true; // synchronous, not inside subscribe/then/etc.
    }
  `);
  assert.equal(offenses.length, 0);
});

// --- (b) delete this.<field>[...] ------------------------------------------

test('flags delete this.field[k] on a plain field inside .subscribe({next, error})', () => {
  const offenses = offensesFor(`
    private readonly isDeleting: Record<string, boolean> = {};
    remove(id: string) {
      this.svc.remove(id).subscribe({
        next: () => { delete this.isDeleting[id]; },
        error: () => { delete this.isDeleting[id]; },
      });
    }
  `);
  assert.equal(offenses.length, 2);
  for (const o of offenses) {
    assert.equal(o.field, 'isDeleting');
    assert.equal(o.shape, 'deleteElement');
    assert.equal(o.kind, 'subscribe');
  }
});

test('does not flag delete this.field (no brackets) inside .subscribe()', () => {
  // Out of scope by design — brief only asks for `delete this.<field>[...]`.
  const offenses = offensesFor(`
    private plain?: string;
    ngOnInit() {
      this.svc.get().subscribe(() => { delete this.plain; });
    }
  `);
  assert.equal(offenses.length, 0);
});

// --- (c) known-mutating array method calls ----------------------------------

test('flags this.field.push(x) on a plain array field inside .then()', () => {
  const offenses = offensesFor(`
    private readonly items: string[] = [];
    ngOnInit() {
      this.svc.get().then((v) => { this.items.push(v); });
    }
  `);
  assert.equal(offenses.length, 1);
  assert.equal(offenses[0].field, 'items');
  assert.equal(offenses[0].shape, 'mutatingMethod');
  assert.equal(offenses[0].methodName, 'push');
  assert.equal(offenses[0].kind, 'then');
});

test('flags this.field.splice(...) on a plain array field inside setTimeout()', () => {
  const offenses = offensesFor(`
    private readonly items: string[] = [];
    ngOnInit() {
      setTimeout(() => { this.items.splice(0, 1); }, 0);
    }
  `);
  assert.equal(offenses.length, 1);
  assert.equal(offenses[0].shape, 'mutatingMethod');
  assert.equal(offenses[0].methodName, 'splice');
  assert.equal(offenses[0].kind, 'setTimeout');
});

test('does not flag a non-mutating array method (e.g. .map()) on a plain field', () => {
  const offenses = offensesFor(`
    private readonly items: string[] = [];
    ngOnInit() {
      this.svc.get().subscribe(() => { this.items.map((x) => x); });
    }
  `);
  assert.equal(offenses.length, 0);
});

test('does not flag a mutating method call on a local array unrelated to this', () => {
  const offenses = offensesFor(`
    ngOnInit() {
      this.svc.get().subscribe(() => {
        const rows: string[] = [];
        rows.push('x');
      });
    }
  `);
  assert.equal(offenses.length, 0);
});

// --- (d) mutation of a value obtained from a signal call --------------------

test('flags this.sig().push(x) when no .set()/.update() on sig follows in the same callback', () => {
  const offenses = offensesFor(`
    private readonly sig = signal<string[]>([]);
    ngOnInit() {
      this.svc.get().subscribe(() => { this.sig().push('x'); });
    }
  `);
  assert.equal(offenses.length, 1);
  assert.equal(offenses[0].field, 'sig');
  assert.equal(offenses[0].shape, 'mutatingMethod');
  assert.equal(offenses[0].viaCall, true);
});

test('does not flag this.sig().push(x) when this.sig.set(...) also appears in the same callback', () => {
  const offenses = offensesFor(`
    private readonly sig = signal<string[]>([]);
    ngOnInit() {
      this.svc.get().subscribe(() => {
        const next = this.sig();
        next.push('x');
        this.sig.set(next);
      });
    }
  `);
  assert.equal(offenses.length, 0);
});

test('does not flag this.sig().push(x) when this.sig.update(...) also appears in the same callback', () => {
  const offenses = offensesFor(`
    private readonly sig = signal<string[]>([]);
    ngOnInit() {
      this.svc.get().subscribe(() => {
        this.sig().push('x');
        this.sig.update((v) => v);
      });
    }
  `);
  assert.equal(offenses.length, 0);
});

test('flags a local alias (const arr = this.sig();) mutated with no later .set()/.update()', () => {
  const offenses = offensesFor(`
    private readonly sig = signal<string[]>([]);
    ngOnInit() {
      this.svc.get().subscribe(() => {
        const arr = this.sig();
        arr.push('x');
      });
    }
  `);
  assert.equal(offenses.length, 1);
  assert.equal(offenses[0].field, 'sig');
  assert.equal(offenses[0].shape, 'mutatingMethod');
  assert.equal(offenses[0].viaCall, true);
});

test('does not flag a local alias mutated when .update() on the same signal follows', () => {
  const offenses = offensesFor(`
    private readonly sig = signal<string[]>([]);
    ngOnInit() {
      this.svc.get().subscribe(() => {
        const arr = this.sig();
        arr.push('x');
        this.sig.update(() => arr);
      });
    }
  `);
  assert.equal(offenses.length, 0);
});

test('does not flag const x = this.getThing() (a plain method, not a signal) even if x is mutated', () => {
  const offenses = offensesFor(`
    getThing(): string[] { return []; }
    ngOnInit() {
      this.svc.get().subscribe(() => {
        const x = this.getThing();
        x.push('y');
      });
    }
  `);
  assert.equal(offenses.length, 0);
});

// --- Unknown field tagging (parity with the original assignment check) -----

test('still flags and tags an unknown (not declared on this class) field for a bracket mutation', () => {
  const offenses = offensesFor(`
    ngOnInit() {
      this.svc.get().subscribe(() => { this.inherited['k'] = true; });
    }
  `);
  assert.equal(offenses.length, 1);
  assert.equal(offenses[0].knownField, false);
});
