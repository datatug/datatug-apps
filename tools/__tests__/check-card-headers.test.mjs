// Unit tests for tools/check-card-headers.mjs.
// Run: node --test tools/__tests__/check-card-headers.test.mjs
// (`pnpm run test:check-card-headers`, wired into CI next to check:zoneless.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findViolations,
  parseAllowlist,
  compare,
  compareToBase,
  inlineTemplates,
} from '../check-card-headers.mjs';

const n = (html) => findViolations(html).violations.length;

test('good card: divider first, with label and end actions', () => {
  assert.equal(
    n(`<ion-card>
         <ion-item-divider color="light">
           <ion-label>Title</ion-label>
           <ion-button slot="end">Edit</ion-button>
         </ion-item-divider>
         <ion-card-content>x</ion-card-content>
       </ion-card>`),
    0,
  );
});

test('bare ion-card-header is flagged with a specific reason', () => {
  const { violations } = findViolations(
    `<ion-card><ion-card-header><ion-card-title>T</ion-card-title></ion-card-header></ion-card>`,
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0].reason, /bare <ion-card-header>/);
});

test('header-less card is flagged, divider with wrong colour too', () => {
  assert.equal(
    n(`<ion-card><ion-card-content>x</ion-card-content></ion-card>`),
    1,
  );
  assert.equal(
    n(
      `<ion-card><ion-item-divider><ion-label>T</ion-label></ion-item-divider></ion-card>`,
    ),
    1,
  );
  assert.equal(
    n(`<ion-card><ion-item-divider [color]="c"></ion-item-divider></ion-card>`),
    1,
  );
});

test('divider that is not the first child is flagged', () => {
  assert.equal(
    n(
      `<ion-card><ion-card-content>x</ion-card-content><ion-item-divider color="light"></ion-item-divider></ion-card>`,
    ),
    1,
  );
});

test('divider colour: light, warning, danger pass; others and bound fail', () => {
  for (const c of ['light', 'warning', 'danger'])
    assert.equal(
      n(
        `<ion-card><ion-item-divider color="${c}"></ion-item-divider></ion-card>`,
      ),
      0,
      c,
    );
  for (const c of ['primary', 'medium', 'success'])
    assert.equal(
      n(
        `<ion-card><ion-item-divider color="${c}"></ion-item-divider></ion-card>`,
      ),
      1,
      c,
    );
  assert.equal(
    n(`<ion-card><ion-item-divider [color]="c"></ion-item-divider></ion-card>`),
    1,
  );
  assert.equal(
    n(
      `<ion-card color="danger"><ion-card-header></ion-card-header></ion-card>`,
    ),
    1,
  );
});

test('control flow: @if/@else, @for, @switch, nested cards', () => {
  const d = `<ion-item-divider color="light"></ion-item-divider>`;
  assert.equal(
    n(`@if (a) { <ion-card>${d}</ion-card> } @else { <ion-card>x</ion-card> }`),
    1,
  );
  assert.equal(
    n(
      `@for (r of rows; track r) { <ion-card>${d}</ion-card> } @empty { <p>none</p> }`,
    ),
    0,
  );
  assert.equal(
    n(`@for (r of rows; track r) { <ion-card><p>x</p></ion-card> }`),
    1,
  );
  assert.equal(
    n(
      `@switch (k) { @case (1) { <ion-card>${d}</ion-card> } @default { <ion-card>${d}</ion-card> } }`,
    ),
    0,
  );
  // card whose header is itself produced by control flow: every branch must be a divider
  assert.equal(n(`<ion-card>@if (a) { ${d} } @else { ${d} }</ion-card>`), 0);
  assert.equal(
    n(`<ion-card>@if (a) { ${d} } @else { <p>x</p> }</ion-card>`),
    1,
  );
  assert.equal(
    n(
      `<ion-card>${d}<ion-card-content><ion-card>y</ion-card></ion-card-content></ion-card>`,
    ),
    1,
  );
});

test('reports the 1-based line of the card', () => {
  const { violations } = findViolations(`<p>a</p>\n<ion-card>x</ion-card>`);
  assert.equal(violations[0].line, 2);
});

test('allowlist: a new violation fails, an exact match passes', () => {
  const allow = parseAllowlist('# c\nlibs/a.component.html: 2\n');
  assert.deepEqual(compare(new Map([['libs/a.component.html', 2]]), allow), []);
  const grown = compare(new Map([['libs/a.component.html', 3]]), allow);
  assert.equal(grown.length, 1);
  assert.match(grown[0], /NEW violation/);
  const fresh = compare(new Map([['libs/b.component.html', 1]]), allow);
  assert.ok(fresh.some((p) => /NEW violation: libs\/b/.test(p)));
});

test('allowlist: a stale entry fails (fixed file, or lower count)', () => {
  const allow = parseAllowlist('libs/a.component.html: 2\n');
  const fixed = compare(new Map(), allow);
  assert.equal(fixed.length, 1);
  assert.match(fixed[0], /STALE/);
  assert.match(
    compare(new Map([['libs/a.component.html', 1]]), allow)[0],
    /STALE/,
  );
});

test('ng-container first child is looked through', () => {
  const d = `<ion-item-divider color="light"></ion-item-divider>`;
  assert.equal(n(`<ion-card><ng-container>${d}</ng-container></ion-card>`), 0);
  assert.equal(
    n(`<ion-card><ng-container><p>x</p></ng-container></ion-card>`),
    1,
  );
});

test('ng-template first child does not pass', () => {
  const d = `<ion-item-divider color="light"></ion-item-divider>`;
  assert.equal(n(`<ion-card><ng-template>${d}</ng-template></ion-card>`), 1);
});

test('@if without @else needs a divider outside it', () => {
  const d = `<ion-item-divider color="light"></ion-item-divider>`;
  assert.equal(n(`<ion-card>@if (a) { ${d} }<p>x</p></ion-card>`), 1);
  assert.equal(n(`<ion-card>${d}@if (a) { <p>x</p> }</ion-card>`), 0);
  assert.equal(n(`<ion-card>@switch (k) { @case (1) { ${d} } }</ion-card>`), 1);
});

test('malformed allowlist counts fail', () => {
  for (const bad of [
    'libs/a.html: NaN',
    'libs/a.html: x',
    'libs/a.html',
    'libs/a.html: 0',
    'libs/a.html: 1.5',
  ]) {
    const problems = compare(new Map(), parseAllowlist(bad));
    assert.ok(
      problems.some((p) => /MALFORMED/.test(p)),
      bad,
    );
  }
});

test('shrink-only against the base allowlist', () => {
  const base = parseAllowlist('libs/a.html: 2\nlibs/b.html: 1\n');
  assert.deepEqual(compareToBase(parseAllowlist('libs/a.html: 1\n'), base), []);
  assert.match(
    compareToBase(parseAllowlist('libs/a.html: 3\n'), base)[0],
    /rose from 2 to 3/,
  );
  assert.match(
    compareToBase(parseAllowlist('libs/c.html: 1\n'), base)[0],
    /was added/,
  );
});

test('inline templates in .ts are extracted with a line offset', () => {
  const src =
    "import {Component} from '@angular/core';\n@Component({\n  template: `\n<ion-card>x</ion-card>`,\n})\nclass A {}";
  const [t] = inlineTemplates(src);
  const { violations } = findViolations(t.text, 'a.ts', t.lineOffset);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 4);
});
