import { expect, test } from '@playwright/test';

const card = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Install Mosaic' });

/** Fires a stand-in for Chrome's beforeinstallprompt; window.__prompted counts prompt() calls. */
async function offerInstall(page: import('@playwright/test').Page, outcome: 'accepted' | 'dismissed') {
  await page.evaluate((outcome) => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & Record<string, unknown>;
    const w = window as unknown as { __prompted: number };
    w.__prompted = 0;
    e.prompt = async () => {
      w.__prompted += 1;
    };
    e.userChoice = Promise.resolve({ outcome });
    window.dispatchEvent(e);
  }, outcome);
}

test('no install card where the browser offers no way to install', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.dropzone')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test('the install button opens the browser install dialog, then the card goes away', async ({ page }) => {
  await page.goto('./');
  await offerInstall(page, 'accepted');
  await expect(card(page)).toContainText('play saved songs offline');
  await card(page).getByRole('button', { name: 'Install' }).click();
  await expect(card(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1);
});

test('dismissing the card is remembered', async ({ page }) => {
  await page.goto('./');
  await offerInstall(page, 'dismissed');
  await card(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(card(page)).toHaveCount(0);

  await page.reload();
  await offerInstall(page, 'dismissed');
  await expect(page.locator('.dropzone')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test.describe('iPhone', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });

  test('shows how to add Mosaic to the home screen', async ({ page }) => {
    await page.goto('./');
    await expect(card(page)).toContainText('Add to Home Screen');
    await expect(card(page).getByRole('button', { name: 'Install' })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/install-card-ios.png' });
  });

  test('says nothing once it runs from the home screen', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
    await page.goto('./');
    await expect(page.locator('.dropzone')).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  });
});
