import { BrowserContext, Page } from '@playwright/test';
import { DEMODB_HOST, expect } from './demodb-guard';

/** Every request any page or worker of the context makes to demodb.dev. */
export function trackDemodbRequests(context: BrowserContext): string[] {
  const urls: string[] = [];
  context.on('request', (request) => {
    if (DEMODB_HOST.test(new URL(request.url()).hostname)) urls.push(request.url());
  });
  return urls;
}

/** Whether this browser context gives pages OPFS (asked of the browser itself, on the app's origin). */
export async function hasOpfs(page: Page): Promise<boolean> {
  await page.goto('/demo/sqlite');
  await expect(page.getByTestId('demo-sqlite-datasets')).toBeVisible();
  return page.evaluate(async () => {
    try {
      await navigator.storage.getDirectory();
      return true;
    } catch {
      return false;
    }
  });
}
