import * as fs from 'node:fs';
import { expect, test } from './fixtures/real-stack';

for (const target of ['sqlite', 'ingitdb'] as const) {
  test(`${target}: query, explain, select, and update through the real protected stack`, async ({
    page,
    realStack,
  }) => {
    const daemonRequests: { url: string; token: string }[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith(realStack.agentOrigin + '/datatug/ovdb/')) {
        daemonRequests.push({
          url: request.url(),
          token: request.headers()['x-datatug-agent-token'] ?? '',
        });
      }
    });
    await page.goto(realStack.launchPath);
    await expect(page).toHaveURL((url) => url.hash === '');
    await expect(page.getByText('Query data', { exact: true })).toBeVisible();
    if (
      !(await page.getByLabel('Database').getAttribute('aria-label'))?.includes(
        `${target} ·`,
      )
    ) {
      await page.locator('ion-select[label="Database"]').click();
      await page
        .getByRole('radio', { name: new RegExp(`^${target}\\b`) })
        .click();
      await page.getByRole('button', { name: 'OK' }).click();
    }
    await page.getByRole('button', { name: 'Run query' }).click();
    await expect(page.getByRole('status')).toContainText(
      target === 'sqlite' ? '2 record(s)' : '1 record(s)',
    );
    await expect(page.getByText('Customer 03', { exact: false })).toBeVisible();
    await expect(page.getByText('hidden', { exact: true })).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Explain access', exact: true })
      .click();
    await expect(page.getByText('Access: conditional')).toBeVisible();
    await expect(
      page.getByText('Additional limits apply', { exact: false }).first(),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Check access for top 20' }).click();
    await expect(
      page.getByText('Sampled access', { exact: false }),
    ).toBeVisible();
    await page
      .getByText('Customer 03', { exact: false })
      .locator('xpath=ancestor::tr')
      .getByRole('button', { name: 'Select' })
      .click();
    await page
      .getByRole('button', { name: 'Explain access to this row' })
      .click();
    await expect(page.getByText('Access: allow')).toBeVisible();
    const changed = `Updated ${target}`;
    await page.getByLabel('New value (JSON or text)').fill(changed);
    await page.getByRole('button', { name: 'Save change' }).click();
    await expect(page.getByRole('status')).toHaveText('Row updated.');
    await page.getByRole('button', { name: 'Run query' }).click();
    await expect(page.getByText(changed, { exact: false })).toBeVisible();
    expect(daemonRequests.length).toBeGreaterThanOrEqual(6);
    expect(daemonRequests.every((request) => request.token.length >= 32)).toBe(
      true,
    );
    expect(
      daemonRequests.every((request) => !request.url.includes('agentToken')),
    ).toBe(true);
    for (const logFile of realStack.logFiles)
      expect(fs.readFileSync(logFile, 'utf8')).not.toContain(
        daemonRequests[0]?.token ?? 'unreachable-token',
      );
  });
}
