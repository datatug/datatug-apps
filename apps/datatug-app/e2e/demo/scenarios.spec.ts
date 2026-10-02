import { expect, handoff, OVDB, QUESTION, test, testNoStack } from './fixtures';

testNoStack.describe('no scenario this release can run', () => {
  testNoStack('an unknown scenario with a question shows the question and the three curated scenarios', async ({ page }) => {
    const sourceRequests: string[] = [];
    page.on('request', (request) => { if (request.url().startsWith(OVDB)) sourceRequests.push(request.url()); });
    await page.goto(handoff({ scenario: 'something-else', q: 'How many invoices were paid in 2012?', lang: 'en' }));
    await expect(page).toHaveURL(/\/demo$/);
    await expect(page.getByTestId('question')).toContainText('How many invoices were paid in 2012?');
    await expect(page.getByTestId('chooser-notice')).toContainText('“something-else” is not a scenario this demo knows');
    await expect(page.getByTestId('demo-chooser')).toContainText('Free-form questions need the next release');
    const cards = page.locator('[data-scenario]');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText(QUESTION);
    await expect(cards.nth(0).getByRole('button')).toBeVisible();
    await expect(cards.nth(1)).toContainText('Not in this release');
    await expect(cards.nth(2)).toContainText('Not in this release');
    await expect(page.getByTestId('trace-step')).toHaveCount(0);
    expect(sourceRequests).toEqual([]); // nothing was run, and nothing costs money
  });

  testNoStack('scenario=custom says free-form questions need the next release', async ({ page }) => {
    await page.goto(handoff({ scenario: 'custom', q: 'Anything I like', lang: 'en' }));
    await expect(page.getByTestId('chooser-notice')).toContainText('Free-form questions arrive in the next release');
    await expect(page.getByTestId('question')).toContainText('Anything I like');
  });

  testNoStack('a question that matches nothing, with no scenario', async ({ page }) => {
    await page.goto(handoff({ q: 'What is the meaning of life?' }));
    await expect(page.getByTestId('chooser-notice')).toContainText('cannot answer arbitrary questions yet');
    await expect(page.getByTestId('trace-step')).toHaveCount(0);
  });

  testNoStack('a curated scenario this release cannot run yet', async ({ page }) => {
    await page.goto(handoff({ scenario: 'jazz-artists', q: 'Which artists are most popular with customers who buy jazz?' }));
    await expect(page.getByTestId('chooser-notice')).toContainText('not in this release yet');
  });
});

test.describe('scenarios that run', () => {
  test('a recognised question without a scenario runs the saved plan; choosing a scenario runs it too', async ({ page }) => {
    await page.goto(handoff({ q: 'Music sales per capita by country' }));
    await expect(page.getByTestId('row-count')).toHaveText('24 rows', { timeout: 60_000 });
    await expect(page.getByTestId('trace-step').first()).toContainText('Recognised your question');

    await page.evaluate(async () => { for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name); });
    await page.goto('/demo');
    await expect(page.getByTestId('chooser-notice')).toContainText('Choose where to start');
    await page.locator('[data-scenario="countries-music-per-capita"]').getByRole('button').click();
    await expect(page.getByTestId('row-count')).toHaveText('24 rows', { timeout: 60_000 });
  });

  test('a scenario with other wording says the wording was not matched', async ({ page }) => {
    await page.goto(handoff({ scenario: 'countries-music-per-capita', q: 'who spends most on tunes?' }));
    await expect(page.getByTestId('row-count')).toHaveText('24 rows', { timeout: 60_000 });
    await expect(page.getByTestId('question')).toContainText('who spends most on tunes?');
    await expect(page.getByTestId('trace-step').first()).toContainText('Your wording was not matched');
  });
});
