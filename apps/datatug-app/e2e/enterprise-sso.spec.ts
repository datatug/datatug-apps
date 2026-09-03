import { expect, test } from '@playwright/test';

const projectID = 'demo-local-sneat-app';
const authBase = 'http://127.0.0.1:9099';
const firestoreBase = 'http://127.0.0.1:8180';
const ssoBase = 'http://127.0.0.1:8090';
const email = 'alice@acme.test';
const password = 'alice-firebase-password';
const oidcPassword = 'alice-oidc-password';
const oidcIssuer = process.env['SSO_E2E_OIDC_ISSUER'] ?? `${ssoBase}/oidc`;
const oidcClientID = process.env['SSO_E2E_OIDC_CLIENT_ID'] ?? 'datatug-e2e';
const oidcClientSecret =
  process.env['SSO_E2E_OIDC_CLIENT_SECRET'] ?? 'e2e-client-secret';
const usingKeycloak = oidcIssuer.includes('/realms/');
const samlUsername = 'alice';
const samlPassword = 'alice-saml-password';
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

async function signOut(page: import('@playwright/test').Page): Promise<void> {
  const signOutButton = page.getByTitle('Sign-out');
  if (!(await signOutButton.isVisible())) {
    await page
      .locator('ion-menu')
      .evaluate((menu: HTMLElement & { open: () => Promise<boolean> }) =>
        menu.open(),
      );
  }
  await signOutButton.click();
  await expect(page.getByText('Please sign in', { exact: true })).toBeVisible();
}

