import { expect, test } from '@playwright/test';

const projectID = 'demo-local-sneat-app';
const authBase = 'http://127.0.0.1:9099';
const firestoreBase = 'http://127.0.0.1:8180';
const ssoBase = 'http://127.0.0.1:8090';
const email = 'alice@acme.test';
const password = 'alice-firebase-password';
const oidcPassword = 'alice-oidc-password';
const spaceID = 'space_acme';

interface SeededUser {
  readonly uid: string;
}

async function expectOK(
  response: Response,
  operation: string,
): Promise<Response> {
  if (!response.ok) {
    throw new Error(
      `${operation} failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  return response;
}

async function resetEmulators(): Promise<void> {
  await expectOK(
    await fetch(`${authBase}/emulator/v1/projects/${projectID}/accounts`, {
      method: 'DELETE',
    }),
    'reset Auth emulator',
  );
  await expectOK(
    await fetch(
      `${firestoreBase}/emulator/v1/projects/${projectID}/databases/(default)/documents`,
      { method: 'DELETE' },
    ),
    'reset Firestore emulator',
  );
}

async function seedExistingFirebaseAndSneatUser(): Promise<SeededUser> {
  const authResponse = await expectOK(
    await fetch(
      `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=e2e`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    ),
    'create existing Firebase user',
  );
  const auth = (await authResponse.json()) as { localId: string };
  const userDocument = {
    fields: {
      title: { stringValue: 'Alice Acme' },
      email: { stringValue: email },
      emailIsVerified: { booleanValue: true },
      names: {
        mapValue: {
          fields: {
            firstName: { stringValue: 'Alice' },
            lastName: { stringValue: 'Acme' },
          },
        },
      },
      spaceIDs: { arrayValue: { values: [{ stringValue: spaceID }] } },
      spaces: {
        mapValue: {
          fields: {
            [spaceID]: {
              mapValue: {
                fields: {
                  title: { stringValue: 'Acme Corporation' },
                  type: { stringValue: 'company' },
                  roles: {
                    arrayValue: {
                      values: [
                        { stringValue: 'owner' },
                        { stringValue: 'admin' },
                      ],
                    },
                  },
                  userContactID: { stringValue: 'contact_owner' },
                },
              },
            },
          },
        },
      },
    },
  };
  await expectOK(
    await fetch(
      `${firestoreBase}/v1/projects/${projectID}/databases/(default)/documents/users/${auth.localId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userDocument),
      },
    ),
    'seed canonical Sneat user',
  );
  await expectOK(
    await fetch(`${ssoBase}/__test/seed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userID: auth.localId, email, spaceID }),
    }),
    'seed SSO host adapters',
  );
  return { uid: auth.localId };
}

test('unknown domain onboarding activates SSO and reuses the existing Firebase/Sneat user', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await resetEmulators();
  const existing = await seedExistingFirebaseAndSneatUser();

  await page.goto('/sso');
  await expect(
    page.getByRole('heading', { name: 'Sign in with company SSO' }),
  ).toBeVisible();
  await page
    .locator('ion-input[name="work-email"] input')
    .fill('alex@newcompany.test');
  await page.getByRole('button', { name: 'Continue with SSO' }).click();
  await expect(
    page.getByText('SSO is not configured for newcompany.test yet.'),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Continue with regular sign up' })
    .click();
  await expect(page).toHaveURL(
    /\/login#\/sso\/setup\?domain=newcompany\.test$/,
  );

  await page.locator('ion-segment-button[value="in"]').click();
  await page.locator('ion-input[name="email"] input').fill(email);
  await page.locator('ion-input[type="password"] input').fill(password);
  await page.getByRole('button', { name: /Sign in.*with password/ }).click();
  await expect(page).toHaveURL(/\/sso\/setup\?domain=newcompany\.test$/, {
    timeout: 20_000,
  });
  await expect(
    page.getByRole('heading', {
      name: 'Choose the organisation that owns SSO',
    }),
  ).toBeVisible();
  await page.getByText('Acme Corporation').click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${spaceID}/settings/sso`));

  await page.locator('ion-input[name="email-domain"] input').fill('acme.test');
  await page.locator('ion-input[name="issuer"] input').fill(`${ssoBase}/oidc`);
  await page.locator('ion-input[name="client-id"] input').fill('datatug-e2e');
  await page
    .locator('ion-input[name="client-secret"] input')
    .fill('e2e-client-secret');
  await page
    .locator('ion-input[name="login-host"] input')
    .fill('acme.datatug.test');
  await page.getByRole('button', { name: 'Test & Activate SSO' }).click();

  await expect(
    page.getByRole('heading', { name: 'Acme test identity provider' }),
  ).toBeVisible();
  await page.locator('input[name="username"]').fill(email);
  await page.locator('input[name="password"]').fill(oidcPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/spaces/${spaceID}/settings/sso\\?activated=1$`),
  );
  await expect(
    page.getByText('SSO was tested successfully and is now active.'),
  ).toBeVisible();
  await expect(page.getByText('active', { exact: true })).toBeVisible();

  const activated = (await (
    await fetch(`${ssoBase}/__test/state`)
  ).json()) as Record<string, unknown>;
  expect(activated.domainSpaceID).toBe(spaceID);
  expect(activated.hostSpaceID).toBe(spaceID);
  expect(activated.linkedUserID).toBe('');

  const signOut = page.getByTitle('Sign-out');
  if (!(await signOut.isVisible())) {
    await page
      .locator('ion-menu')
      .evaluate((menu: HTMLElement & { open: () => Promise<boolean> }) =>
        menu.open(),
      );
  }
  await signOut.click();
  await expect(page.getByText('Please sign in', { exact: true })).toBeVisible();

  await page.goto('/sso');
  await page.locator('ion-input[name="work-email"] input').fill(email);
  await page.getByRole('button', { name: 'Continue with SSO' }).click();
  await expect(
    page.getByRole('heading', { name: 'Acme test identity provider' }),
  ).toBeVisible();
  await page.locator('input[name="username"]').fill(email);
  await page.locator('input[name="password"]').fill(oidcPassword);
  const sessionExchange = page.waitForResponse((response) =>
    response.url().endsWith('/v0/sso/session/exchange'),
  );
  await page.getByRole('button', { name: 'Sign in' }).click();

  expect((await sessionExchange).status()).toBe(200);

  await expect(page).toHaveURL('http://127.0.0.1:4200/');
  await expect(
    page.getByRole('heading', { name: 'Your data workbench' }),
  ).toBeVisible();
  const completed = (await (
    await fetch(`${ssoBase}/__test/state`)
  ).json()) as Record<string, unknown>;
  expect(completed.linkedUserID).toBe(existing.uid);
  expect(completed.lastTokenUID).toBe(existing.uid);
  expect(completed.userCount).toBe(1);
  expect(completed.membershipCount).toBe(1);
  expect(completed.sneatUserEnsureCount).toBe(1);
});
