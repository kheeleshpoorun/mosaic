import { expect, test } from '@playwright/test';
import { SONG_NAME, STEM_COUNT, clickSeek, elapsed, engineState, openSong, parseTime, syncReport } from './helpers';

test.beforeEach(async ({ page }) => {
  await openSong(page);
});

test('share link opens the player directly', async ({ page }) => {
  await expect(page.locator('.player__title')).toHaveText(SONG_NAME);
  await expect(page.locator('.stem-row')).toHaveCount(STEM_COUNT);
  // Removed features stay removed.
  await expect(page.locator('.chips')).toHaveCount(0);
  await expect(page.getByText('Loop')).toHaveCount(0);
  await expect(page.locator('.footer')).toContainText('by Kheelesh Poorun');
});

test('loading modal closes once the stems are decoded', async ({ page }) => {
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
});

test('play advances time and pause stops it', async ({ page }) => {
  await page.locator('.transport__play').click();
  await expect.poll(async () => (await engineState(page)).position).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Pause' }).click();
  const paused = (await engineState(page)).position;
  await page.waitForTimeout(500);
  expect((await engineState(page)).position).toBeCloseTo(paused, 2);
});

test('all stems start together and share one playback rate', async ({ page }) => {
  await page.locator('.transport__play').click();
  await clickSeek(page, 0.4);
  const report = await syncReport(page);
  expect(report.sources).toHaveLength(STEM_COUNT);
  expect(report.sources.every((s) => s !== null && s.rate === 1)).toBe(true);
});

test('seeking while paused jumps to the clicked position', async ({ page }) => {
  const { duration } = await engineState(page);
  await clickSeek(page, 0.5);
  await expect.poll(async () => (await engineState(page)).position).toBeGreaterThan(duration * 0.45);
  expect((await engineState(page)).position).toBeLessThan(duration * 0.55);
  expect(parseTime(await elapsed(page).textContent())).toBeGreaterThan(duration * 0.45);
});

test('seeking while playing jumps and keeps playing', async ({ page }) => {
  const { duration } = await engineState(page);
  await page.locator('.transport__play').click();
  await page.waitForTimeout(500);

  // Drag the thumb rather than click, like a user scrubbing.
  const box = (await page.locator('.seek .slider').boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, y, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await engineState(page)).position).toBeGreaterThan(duration * 0.2);
  const after = parseTime(await elapsed(page).textContent());
  expect(after).toBeGreaterThan(duration * 0.2);
  // UI keeps following the playhead after the seek.
  await expect.poll(async () => parseTime(await elapsed(page).textContent())).toBeGreaterThan(after);
});

test('skip buttons move 5 seconds', async ({ page }) => {
  await clickSeek(page, 0.5);
  const start = (await engineState(page)).position;
  await page.getByRole('button', { name: 'Forward 5 seconds' }).click();
  expect((await engineState(page)).position).toBeCloseTo(start + 5, 0);
  await page.getByRole('button', { name: 'Back 5 seconds' }).click();
  expect((await engineState(page)).position).toBeCloseTo(start, 0);
});

test('tapping a stem icon mutes it', async ({ page }) => {
  const row = page.locator('.stem-row').last();
  await row.locator('.stem-row__icon').click();
  await expect(row).toHaveClass(/stem-row--off/);
  await expect(row.locator('.stem-row__slash')).toBeVisible();
  expect((await engineState(page)).stems.at(-1)!.muted).toBe(true);

  await row.locator('.stem-row__icon').click();
  await expect(row).not.toHaveClass(/stem-row--off/);
});

test('solo from the stem menu silences the other stems', async ({ page }) => {
  await page.locator('.stem-row').first().locator('.stem-row__menu').click();
  await page.getByRole('button', { name: 'Solo' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.stem-row--off')).toHaveCount(STEM_COUNT - 1);
  await expect(page.locator('.stem-row').first()).not.toHaveClass(/stem-row--off/);

  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Reset mix' }).click();
  await expect(page.locator('.stem-row--off')).toHaveCount(0);
});

test('volume slider changes the stem volume', async ({ page }) => {
  const slider = page.locator('.stem-row').first().locator('.slider');
  const box = (await slider.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
  await expect.poll(async () => (await engineState(page)).stems[0].volume).toBeLessThan(0.4);
});

test('metronome tracks the beats of the song and can be switched on', async ({ page }) => {
  await page.getByRole('button', { name: 'Metronome' }).click();
  await expect(page.getByText('Follows the song')).toBeVisible({ timeout: 30_000 });
  const { bpm, beats } = (await engineState(page)).metronome;
  // The sample song is ~80 BPM. The old fixed-grid detector fell back to 120 on it.
  expect(bpm).toBeGreaterThan(78);
  expect(bpm).toBeLessThan(83);
  expect(beats!.length).toBeGreaterThan(300);

  const toggle = page.getByRole('switch', { name: 'Metronome click' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
});

test('metronome nudge, beat-is-here and manual tempo', async ({ page }) => {
  await page.getByRole('button', { name: 'Metronome' }).click();
  await expect(page.getByText('Follows the song')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Increase offset' }).click();
  await expect.poll(async () => (await engineState(page)).metronome.offset).toBeCloseTo(0.01, 3);

  // Manual tempo switches to a fixed grid.
  const { bpm } = (await engineState(page)).metronome;
  await page.getByRole('button', { name: 'Increase tempo' }).click();
  const m = (await engineState(page)).metronome;
  expect(m.beats).toBeNull();
  expect(m.bpm).toBe(Math.round(bpm) + 1);
  await expect(page.getByText('Fixed tempo')).toBeVisible();

  // …and "Follow the song" brings tracking back.
  await page.getByRole('button', { name: 'Follow the song' }).click();
  await expect(page.getByText('Follows the song')).toBeVisible({ timeout: 30_000 });
});

test('pitch and speed controls', async ({ page }) => {
  await page.getByRole('button', { name: 'Pitch and speed' }).click();
  await page.getByRole('button', { name: 'Increase pitch' }).click();
  await page.getByRole('button', { name: 'Decrease speed' }).click();
  await expect(page.locator('.stepper__value').first()).toHaveText('+1');
  await expect(page.locator('.stepper__value').nth(1)).toHaveText('95%');
  const state = await engineState(page);
  expect(state.pitch).toBe(1);
  expect(state.speed).toBe(0.95);

  // Speed change while playing keeps all stems on the same rate.
  await page.keyboard.press('Escape');
  await page.locator('.transport__play').click();
  await expect.poll(async () => (await syncReport(page)).sources.every((s) => !!s && Math.abs(s.rate - 0.95) < 1e-3)).toBe(true);
});

test('space bar toggles playback', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect.poll(async () => (await engineState(page)).playing).toBe(true);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await engineState(page)).playing).toBe(false);
});
