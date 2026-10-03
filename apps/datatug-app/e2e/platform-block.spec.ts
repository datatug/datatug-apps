import { expect, test } from '@playwright/test';

// Founder, 2026-10-03: "I want user to be explained scope of project early. So I see that at all 3 DataTug sites."
// The home page's "One platform, four ways in." block (libs/datatug/main/src/lib/pages/home/platform-block) shows
// the four parts with the statuses datatug.io and datatug.ai show; the side menu credits DALgo under the build info
// (founder: "The dalgo credit can be given on DataTug.app as well").

test('the home page shows the four parts of the platform, with their statuses and links', async ({
  page,
}) => {
  await page.goto('/');
  const block = page.getByTestId('platform-block');
  await expect(block).toBeVisible();
  await expect(
    block.getByRole('heading', { name: 'One platform, four ways in.' }),
  ).toBeVisible();

  const parts = block.locator('.part');
  await expect(parts).toHaveCount(4);

  const app = block.locator('[data-part="app"]');
  await expect(app).toContainText('DataTug.app');
  await expect(app).toContainText('You are here');
  await expect(app.locator('a')).toHaveCount(0);
  await expect(app.locator('[data-status="available"]')).toHaveCount(1);

  const link = (id: string) =>
    block.locator(`[data-part="${id}"] a[data-part-link]`);
  await expect(link('terminal')).toHaveAttribute(
    'href',
    'https://datatug.io/apps/cli/',
  );
  await expect(link('skills')).toHaveAttribute(
    'href',
    'https://datatug.ai/skills/',
  );
  await expect(link('mcp-app')).toHaveAttribute(
    'href',
    'https://datatug.ai/#way-agent',
  );

  const terminal = block.locator('[data-part="terminal"]');
  await expect(terminal.locator('[data-status="available"]')).toHaveCount(1);

  const skills = block.locator('[data-part="skills"]');
  await expect(skills).toContainText('Skills plugin');
  await expect(skills).toContainText('MCP server');
  await expect(skills.locator('[data-status="available"]')).toHaveCount(1);
  await expect(skills.locator('[data-status="planned"]')).toHaveCount(1);

  const mcpApp = block.locator('[data-part="mcp-app"]');
  await expect(mcpApp).toContainText('MCP web app');
  await expect(mcpApp.locator('[data-status="planned"]')).toHaveCount(1);
});

test('the platform block sits after the lead card and before the project cards', async ({
  page,
}) => {
  await page.goto('/');
  const order = await page
    .locator('sneat-datatug-home ion-content')
    .evaluate((content) =>
      Array.from(content.children)
        .map((el) => el.tagName.toLowerCase())
        .filter(
          (tag) =>
            tag === 'ion-card' ||
            tag.startsWith('sneat-') ||
            tag === 'ion-grid',
        ),
    );
  expect(order.slice(0, 3)).toEqual([
    'ion-card',
    'sneat-datatug-platform-block',
    'ion-grid',
  ]);
});

for (const width of [360, 390, 768, 1280]) {
  test(`the platform block does not overflow horizontally at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const block = page.getByTestId('platform-block');
    await expect(block).toBeVisible();
    const overflow = await page.evaluate(() => {
      const scroller = document
        .querySelector('sneat-datatug-home ion-content')
        ?.shadowRoot?.querySelector('[part="scroll"]');
      const parts = Array.from(
        document.querySelectorAll('[data-testid="platform-block"] .part'),
      );
      return {
        page: document.documentElement.scrollWidth - window.innerWidth,
        scroller: scroller ? scroller.scrollWidth - scroller.clientWidth : -1,
        parts: parts.map((p) => {
          const r = p.getBoundingClientRect();
          return Math.max(
            p.scrollWidth - p.clientWidth,
            r.right - window.innerWidth,
            -r.left,
          );
        }),
      };
    });
    expect(overflow.page).toBeLessThanOrEqual(0);
    expect(overflow.scroller).not.toBe(-1); // the scroller was found, so the check below is not vacuous
    expect(overflow.scroller).toBeLessThanOrEqual(0);
    expect(overflow.parts).toHaveLength(4);
    for (const o of overflow.parts) expect(o).toBeLessThanOrEqual(0);
  });
}

test('the side menu credits DALgo next to the build info, as a keyboard-focusable link', async ({
  page,
}) => {
  await page.goto('/');
  const credit = page.getByTestId('powered-by-dalgo');
  await expect(credit).toBeVisible();
  await expect(credit).toHaveText(/Powered by DALgo/);
  await expect(credit).toHaveAttribute('href', 'https://dalgo.io');
  await expect(credit).toHaveAttribute('target', '_blank');
  await expect(credit).toHaveAttribute('rel', 'noopener');
  await expect(credit).toHaveAttribute(
    'aria-label',
    'Powered by DALgo, the database abstraction layer for Go',
  );
  await expect(page.locator('sneat-app-version')).toBeVisible();
  await credit.focus();
  await expect(credit).toBeFocused();
});

test('the incidentius profile shows no DALgo credit', async ({ page }) => {
  await page.goto('/?profile=incidentius');
  await expect(page).toHaveURL('/incidents');
  await expect(page.locator('sneat-app-version')).toBeVisible();
  await expect(page.getByTestId('powered-by-dalgo')).toHaveCount(0);
});
