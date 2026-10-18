import { type Page, type TestInfo, expect } from '@playwright/test';

/**
 * The environment variables the Business project preview journey needs. The
 * values are the designated TEST buyer's normal email/password sign-in. They
 * are never hardcoded, persisted, printed or attached to a report.
 */
export const BUSINESS_PREVIEW_BUYER_EMAIL_ENV =
  'DATATUG_BUSINESS_PREVIEW_BUYER_EMAIL';
export const BUSINESS_PREVIEW_BUYER_PASSWORD_ENV =
  'DATATUG_BUSINESS_PREVIEW_BUYER_PASSWORD';
/** Optional: when set, the signed-in Firebase uid must equal it. */
export const BUSINESS_PREVIEW_BUYER_UID_ENV =
  'DATATUG_BUSINESS_PREVIEW_BUYER_UID';
/** Optional: overrides the pinned project, `<repository>@<owner>@<folder>`. */
export const BUSINESS_PREVIEW_PROJECT_ENV = 'DATATUG_BUSINESS_PREVIEW_PROJECT';

/** What datatug-cloud-preview pins today (plan: product-cloud-runtimes, Task 21). */
export const DEFAULT_BUSINESS_PREVIEW_PROJECT =
  'datatug-pro-launch-test@trakhimenok@r11-browser-demo';

/** True when both credentials are present. Reads names only, never prints values. */
export const hasBusinessPreviewBuyer = (): boolean =>
  !!process.env[BUSINESS_PREVIEW_BUYER_EMAIL_ENV] &&
  !!process.env[BUSINESS_PREVIEW_BUYER_PASSWORD_ENV];

export const BUSINESS_PREVIEW_SKIP_MESSAGE =
  `Set ${BUSINESS_PREVIEW_BUYER_EMAIL_ENV} and ${BUSINESS_PREVIEW_BUYER_PASSWORD_ENV} ` +
  `(the designated TEST buyer; optionally ${BUSINESS_PREVIEW_BUYER_UID_ENV}) to run the live Business preview journey.`;

/**
 * Refuses to run when anything could record the filled password: a trace,
 * video or screenshot (config or CLI such as `--trace on`), a reporter other
 * than the plain console ones (`--reporter html` attaches error context), or
 * Playwright API logging (`DEBUG=pw:api`). Call it before any sign-in.
 */
export function assertNoCredentialCapture(testInfo: TestInfo): void {
  const use = testInfo.project.use;
  const reporters = testInfo.config.reporter.map(([name]) => name);
  const debug = process.env['DEBUG'] ?? '';
  if (
    use.trace !== 'off' ||
    use.video !== 'off' ||
    use.screenshot !== 'off' ||
    reporters.some((name) => !['list', 'line', 'dot'].includes(name)) ||
    /pw:|playwright/.test(debug)
  )
    throw new Error(
      'The TEST buyer sign-in requires trace, video and screenshot off, a console-only reporter (list, line or dot) and no DEBUG=pw:*. Run it through playwright.business-preview.config.ts without those flags.',
    );
}

const FIREBASE_PROJECT = 'sneat-eur3-1';

/**
 * Signs the designated TEST buyer in through the app's normal email/password
 * form (the same sign-in panel the checkout page mounts), then leaves the page
 * on about:blank so no checkout continuation runs. The Firebase session stays
 * in the origin's IndexedDB for the next navigation.
 *
 * Failure messages deliberately contain neither the identity nor any response
 * body: the original error is destroyed with the page before a new one is thrown.
 */
export async function signInBusinessPreviewBuyer(page: Page): Promise<void> {
  const email = process.env[BUSINESS_PREVIEW_BUYER_EMAIL_ENV];
  const password = process.env[BUSINESS_PREVIEW_BUYER_PASSWORD_ENV];
  if (!email || !password) throw new Error(BUSINESS_PREVIEW_SKIP_MESSAGE);
  const expectedUID = process.env[BUSINESS_PREVIEW_BUYER_UID_ENV];

  await page.goto('/checkout/sign-in?plan=pro&period=monthly&checkout=test');
  try {
    await page.locator('ion-segment-button[value="in"]').click();
    await page.locator('ion-input[name="email"] input').fill(email);
    await page.locator('ion-input[type="password"] input').fill(password);
    await page.getByRole('button', { name: /Sign in.*with password/ }).click();
    await expect
      .poll(
        () =>
          page.evaluate(
            async ({ expectedUID, project }) => {
              const database = await new Promise<IDBDatabase | null>(
                (resolve) => {
                  const request = indexedDB.open('firebaseLocalStorageDb');
                  request.onupgradeneeded = () => request.transaction?.abort();
                  request.onerror = () => resolve(null);
                  request.onsuccess = () => resolve(request.result);
                },
              );
              if (!database) return false;
              try {
                if (!database.objectStoreNames.contains('firebaseLocalStorage'))
                  return false;
                const records = await new Promise<
                  Array<{
                    value?: {
                      uid?: string;
                      isAnonymous?: boolean;
                      stsTokenManager?: { accessToken?: string };
                    };
                  }>
                >((resolve, reject) => {
                  const request = database
                    .transaction('firebaseLocalStorage', 'readonly')
                    .objectStore('firebaseLocalStorage')
                    .getAll();
                  request.onsuccess = () => resolve(request.result);
                  request.onerror = () => reject(request.error);
                });
                return records.some((record) => {
                  const user = record.value;
                  try {
                    const jwt = user?.stsTokenManager?.accessToken;
                    if (!jwt || !user?.uid || user.isAnonymous !== false)
                      return false;
                    const claims = JSON.parse(
                      atob(
                        jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'),
                      ),
                    );
                    return (
                      (!expectedUID || user.uid === expectedUID) &&
                      claims.sub === user.uid &&
                      claims.aud === project &&
                      claims.iss === `https://securetoken.google.com/${project}`
                    );
                  } catch {
                    return false;
                  }
                });
              } finally {
                database.close();
              }
            },
            { expectedUID, project: FIREBASE_PROJECT },
          ),
        {
          message:
            'TEST buyer must be signed in to the production Firebase project',
          timeout: 30_000,
        },
      )
      .toBe(true);
  } catch {
    // Playwright fill failures may include the supplied value in their call
    // log and error-context snapshot. Destroy the auth view first.
    try {
      await page.goto('about:blank', { timeout: 5000 });
    } catch {
      await page.close().catch(() => undefined);
    }
    throw new Error(
      `TEST buyer sign-in failed. Check ${BUSINESS_PREVIEW_BUYER_EMAIL_ENV}, ${BUSINESS_PREVIEW_BUYER_PASSWORD_ENV} and ${BUSINESS_PREVIEW_BUYER_UID_ENV}.`,
    );
  }
  await page.goto('about:blank');
}
