import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestCase } from '@playwright/test/reporter';
import DemodbRequestReporter from './demodb-request-reporter.ts';

const counts = (escaped: number) => ({ total: 1, handled: 0, fixture: 0, memo: 0, live: 0, refused: 0, escaped });

/** A finished test as the reporter sees it. */
const finished = (file: string, escaped: number, expectedEscape: boolean): TestCase =>
  ({
    location: { file },
    annotations: [
      ...(expectedEscape ? [{ type: 'demodb-expected-escape' }] : []),
      { type: 'demodb-requests', description: JSON.stringify({ mode: 'fixture', hosts: { 'cloud.openvaultdb.com': counts(escaped) } }) },
    ],
  }) as unknown as TestCase;

test('the guard self-test may mark a deliberate escape: it is not counted and does not fail the lane', () => {
  const reporter = new DemodbRequestReporter();
  reporter.onTestEnd(finished('/repo/apps/datatug-app/e2e/demodb-guard-selftest.spec.ts', 1, true));
  assert.deepEqual(reporter.verdict(), { live: 0, escaped: 0, budget: 0, githubLive: 0, githubBudget: 0, failed: false });
});

test('any other spec carrying the annotation is a normal test: its escape counts and fails the lane', () => {
  for (const file of ['/repo/apps/datatug-app/e2e/chat.spec.ts', '/repo/apps/datatug-app/e2e/not-demodb-guard-selftest.spec.ts']) {
    const reporter = new DemodbRequestReporter();
    reporter.onTestEnd(finished(file, 1, true));
    assert.equal(reporter.verdict().escaped, 1, file);
    assert.equal(reporter.verdict().failed, true, file);
  }
});

test('an unannotated escape in the self-test file still counts', () => {
  const reporter = new DemodbRequestReporter();
  reporter.onTestEnd(finished('/repo/apps/datatug-app/e2e/demodb-guard-selftest.spec.ts', 1, false));
  assert.equal(reporter.verdict().failed, true);
});
