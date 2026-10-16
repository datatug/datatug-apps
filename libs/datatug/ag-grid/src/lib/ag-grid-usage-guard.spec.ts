// Guard: every <ag-grid-angular> must be created through *datatugAgGridReady (so AG Grid modules and the optional
// enterprise license are registered first), and the component hosting it must import AgGridReadyDirective.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// nx runs every project's tests from the workspace root.
const root = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) {
      return [];
    }
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|html)$/.test(name) && !/\.(spec|test|d)\.ts$/.test(name)
      ? [path]
      : [];
  });
}

describe('<ag-grid-angular> usage', () => {
  it('scans the workspace', () => {
    expect(statSync(join(root, 'apps')).isDirectory()).toBe(true);
  });

  const files = [
    ...sources(join(root, 'apps')),
    ...sources(join(root, 'libs')),
  ].filter((f) => !f.includes('/libs/datatug/ag-grid/'));

  it('every grid tag carries *datatugAgGridReady', () => {
    const offenders = files.filter((f) =>
      /<ag-grid-angular(?![^>]*\*datatugAgGridReady)/.test(
        readFileSync(f, 'utf8'),
      ),
    );
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });

  it('every component whose template has a grid imports AgGridReadyDirective', () => {
    const offenders: string[] = [];
    for (const f of files.filter((x) =>
      /<ag-grid-angular/.test(readFileSync(x, 'utf8')),
    )) {
      const ts = f.endsWith('.html') ? f.replace(/\.html$/, '.ts') : f;
      const text = readFileSync(ts, 'utf8');
      const usedInDecorator = text
        .split('\n')
        .some(
          (l) => !/^\s*import\b/.test(l) && /\bAgGridReadyDirective\b/.test(l),
        );
      if (!usedInDecorator) {
        offenders.push(relative(root, ts));
      }
    }
    expect(offenders).toEqual([]);
  });
});
