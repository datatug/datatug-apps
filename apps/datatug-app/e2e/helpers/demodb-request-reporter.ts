import type { Reporter, TestCase } from '@playwright/test/reporter';
import type { HostCounts } from './demodb-guard';

/**
 * Prints, at the end of a run, how many requests went to each demodb.dev host: asked for by the browser/tests (total),
 * answered from local fixtures, answered from memory, and sent to the real host (live). Read it from CI logs for audits.
 * In live mode it also fails the run when the live total exceeds DEMODB_E2E_MAX_RUN_LIVE_REQUESTS (default 120).
 */
export default class DemodbRequestReporter implements Reporter {
  private readonly hosts = new Map<string, HostCounts>();
  private mode = process.env['DEMODB_E2E_MODE'] === 'live' ? 'live' : 'fixture';
  private tests = 0;

  onTestEnd(test: TestCase): void {
    const note = test.annotations.filter((annotation) => annotation.type === 'demodb-requests').at(-1);
    if (!note?.description) return;
    this.tests += 1;
    const parsed = JSON.parse(note.description) as { mode: string; hosts: Record<string, HostCounts> };
    this.mode = parsed.mode;
    for (const [host, counts] of Object.entries(parsed.hosts)) {
      const sum = this.hosts.get(host) ?? { total: 0, fixture: 0, memo: 0, live: 0 };
      sum.total += counts.total;
      sum.fixture += counts.fixture;
      sum.memo += counts.memo;
      sum.live += counts.live;
      this.hosts.set(host, sum);
    }
  }

  async onEnd(): Promise<{ status: 'failed' } | undefined> {
    const rows = [...this.hosts.entries()].sort(([a], [b]) => a.localeCompare(b));
    const live = rows.filter(([host]) => /(^|\.)demodb\.dev$/.test(host)).reduce((sum, [, counts]) => sum + counts.live, 0);
    const budget = this.mode === 'live' ? Number(process.env['DEMODB_E2E_MAX_RUN_LIVE_REQUESTS'] || 120) : 0;
    const lines = [
      '',
      `DemoDB request report (mode: ${this.mode}, ${this.tests} test attempts; LIVE = sent to the real host)`,
      `  ${'host'.padEnd(36)} ${'asked'.padStart(7)} ${'fixture'.padStart(8)} ${'memory'.padStart(7)} ${'LIVE'.padStart(6)}`,
      ...rows.map(
        ([host, counts]) =>
          `  ${host.padEnd(36)} ${String(counts.total).padStart(7)} ${String(counts.fixture).padStart(8)} ${String(counts.memo).padStart(7)} ${String(counts.live).padStart(6)}`,
      ),
      `  live requests to *.demodb.dev: ${live} (run budget ${budget})`,
      '',
    ];
    console.log(lines.join('\n'));
    if (live > budget) {
      console.error(`DemoDB live request budget exceeded: ${live} > ${budget}`);
      return { status: 'failed' };
    }
    return undefined;
  }

  printsToStdio(): boolean {
    return false;
  }
}
