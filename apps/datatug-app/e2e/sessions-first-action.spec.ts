import { expect, test } from './helpers/demodb-guard';

const project =
  '/project/github.com/datatug/datatug-demo-project/demo-project-1';

test('canonical public demo Sessions starts with the read-only sample journey at wide and narrow widths', async ({
  page,
}) => {
  const workspaceRequests: string[] = [];
  page.on('request', (request) => {
    if (
      /\/datatug\/(session-context|incidents)(\/|$)/.test(
        new URL(request.url()).pathname,
      )
    ) {
      workspaceRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${project}/-/sessions`);
    await expect(
      page.getByRole('heading', { name: 'Sample Sessions' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Customer coverage investigation' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: /Sign in to start private Sessions demo|Open private Sessions demo/,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('Sign in to view or create sessions for this project.'),
    ).toHaveCount(0);
  }

  expect(workspaceRequests).toEqual([]);
});
