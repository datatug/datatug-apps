import { test as base, expect } from '@playwright/test';
import { TEST_CHECKOUT_ORIGIN } from '../../src/app/checkout/checkout-config.mjs';

const origin = 'http://datatug.localhost:4328';
const project = 'sneat-eur3-1';
/** Normal dedicated-account authentication; never admin tokens or impersonation.
 * Passwords are injected privately by CI/local environment, never persisted.
 * Failure messages deliberately contain neither identity nor response bodies. */
export const test = base.extend<{ signedInTestBuyer: void }>({
  signedInTestBuyer: [
    async ({ page, context }, use, testInfo) => {
      if (
        process.env.DATATUG_CHECKOUT_PROVIDER_TEST !== '1' ||
        testInfo.project.use.trace !== 'off' ||
        testInfo.project.use.video !== 'off' ||
        testInfo.project.use.screenshot !== 'off'
      )
        throw new Error(
          'Dedicated TEST authentication requires explicit opt-in and disabled traces, video and screenshots.',
        );
      const expectedUID = process.env.DATATUG_CHECKOUT_TEST_BUYER_UID;
      const email = process.env.DATATUG_CHECKOUT_TEST_EMAIL;
      const password = process.env.DATATUG_CHECKOUT_TEST_PASSWORD;
      if (
        !expectedUID ||
        (!process.env.DATATUG_CHECKOUT_TEST_STORAGE_STATE &&
          (!email || !password))
      )
        throw new Error(
          'Dedicated TEST buyer credentials and expected UID are required. No interactive fallback.',
        );
      // Hold all checkout traffic until the identity and Firebase project agree.
      let verified = false;
      await page.route('**/v0/checkout/**', async (route) => {
        if (
          !verified ||
          new URL(route.request().url()).origin !== TEST_CHECKOUT_ORIGIN
        )
          await route.abort();
        else await route.continue();
      });
      await page.route('**/api.stripe.com/**', async (route) => {
        if (
          /\/(?:payment_intents|setup_intents)\/[^/]+\/confirm(?:\?|$)/.test(
            route.request().url(),
          )
        )
          await route.abort();
        else await route.continue();
      });
      await page.route(
        /(?:sentry\.io|posthog\.com|google-analytics\.com)/,
        (route) => route.abort(),
      );
      await page.goto(
        `${origin}/checkout/sign-in?plan=pro&period=monthly&checkout=test`,
      );
      try {
        if (!process.env.DATATUG_CHECKOUT_TEST_STORAGE_STATE) {
          await page.locator('ion-segment-button[value="in"]').click();
          await page.locator('ion-input[name="email"] input').fill(email ?? '');
          await page
            .locator('ion-input[type="password"] input')
            .fill(password ?? '');
          await page
            .getByRole('button', { name: /Sign in.*with password/ })
            .click();
        }
        await expect
          .poll(
            async () => {
              const state = await context.storageState({ indexedDB: true });
              return state.origins
                .flatMap((o) =>
                  (o.indexedDB ?? []).flatMap((db) =>
                    db.stores.flatMap((store) =>
                      store.records.map((record) => {
                        const user = record.value?.value;
                        try {
                          const jwt = user?.stsTokenManager?.accessToken;
                          const claims = JSON.parse(
                            Buffer.from(
                              jwt.split('.')[1],
                              'base64url',
                            ).toString(),
                          );
                          return (
                            user.uid === expectedUID &&
                            user.isAnonymous === false &&
                            claims.sub === expectedUID &&
                            claims.aud === project &&
                            claims.iss ===
                              `https://securetoken.google.com/${project}`
                          );
                        } catch {
                          return false;
                        }
                      }),
                    ),
                  ),
                )
                .some(Boolean);
            },
            {
              message:
                'Dedicated TEST buyer identity and Firebase project must match',
              timeout: 20000,
            },
          )
          .toBe(true);
      } catch {
        // Playwright fill failures may include the supplied value in their
        // call log. Never propagate that error or attach its cause.
        throw new Error(
          'Dedicated TEST authentication failed. Check the private fixture credentials and expected UID.',
        );
      }
      // Destroy the temporary auth route before admitting checkout traffic.
      // Its Pro continuation must not create a second, unintended quote.
      await page.goto('about:blank');
      verified = true;
      await use();
    },
    { auto: false },
  ],
});
export { expect } from '@playwright/test';
