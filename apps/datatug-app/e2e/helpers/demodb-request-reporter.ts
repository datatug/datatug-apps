import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Reporter, TestCase } from '@playwright/test/reporter';
import type { HostCounts } from './demodb-guard';

type Row = HostCounts;

/**
 * Prints, at the end of a run, how many requests went to each *.demodb.dev / OpenVaultDB host: asked for by the browser
 * (asked), answered from fixtures, from the live memo, sent to the real host (LIVE), refused, and ESCAPED (reached the network instead of being
 * answered locally: a real server address, or a failed name lookup / connection). The same table goes to $GITHUB_STEP_SUMMARY (Nx truncates
 * long job logs, the summary does not) and to DEMODB_REPORT_FILE when set. It fails the run when anything escaped, and in
 * live mode when the live total exceeds DEMODB_E2E_MAX_RUN_LIVE_REQUESTS (default 120).
 */
export default class DemodbRequestReporter implements Reporter {
  private readonly hosts = new Map<string, Row>();
  private mode = process.env['DEMODB_E2E_MODE'] === 'live' ? 'live' : 'fixture';
  private tests = 0;

  onTestEnd(test: TestCase): void {
    const note = test.annotations.filter((annotation) => annotation.type === 'demodb-requests').at(-1);
    if (!note?.description) return;
    this.tests += 1;
    const parsed = JSON.parse(note.description) as { mode: string; hosts: Record<string, Row> };
    this.mode = parsed.mode;
    for (const [host, counts] of Object.entries(parsed.hosts)) {
      const sum = this.hosts.get(host) ?? { total: 0, handled: 0, fixture: 0, memo: 0, live: 0, refused: 0, escaped: 0 };
      for (const key of Object.keys(sum) as (keyof Row)[]) sum[key] += counts[key] ?? 0;
      this.hosts.set(host, sum);
    }
  }

  async onEnd(): Promise<{ status: 'failed' } | undefined> {
    const rows = [...this.hosts.entries()].sort(([a], [b]) => a.localeCompare(b));
    const demodb = rows.filter(([host]) => /(^|\.)demodb\.dev$/.test(host));
    const live = demodb.reduce((sum, [, counts]) => sum + counts.live, 0);
    const escaped = rows.reduce((sum, [, counts]) => sum + counts.escaped, 0);
    const budget = this.mode === 'live' ? Number(process.env['DEMODB_E2E_MAX_RUN_LIVE_REQUESTS'] || 120) : 0;
    const lane = process.env['GITHUB_JOB'] || process.env['DEMODB_REPORT_LANE'] || 'local';

    const lines = [
      `DemoDB request report (lane ${lane}, mode ${this.mode}, ${this.tests} guarded test attempts; LIVE = sent to the real host)`,
      `  ${'host'.padEnd(36)} ${'asked'.padStart(6)} ${'fixture'.padStart(8)} ${'memory'.padStart(7)} ${'LIVE'.padStart(5)} ${'refused'.padStart(8)} ${'ESCAPED'.padStart(8)}`,
      ...rows.map(
        ([host, c]) =>
          `  ${host.padEnd(36)} ${String(c.total).padStart(6)} ${String(c.fixture).padStart(8)} ${String(c.memo).padStart(7)} ${String(c.live).padStart(5)} ${String(c.refused).padStart(8)} ${String(c.escaped).padStart(8)}`,
      ),
      `  live requests to *.demodb.dev: ${live} (run budget ${budget}); requests that escaped the guard: ${escaped}`,
    ];
    console.log(['', ...lines, ''].join('\n'));

    const markdown = [
      `### DemoDB request report: ${lane}`,
      '',
      `Mode \`${this.mode}\`, ${this.tests} guarded test attempts. **Live requests to \`*.demodb.dev\`: ${live}** (budget ${budget}). **Escaped the guard: ${escaped}.**`,
      '',
      '| host | asked | fixture | memory | LIVE | refused | escaped |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...rows.map(([host, c]) => `| ${host} | ${c.total} | ${c.fixture} | ${c.memo} | ${c.live} | ${c.refused} | ${c.escaped} |`),
      ...(rows.length === 0 ? ['| (no DemoDB request was made) | 0 | 0 | 0 | 0 | 0 | 0 |'] : []),
      '',
    ].join('\n');
    try {
      if (process.env['GITHUB_STEP_SUMMARY']) appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `${markdown}\n`);
      const file = process.env['DEMODB_REPORT_FILE'];
      if (file) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, markdown);
      }
    } catch (error) {
      console.error(`DemoDB request report could not be written: ${(error as Error).message}`);
    }

    if (escaped > 0 || live > budget) {
      console.error(`DemoDB request rules broken: ${escaped} escaped, ${live} live (budget ${budget})`);
      return { status: 'failed' };
    }
    return undefined;
  }

  printsToStdio(): boolean {
    return false;
  }
}
