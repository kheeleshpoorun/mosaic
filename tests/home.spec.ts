import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { APP_VERSION } from '../src/version';
import { SONG_NAME, SONG_SLUG, STEM_COUNT } from './helpers';

const LIBRARY = path.resolve(import.meta.dirname, '../library');

test('home lists the library songs', async ({ page }) => {
  await page.goto('./');
  const row = page.locator('.song-row', { hasText: SONG_NAME });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`${STEM_COUNT} stems`);
  await expect(row.getByRole('button', { name: 'Copy share link' })).toBeVisible();
});

test('footer shows the version and credit', async ({ page }) => {
  await page.goto('./');
  const footer = page.locator('.footer');
  await expect(footer).toContainText(`v${APP_VERSION}`);
  await expect(footer).toContainText('Made with');
  await expect(footer).toContainText('by Kheelesh Poorun');
  await expect(footer.locator('.footer__heart')).toBeVisible();
});

test('version file matches package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8'));
  expect(APP_VERSION).toBe(pkg.version);
});

test('opening a library song from home updates the URL', async ({ page }) => {
  await page.goto('./');
  await page.locator('.song-row__main', { hasText: SONG_NAME }).click();
  await expect(page).toHaveURL(/\?song=tujhe-kitna-chahein-aur-hum$/);
  await expect(page.locator('.player__title')).toHaveText(SONG_NAME);
  await page.getByRole('button', { name: 'Back to songs' }).click();
  await expect(page.locator('.dropzone')).toBeVisible();
});

test('unknown song link falls back to home', async ({ page }) => {
  await page.goto('./?song=does-not-exist');
  await expect(page.locator('.toast')).toHaveText('Song not found');
  await expect(page.locator('.dropzone')).toBeVisible();
});

test('importing stems names the song from the file names and plays it', async ({ page }) => {
  await page.goto('./');
  const files = fs.readdirSync(LIBRARY).filter((f) => f.endsWith('.mp3'));
  await page.locator('input[type=file]').setInputFiles(files.map((f) => path.join(LIBRARY, f)));

  await expect(page).toHaveURL(/\?import=/);
  await expect(page.locator('.player__title')).toHaveText(SONG_NAME);
  await expect(page.locator('.stem-row')).toHaveCount(files.length);
  await expect(page.locator('.transport__play')).toBeEnabled({ timeout: 45_000 });

  await page.getByRole('button', { name: 'Back to songs' }).click();
  await expect(page.locator('.song-list', { hasText: 'Imported' })).toContainText(SONG_NAME);
});

test('loading progress shows in a modal over a blurred backdrop', async ({ page }) => {
  // Hold back the stems so the modal stays up long enough to inspect.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/library\/.+\.(mp3|m4a|wav|ogg|flac|aac)$/i, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`./?song=${SONG_SLUG}`, { waitUntil: 'commit' });

  const backdrop = page.locator('.modal-backdrop');
  const dialog = backdrop.getByRole('dialog', { name: 'Loading' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.loader__song')).toHaveText(SONG_NAME);
  await expect(dialog.getByRole('progressbar')).toBeVisible();
  await expect(dialog.locator('.loader__quip')).not.toBeEmpty();
  // One icon chip per stem; the two being fetched (decode concurrency) are marked active.
  await expect(dialog.locator('.loader__stem')).toHaveCount(STEM_COUNT);
  await expect(dialog.locator('.loader__stem--fetching')).toHaveCount(2);
  await expect(dialog.locator('.loader__stem--done')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/loading-modal.png' });
  expect(await backdrop.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('blur');

  release();
  await expect(page.locator('.transport__play')).toBeEnabled({ timeout: 45_000 });
  await expect(backdrop).toHaveCount(0);
});