async function signInOIDC(
  page: import('@playwright/test').Page,
): Promise<void> {
  if (usingKeycloak) {
    const outcome = await Promise.race([
      page
        .locator('#username')
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => 'credentials' as const),
      page
        .waitForURL(
          (url) =>
            url.hostname === '127.0.0.1' &&
            url.port === '4200' &&
            (url.pathname === '/' ||
              url.pathname === '/sso/callback' ||
              url.searchParams.get('activated') === '1'),
          { timeout: 20_000 },
        )
        .then(() => 'existing-session' as const),
    ]);
    if (outcome === 'existing-session') {
      return;
    }
    await expect(page.locator('#kc-page-title')).toContainText('Sign in');
    await page.locator('#username').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('#kc-login').click();
    return;
  }
  await expect(
    page.getByRole('heading', { name: 'Acme test identity provider' }),
  ).toBeVisible();
  await page.locator('input[name="username"]').fill(email);
  await page.locator('input[name="password"]').fill(oidcPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('unknown domain onboarding activates SSO and reuses the existing Firebase/Sneat user', async ({
  page,
}) => {
  test.setTimeout(usingKeycloak ? 240_000 : 120_000);
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
    .getByRole('button', { name: 'Continue with regular sign up' })
    .click();
  await expect(page).toHaveURL(
    /\/login#\/sso\/setup\?domain=newcompany\.test$/,
  );

  await page.locator('ion-segment-button[value="in"]').click();
  await page.locator('ion-input[name="email"] input').fill(email);
  await page.locator('ion-input[type="password"] input').fill(password);
  await page.getByRole('button', { name: /Sign in.*with password/ }).click();
  const setupHeading = page.getByRole('heading', {
    name: 'Choose the organisation that owns SSO',
  });
  const continueAfterLogin = page.getByRole('button', {
    name: 'Continue',
    exact: true,
  });
  await expect(setupHeading.or(continueAfterLogin)).toBeVisible({
    timeout: 20_000,
  });
  if (await continueAfterLogin.isVisible()) {
    await continueAfterLogin.click();
  }
  await expect(page).toHaveURL(
    /^http:\/\/127\.0\.0\.1:4200\/sso\/setup\?domain=newcompany\.test$/,
    { timeout: 20_000 },
  );
  await expect(setupHeading).toBeVisible();
  await page.getByText('Acme Corporation').click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${spaceID}/settings/sso`));

  await page.getByRole('button', { name: 'Generic OIDC' }).click();
  await page.locator('ion-input[name="email-domain"] input').fill('acme.test');
  await page
    .getByRole('button', { name: 'Continue to domain verification' })
    .click();
  await expect(
    page.getByRole('heading', { name: '2. Prove control of acme.test' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Check DNS record' }).click();
  await expect(
    page.getByRole('heading', { name: '3. Connect OIDC' }),
  ).toBeVisible();
  await page.locator('ion-input[name="issuer"] input').fill(oidcIssuer);
  await page.locator('ion-input[name="client-id"] input').fill(oidcClientID);
  await page
    .locator('ion-input[name="client-secret"] input')
    .fill(oidcClientSecret);
  await page
    .locator('ion-input[name="login-host"] input')
    .fill('acme.datatug.test');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(
    page.getByRole('heading', { name: '4. Test and manage SSO' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Test & Activate SSO' }).click();

  await signInOIDC(page);
  await expect(page).toHaveURL(
    new RegExp(`/spaces/${spaceID}/settings/sso\\?activated=1$`),
  );
  await expect(
    page.getByText('SSO was tested successfully and is now active.'),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('active', { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  const activated = (await (
    await fetch(`${ssoBase}/__test/state`)
  ).json()) as Record<string, unknown>;
  expect(activated.domainSpaceID).toBe(spaceID);
  expect(activated.hostSpaceID).toBe(spaceID);
  expect(activated.linkedUserID).toBe('');

  await signOut(page);

  await page.goto('/sso');
  await page.locator('ion-input[name="work-email"] input').fill(email);
  await page.getByRole('button', { name: 'Continue with SSO' }).click();
  const sessionExchange = page.waitForResponse((response) =>
    response.url().endsWith('/v0/sso/session/exchange'),
  );
  await signInOIDC(page);

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

  // Reconfigure the same space for SAML. This also exercises disable/release,
  // DNS proof, signed SP-initiated SAML, and cross-protocol account reuse.
  await page.goto(`/spaces/${spaceID}/settings/sso`);
  await page.getByRole('button', { name: 'Disable SSO' }).click();
  await expect(
    page.getByText('SSO is disabled. Regular sign-in remains available.'),
  ).toBeVisible();
  const disabledDiscovery = await expectOK(
    await fetch(`${ssoBase}/v0/sso/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
    'discover disabled SSO',
  );
  expect(
    ((await disabledDiscovery.json()) as { configured: boolean }).configured,
  ).toBe(false);

  await page
    .getByRole('button', { name: 'Edit or rotate credentials' })
    .click();
  await page.getByRole('button', { name: 'Back', exact: true }).last().click();
  await page.getByRole('button', { name: 'SAML 2.0' }).click();
  await page
    .getByRole('button', { name: 'Continue to domain verification' })
    .click();
  await page.getByRole('button', { name: 'Check DNS record' }).click();
  await expect(
    page.getByRole('heading', { name: '3. Connect SAML' }),
  ).toBeVisible();
  const idpMetadata = await (
    await expectOK(
      await fetch(`${ssoBase}/__test/saml-metadata`),
      'load SAML IdP metadata',
    )
  ).text();
  await page
    .locator('ion-textarea[name="saml-idp-metadata"] textarea')
    .fill(idpMetadata);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Test & Activate SSO' }).click();
  await expect(
    page.getByRole('heading', { name: 'Acme SAML identity provider' }),
  ).toBeVisible();
  await page.locator('input[name="user"]').fill(samlUsername);
  await page.locator('input[name="password"]').fill(samlPassword);
  await page.getByRole('button', { name: 'Sign in with SAML' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/spaces/${spaceID}/settings/sso\\?activated=1$`),
  );
  await expect(
    page.getByText('SSO was tested successfully and is now active.'),
  ).toBeVisible({ timeout: 20_000 });

  await signOut(page);
  await page.context().clearCookies();
  await page.goto('/sso');
  await page.locator('ion-input[name="work-email"] input').fill(email);
  await page.getByRole('button', { name: 'Continue with SSO' }).click();
  await expect(
    page.getByRole('heading', { name: 'Acme SAML identity provider' }),
  ).toBeVisible();
  await page.locator('input[name="user"]').fill(samlUsername);
  await page.locator('input[name="password"]').fill(samlPassword);
  const samlSessionExchange = page.waitForResponse((response) =>
    response.url().endsWith('/v0/sso/session/exchange'),
  );
  await page.getByRole('button', { name: 'Sign in with SAML' }).click();
  expect((await samlSessionExchange).status()).toBe(200);
  await expect(page).toHaveURL('http://127.0.0.1:4200/');

  const samlCompleted = (await (
    await fetch(`${ssoBase}/__test/state`)
  ).json()) as Record<string, unknown>;
  expect(samlCompleted.routeProtocol).toBe('saml');
  expect(samlCompleted.samlLinkedUserID).toBe(existing.uid);
  expect(samlCompleted.lastTokenUID).toBe(existing.uid);
  expect(samlCompleted.userCount).toBe(1);
  expect(samlCompleted.membershipCount).toBe(1);
  expect(Number(samlCompleted.auditEventCount)).toBeGreaterThan(8);
});
