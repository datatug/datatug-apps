import { expect, test } from './helpers/demodb-guard';
import { installFakeGithub } from './helpers/fake-github';

const project =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1';
const sessionExample = 'customer-coverage-investigation';
const fake = process.env['DATATUG_E2E_GITHUB_FAKE'];

test.beforeEach(async ({ context }) => {
  if (fake)
    await installFakeGithub(context, [
      { fullName: 'datatug/datatug-demo-project', dir: fake },
    ]);
});

for (const width of [1440, 900, 390]) {
  test(`public sample investigations link to runnable data and survive cold links at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${project}/-/sessions`);
    await expect(
      page.getByRole('heading', { name: 'Sample Sessions' }),
    ).toBeVisible();
    await page
      .getByRole('list', { name: 'Sample Sessions' })
      .getByRole('heading', {
        level: 2,
        name: 'Customer coverage investigation',
      })
      .click();
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Customer coverage investigation',
      }),
    ).toBeVisible();
    await expect(
      page.locator('article.public-demo-investigations ion-note.scope-note'),
    ).toContainText('no saved changes');
    await page
      .getByRole('link', { name: 'Back to Sessions' })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await page.getByRole('heading', { name: 'Customer inventory' }).click();
    await expect(page).toHaveURL(
      /query\/demodb%2Fchinook-customer-inventory\?id=demodb%2Fchinook-customer-inventory/,
    );
    await expect(
      page.getByRole('heading', {
        name: 'Chinook Customer Inventory',
        exact: true,
      }),
    ).toBeVisible();
      // The editor normalizes its URL in ionViewDidEnter after its entry animation.
      await expect(page).toHaveURL(/[?&]editor=text(?:&|$)/);
    await page.goBack();
      await expect(page).toHaveURL(/\/sessions\/examples\/customer-coverage-investigation$/);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Customer coverage investigation',
      }),
    ).toBeVisible();

    await page
      .getByRole('heading', { name: 'Verify customer coverage' })
      .click();
    await expect(page).toHaveURL(/checks\/chinook-customer-coverage/);
    await expect(
      page.locator('[data-public-check=chinook-customer-coverage]'),
    ).toBeVisible();
    await page.goBack();
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Customer coverage investigation',
      }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Back to Sessions' }).click();
    await expect(
      page.getByRole('heading', { name: 'Sample Sessions' }),
    ).toBeVisible();

    await page.goto(`${project}/-/sessions/examples/${sessionExample}`);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Customer coverage investigation',
      }),
    ).toBeVisible();
    await page.goto(`${project}/-/sessions/examples/not-a-sample`);
    await expect(
      page.getByRole('heading', { name: 'Sample Session unavailable' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Back to Sessions' }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Back to Sessions' }).click();
    if (width < 992)
      await page.locator('ion-menu-button.app-level-menu-button').click();
    await page.getByTestId('incidents-project-menu-item').click();
    await expect(page).toHaveURL(
      `${new URL(page.url()).origin}${project}/-/incidents`,
    );
    await expect(
      page.getByRole('heading', { name: 'Sample Incidents' }),
    ).toBeVisible();
    await page
      .getByRole('list', { name: 'Sample Incidents' })
      .getByRole('heading', {
        level: 2,
        name: 'Customer coverage is one below expected',
      })
      .click();
    await expect(
      page.locator('article.public-demo-investigations'),
    ).toContainText('not a fresh server result');
    await expect(
      page.locator('article.public-demo-investigations'),
    ).toContainText('Expected customers');
    await page.getByRole('link', { name: 'Back to Incidents' }).click();
    await expect(
      page.getByRole('heading', { name: 'Sample Incidents' }),
    ).toBeVisible();
    await page.goto(`${project}/-/incidents/examples/customer-coverage-gap`);
    const incident = page.getByRole('article');
    await expect(
      incident.getByRole('heading', {
        level: 1,
        name: 'Customer coverage is one below expected',
      }),
    ).toBeVisible();
    await incident
      .getByRole('button', {
        name: /Sign in to set up a private Incidents project|Set up private project for Incidents/,
      })
      .scrollIntoViewIfNeeded();
    await expect(incident).toContainText('web UI link');
    await page.goto(`${project}/-/incidents/examples/not-a-sample`);
    await expect(
      page.getByRole('heading', { name: 'Sample Incident unavailable' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Back to Incidents' }),
    ).toBeVisible();
  });
}

test('rapid browser Back from a linked query leaves the sample session interactive', async ({
  page,
}) => {
  await page.goto(`${project}/-/sessions/examples/${sessionExample}`);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Customer coverage investigation',
    }),
  ).toBeVisible();

  await page.getByRole('heading', { name: 'Customer inventory' }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Chinook Customer Inventory',
      exact: true,
    }),
  ).toBeVisible();

  // Exercise Back before ionViewDidEnter's editor=text URL normalization.
  await page.goBack({ waitUntil: 'commit' });
  await expect(page).toHaveURL(
    /\/sessions\/examples\/customer-coverage-investigation$/,
  );
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Customer coverage investigation',
    }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Back to Sessions' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sample Sessions' }),
  ).toBeVisible();
});
