import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Reporter, TestCase } from '@playwright/test/reporter';
import type { HostCounts } from './demodb-guard-logic';

type Row = HostCounts;

/**
 * Prints, at the end of a run, how many requests went to each *.demodb.dev / OpenVaultDB host: asked for by the browser
 * (asked), answered from fixtures, from the live memo, sent to the real host (LIVE), refused, and ESCAPED (reached the network instead of being
 * answered locally: a real server address, or a failed name lookup / connection). The same table goes to $GITHUB_STEP_SUMMARY (Nx truncates
 * long job logs, the summary does not) and to DEMODB_REPORT_FILE (in CI by default coverage/demodb-request-report-<job>-<pid>.md, one file per Playwright run, which the lane prints in a later step). It fails the run when anything escaped, and in
 * live mode when the live total exceeds DEMODB_E2E_MAX_RUN_LIVE_REQUESTS (default 120).
 */
/** Whether a test is the guard self-test, the only file allowed to mark a deliberate escape. */
const isSelftest = (test: TestCase): boolean => /(^|[\\/])demodb-guard-selftest\.spec\.ts$/.test(test.location?.file ?? '');

export default class DemodbRequestReporter implements Reporter {
  private readonly hosts = new Map<string, Row>();
  private mode = process.env['DEMODB_E2E_MODE'] === 'live' ? 'live' : 'fixture';
  private tests = 0;
  /** Negative-control tests (only the guard self-test may be one) whose requests are reported but not counted. */
  private readonly excluded = { tests: 0, total: 0, escaped: 0 };

  onTestEnd(test: TestCase): void {
    const note = test.annotations.filter((annotation) => annotation.type === 'demodb-requests').at(-1);
    if (!note?.description) return;
    this.tests += 1;
    const parsed = JSON.parse(note.description) as { mode: string; hosts: Record<string, Row> };
    // The guard self-test deliberately sends one request the guard must flag (a negative control, `test.fail()`): that is
    // not an escape of the lane. The annotation is honoured for that one file only; any other test that carries it is a
    // normal test, its escapes count and fail the lane.
    if (isSelftest(test) && test.annotations.some((annotation) => annotation.type === 'demodb-expected-escape')) {
      this.excluded.tests += 1;
      for (const counts of Object.values(parsed.hosts)) {
        this.excluded.total += counts.total ?? 0;
        this.excluded.escaped += counts.escaped ?? 0;
      }
      return;
    }
    this.mode = parsed.mode;
    for (const [host, counts] of Object.entries(parsed.hosts)) {
      const sum = this.hosts.get(host) ?? { total: 0, handled: 0, fixture: 0, memo: 0, live: 0, refused: 0, escaped: 0 };
      for (const key of Object.keys(sum) as (keyof Row)[]) sum[key] += counts[key] ?? 0;
      this.hosts.set(host, sum);
    }
  }

  /** The totals the run is judged on. */
  verdict(): { live: number; escaped: number; budget: number; failed: boolean } {
    const live = [...this.hosts.entries()].filter(([host]) => /(^|\.)demodb\.dev$/.test(host)).reduce((sum, [, counts]) => sum + counts.live, 0);
    const escaped = [...this.hosts.values()].reduce((sum, counts) => sum + counts.escaped, 0);
    const budget = this.mode === 'live' ? Number(process.env['DEMODB_E2E_MAX_RUN_LIVE_REQUESTS'] || 120) : 0;
    return { live, escaped, budget, failed: escaped > 0 || live > budget };
  }

  async onEnd(): Promise<{ status: 'failed' } | undefined> {
    const rows = [...this.hosts.entries()].sort(([a], [b]) => a.localeCompare(b));
    const { live, escaped, budget, failed } = this.verdict();
    const excludedNote = this.excluded.tests
      ? `${this.excluded.tests} negative-control test(s) not counted: ${this.excluded.total} request(s) asked, ${this.excluded.escaped} flagged as escaped`
      : '';
    const lane = process.env['GITHUB_JOB'] || process.env['DEMODB_REPORT_LANE'] || 'local';

    const lines = [
      `DemoDB request report (lane ${lane}, mode ${this.mode}, ${this.tests} guarded test attempts; LIVE = sent to the real host)`,
      `  ${'host'.padEnd(36)} ${'asked'.padStart(6)} ${'fixture'.padStart(8)} ${'memory'.padStart(7)} ${'LIVE'.padStart(5)} ${'refused'.padStart(8)} ${'ESCAPED'.padStart(8)}`,
      ...rows.map(
        ([host, c]) =>
          `  ${host.padEnd(36)} ${String(c.total).padStart(6)} ${String(c.fixture).padStart(8)} ${String(c.memo).padStart(7)} ${String(c.live).padStart(5)} ${String(c.refused).padStart(8)} ${String(c.escaped).padStart(8)}`,
      ),
      `  live requests to *.demodb.dev: ${live} (run budget ${budget}); requests that escaped the guard: ${escaped}`,
      ...(excludedNote ? [`  ${excludedNote}`] : []),
    ];
    console.log(['', ...lines, ''].join('\n'));

    const markdown = [
      `### DemoDB request report: ${lane}`,
      '',
      `Mode \`${this.mode}\`, ${this.tests} guarded test attempts. **Live requests to \`*.demodb.dev\`: ${live}** (budget ${budget}). **Escaped the guard: ${escaped}.**${excludedNote ? ` (${excludedNote})` : ''}`,
      '',
      '| host | asked | fixture | memory | LIVE | refused | escaped |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...rows.map(([host, c]) => `| ${host} | ${c.total} | ${c.fixture} | ${c.memo} | ${c.live} | ${c.refused} | ${c.escaped} |`),
      ...(rows.length === 0 ? ['| (no DemoDB request was made) | 0 | 0 | 0 | 0 | 0 | 0 |'] : []),
      '',
    ].join('\n');
    try {
      if (process.env['GITHUB_STEP_SUMMARY']) appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `${markdown}\n`);
      const file =
        process.env['DEMODB_REPORT_FILE'] ||
        (process.env['GITHUB_JOB'] && process.env['GITHUB_WORKSPACE']
          ? `${process.env['GITHUB_WORKSPACE']}/coverage/demodb-request-report-${process.env['GITHUB_JOB']}-${process.pid}.md`
          : undefined);
      if (file) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, markdown);
      }
    } catch (error) {
      console.error(`DemoDB request report could not be written: ${(error as Error).message}`);
    }

    if (failed) {
      console.error(`DemoDB request rules broken: ${escaped} escaped, ${live} live (budget ${budget})`);
      return { status: 'failed' };
    }
    return undefined;
  }

  printsToStdio(): boolean {
    return false;
  }
}
