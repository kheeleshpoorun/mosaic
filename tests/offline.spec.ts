import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { SONG_NAME, SONG_SLUG, STEM_COUNT, openSong } from './helpers';

/** The built worker that `vite preview` serves. */
const SW_FILE = path.resolve(import.meta.dirname, '../dist/sw.js');

/** URLs saved in the app's stem cache. */
function savedStemUrls(page: Page) {
  return page.evaluate(async () => (await (await caches.open('mosaic-stems')).keys()).map((r) => r.url));
}

test('opening a library song saves its stems on the device', async ({ page }) => {
  await openSong(page);
  await expect.poll(async () => (await savedStemUrls(page)).length).toBe(STEM_COUNT);
  // Keyed by a content hash, so a changed stem is fetched again.
  for (const url of await savedStemUrls(page)) expect(url).toMatch(/\/library\/.+\?v=[0-9a-f]{8}$/);
  // Share links don't change.
  expect(page.url()).toMatch(new RegExp(`\\?song=${SONG_SLUG}$`));
});

test('a saved song opens without the network', async ({ page }) => {
  await openSong(page);
  await expect.poll(async () => (await savedStemUrls(page)).length).toBe(STEM_COUNT);

  let requests = 0;
  await page.route('**/library/**', (route) => {
    requests += 1;
    return route.abort();
  });
  await page.reload();
  await expect(page.locator('.transport__play')).toBeEnabled({ timeout: 45_000 });
  expect(requests).toBe(0);
});

test('an unsaved song explains that the device is offline', async ({ page, context }) => {
  await page.goto('./');
  await context.setOffline(true);
  await page.locator('.song-row__main', { hasText: SONG_NAME }).click();
  await expect(page.getByRole('alertdialog', { name: 'Error' })).toContainText("You're offline");
});

test('songs can be downloaded for offline and removed again', async ({ page }) => {
  await page.goto('./');
  const row = page.locator('.song-row', { hasText: SONG_NAME });
  await row.getByRole('button', { name: 'Download for offline' }).click();
  await expect(row.getByRole('button', { name: 'Remove download' })).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.song-list', { hasText: 'Library' })).toContainText('1 saved for offline');
  expect(await savedStemUrls(page)).toHaveLength(STEM_COUNT);

  await row.getByRole('button', { name: 'Remove download' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove download' });
  await expect(dialog).toContainText(SONG_NAME);
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(row.getByRole('button', { name: 'Download for offline' })).toBeVisible();
  expect(await savedStemUrls(page)).toHaveLength(0);
});

test.describe('service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('the app and a saved song open with no connection', async ({ page, context }) => {
    await openSong(page);
    await expect.poll(async () => (await savedStemUrls(page)).length).toBe(STEM_COUNT);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.player__title')).toHaveText(SONG_NAME);
    await expect(page.locator('.transport__play')).toBeEnabled({ timeout: 45_000 });
  });

  test('the cached page only loads files the same cache holds', async ({ page }) => {
    await page.goto('./');
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
    const missing = await page.evaluate(async () => {
      const key = (await caches.keys()).find((k) => k.startsWith('mosaic-shell-'))!;
      const cache = await caches.open(key);
      const html = await (await cache.match('/mosaic/index.html'))!.text();
      const refs = [...html.matchAll(/(?:src|href)="(\/mosaic\/assets\/[^"]+)"/g)].map((m) => m[1]);
      const out: string[] = [];
      for (const ref of refs) if (!(await cache.match(ref, { ignoreVary: true }))) out.push(ref);
      return { refs: refs.length, out };
    });
    expect(missing.refs).toBeGreaterThan(0);
    expect(missing.out).toEqual([]);
  });

  test('an update replaces a broken shell without waiting for the Reload banner', async ({ page }) => {
    await page.goto('./');
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
    // A shell whose page points at a script that is gone (a stale index.html saved by an earlier version).
    await page.evaluate(async () => {
      const cache = await caches.open('mosaic-shell-stale');
      await cache.put('/mosaic/index.html', new Response('<script type="module" src="/mosaic/assets/gone.js"></script>'));
    });
    // The next deploy. page.route never sees the browser's fetch of the worker script, so change the served file.
    const original = fs.readFileSync(SW_FILE, 'utf8');
    fs.writeFileSync(SW_FILE, `${original}\n// next deploy\n`);
    try {
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
      await expect
        .poll(() => page.evaluate(async () => (await caches.keys()).includes('mosaic-shell-stale')), { timeout: 45_000 })
        .toBe(false);
    } finally {
      fs.writeFileSync(SW_FILE, original);
    }
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(false);
    await expect(page.getByText('Drop your stems here')).toBeVisible();
  });

  test('the manifest makes the app installable', async ({ page }) => {
    await page.goto('./');
    const href = await page.locator('link[rel=manifest]').getAttribute('href');
    expect(href).toBe('/mosaic/manifest.webmanifest');
    const manifest = await (await page.request.get(href!)).json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect((await page.request.get('./sw.js')).ok()).toBe(true);
  });
});
