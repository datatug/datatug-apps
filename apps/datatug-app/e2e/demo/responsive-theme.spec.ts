import { mkdirSync } from 'node:fs';
import { expect, HERO, testNoStack as test, useStaticData, waitForAnswer } from './fixtures';

const SIZES = [{ name: '390', width: 390, height: 844 }, { name: '768', width: 768, height: 1024 }, { name: '1440', width: 1440, height: 900 }];

for (const scheme of ['light', 'dark'] as const) {
  for (const size of SIZES) {
    test(`${size.name} wide, ${scheme}: trace and answer visible, no horizontal scroll`, async ({ page }) => {
      test.setTimeout(90_000);
      await useStaticData(page);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(HERO);
      await waitForAnswer(page);
      await page.getByTestId('followup-insight').click();
      await expect(page.getByTestId('trace-step').first()).toBeVisible();
      await expect(page.getByTestId('demo-grid')).toBeVisible();
      await expect(page.getByTestId('demo-chart')).toBeVisible();
      const overflow = await page.evaluate(() => {
        const main = document.querySelector('main.demo') as HTMLElement;
        return { page: document.documentElement.scrollWidth - window.innerWidth, main: main.scrollWidth - main.clientWidth };
      });
      expect(overflow.page).toBeLessThanOrEqual(0);
      expect(overflow.main).toBeLessThanOrEqual(0);

      const dir = process.env['DEMO_SCREENSHOT_DIR'];
      if (dir) {
        mkdirSync(dir, { recursive: true });
        const shot = async (name: string): Promise<void> => {
          await page.waitForTimeout(500);
          await page.screenshot({ path: `${dir}/demo-${size.name}-${scheme}-${name}.png` });
        };
        // Playwright scrolls whichever ancestor it needs (Ionic's page containers included): put them all back.
        const questionTop = (): Promise<number> => page.evaluate(() => {
          const next = (node: Element): Element | null => node.assignedSlot ?? node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null;
          for (let node: Element | null = document.querySelector('.question'); node; node = next(node)) if (node.scrollTop) node.scrollTop = 0;
          window.scrollTo(0, 0);
          return (document.querySelector('.question') as HTMLElement).getBoundingClientRect().top;
        });
        await expect.poll(questionTop).toBeGreaterThanOrEqual(56);
        await shot('top');
        await page.getByTestId('trace-step').nth(6).getByRole('button').click();
        await page.getByTestId('trace-step').nth(6).scrollIntoViewIfNeeded();
        await shot('evidence');
        await page.getByTestId('demo-result').scrollIntoViewIfNeeded();
        await shot('result');
        await page.getByTestId('keep').scrollIntoViewIfNeeded();
        await shot('follow-up');
      }
    });
  }
}
