import { expect, test } from './helpers/demodb-guard';

test('home composition introduces DataTug, the public demo, and two other entry points', async ({
  page,
}) => {
  await page.goto('/');

  const hero = page.getByTestId('home-hero');
  await expect(hero).toBeVisible();
  await expect(
    hero.getByRole('heading', { name: 'Ask better questions of your data.' }),
  ).toBeVisible();
  await expect(hero.locator('.hero-visual')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  // The gray header item is a direct child of the card: Ionic's md-mode
  // ion-list adds 8px of padding, which showed as a white strip above it.
  await expect(hero.locator('ion-item[color="light"]')).toHaveCount(1);
  await expect(hero.locator('ion-list')).toHaveCount(0);
  const headerGap = await hero.evaluate((card) => {
    const header = card.querySelector(':scope > ion-item[color="light"]');
    if (!header) {
      return -1;
    }
    return (
      header.getBoundingClientRect().top - card.getBoundingClientRect().top
    );
  });
  expect(headerGap).toBe(0);

  // The My projects rows keep their ion-list (only the header moved out), so
  // the card-scoped rule must still strip Ionic's md 8px list padding.
  const rowsList = page.locator('sneat-datatug-my-projects ion-list').first();
  const rowsPaddingTop = await rowsList.evaluate(
    (list) => getComputedStyle(list).paddingTop,
  );
  expect(rowsPaddingTop).toBe('0px');

  const demo = page.locator('[data-demo-slot="GitHub"]');
  await expect(demo.locator('.demo-visual')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await expect(demo).toContainText('project structure');
  await expect(demo).toContainText('three saved Chinook SQL examples');
  await expect(
    demo.getByRole('button', { name: 'Open public demo' }),
  ).toBeVisible();
  await expect(page.locator('[data-demo-slot="Cloud"]')).toHaveCount(0);

  const stores = page.locator('sneat-datatug-my-stores');
  await expect(stores).toContainText('Fastest setup');
  await expect(stores).toContainText('version history and branches');
  await expect(stores).toContainText('offline use where supported');

  const block = page.getByTestId('platform-block');
  await expect(
    block.getByRole('heading', { name: 'Other ways to use DataTug' }),
  ).toBeVisible();
  await expect(block.locator('.part')).toHaveCount(2);
  await expect(block.locator('[data-part="terminal"]')).toContainText('TugQL');
  await expect(block.locator('[data-part="terminal"]')).toContainText(
    'datatug CLI',
  );
  await expect(block.locator('[data-part="agent"]')).toContainText(
    'CLI skills',
  );
  await expect(block.locator('[data-part="agent"]')).toContainText(
    'Claude Code',
  );
  await expect(
    block.locator('[data-part="agent"] [data-status="available"]'),
  ).toHaveCount(1);
  await expect(
    block.locator('[data-part="agent"] [data-status="planned"]'),
  ).toHaveCount(2);
});

test('the home sections keep the landing, other ways, and project cards in order', async ({
  page,
}) => {
  await page.goto('/');
  const content = page.locator('sneat-datatug-home ion-content');
  const hero = content.getByTestId('home-hero');
  const platform = content.getByTestId('platform-block');
  const detective = content.getByRole('heading', {
    name: 'Record an Incident in a private project',
  });
  const projects = content.locator('.home-cards-grid');
  for (const section of [hero, projects, platform, detective]) {
    await expect(section).toBeVisible();
  }
  const order = await content.evaluate((element) => {
    const hero = element.querySelector('[data-testid="home-hero"]');
    const platform = element.querySelector('sneat-datatug-platform-block');
    const detective = element
      .querySelector('sneat-datatug-detective-demo-starter')
      ?.closest('ion-card');
    const projects = element.querySelector('.home-cards-grid');
    const precedes = (
      before: Element | null | undefined,
      after: Element | null | undefined,
    ) =>
      !!before &&
      !!after &&
      !!(
        before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    return {
      heroBeforeProjects: precedes(hero, projects),
      projectsBeforePlatform: precedes(projects, platform),
      platformBeforeDetective: precedes(platform, detective),
    };
  });
  expect(order).toEqual({
    heroBeforeProjects: true,
    projectsBeforePlatform: true,
    platformBeforeDetective: true,
  });
});

for (const width of [360, 390, 768, 1280]) {
  test(`home composition does not overflow horizontally at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByTestId('home-hero')).toBeVisible();
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
        parts: parts.map((part) => {
          const rect = part.getBoundingClientRect();
          return Math.max(
            part.scrollWidth - part.clientWidth,
            rect.right - window.innerWidth,
            -rect.left,
          );
        }),
      };
    });
    expect(overflow.page).toBeLessThanOrEqual(0);
    expect(overflow.scroller).not.toBe(-1);
    expect(overflow.scroller).toBeLessThanOrEqual(0);
    expect(overflow.parts).toHaveLength(2);
    for (const amount of overflow.parts) expect(amount).toBeLessThanOrEqual(0);
  });
}

test('the home footer credits DALgo next to the build info, as a keyboard-focusable link', async ({
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
