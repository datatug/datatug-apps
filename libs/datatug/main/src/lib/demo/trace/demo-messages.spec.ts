import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoDirOnDisk } from '../testing/repo-root';
import { DEMO_MESSAGES, placeholders, renderMessage } from './demo-messages';

const demoDir = demoDirOnDisk();

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'bundle' ? [] : sources(path);
    return /\.(ts|html)$/.test(name) && !/\.spec\.ts$/.test(name) && name !== 'demo-messages.ts' ? [path] : [];
  });
}

describe('demo dictionary', () => {
  it('has the same keys and the same placeholders in English and Russian', () => {
    const en = Object.keys(DEMO_MESSAGES.en).sort();
    const ru = Object.keys(DEMO_MESSAGES.ru).sort();
    expect(ru).toEqual(en);
    for (const key of en) expect([key, placeholders(DEMO_MESSAGES.ru[key])]).toEqual([key, placeholders(DEMO_MESSAGES.en[key])]);
  });

  it('defines every message key the demo code uses (so no step text is ever a bare key)', () => {
    const used = new Set<string>();
    for (const file of sources(demoDir)) {
      for (const match of readFileSync(file, 'utf8').matchAll(/'((?:step|decision|obs|trace|result|col|followup|observations|keep|edge|attribution|chooser|question|page|mechanism|provenance|status)\.[\w.-]+)'/g)) used.add(match[1]);
    }
    const missing = [...used].filter((key) => !(key in DEMO_MESSAGES.en)).filter((key) => !/\.$/.test(key));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(40);
  });

  it('has a mechanism, provenance and status label for every value the trace can carry', () => {
    for (const key of ['deterministic', 'cached', 'jev', 'llm', 'human']) expect(DEMO_MESSAGES.en[`mechanism.${key}`]).toBeTruthy();
    for (const key of ['schema', 'declared', 'human-confirmed', 'observed', 'verified', 'inferred-from-data', 'ai-suggested', 'hypothesis']) expect(DEMO_MESSAGES.en[`provenance.${key}`]).toBeTruthy();
    for (const key of ['ok', 'warning', 'failed', 'running', 'skipped']) expect(DEMO_MESSAGES.en[`status.${key}`]).toBeTruthy();
  });
});

describe('renderMessage', () => {
  it('fills parameters and leaves unknown ones visible', () => {
    expect(renderMessage('en', 'step.reconcile.ok', { matched: 24, total: 24 })).toBe('Mapping resolved: 24 of 24 billing countries have a population record.');
    expect(renderMessage('en', 'step.reconcile.ok', { matched: 24 })).toContain('{total}');
  });

  it('renders an unknown key as itself', () => {
    expect(renderMessage('en', 'no.such.key')).toBe('no.such.key');
  });

  it('chooses plural forms for the language', () => {
    expect(renderMessage('en', 'result.rows', { rows: 1 })).toBe('1 row');
    expect(renderMessage('en', 'result.rows', { rows: 24 })).toBe('24 rows');
    expect(renderMessage('ru', 'result.rows', { rows: 1 })).toBe('1 строка');
    expect(renderMessage('ru', 'result.rows', { rows: 24 })).toBe('24 строки');
    expect(renderMessage('ru', 'result.rows', { rows: 25 })).toBe('25 строк');
    expect(renderMessage('ru', 'result.rows', { rows: 21 })).toBe('21 строка');
  });

  it('renders a nested plural next to ordinary parameters', () => {
    expect(renderMessage('en', 'step.execute.source', { source: 'geo.population_wb', rows: 216, requests: 1 })).toBe('geo.population_wb: 216 rows read in 1 request');
    expect(renderMessage('en', 'step.execute.source', { source: 'chinook.Invoice', rows: 412, requests: 2 })).toBe('chinook.Invoice: 412 rows read in 2 requests');
  });
});
