import { expect, test } from '@playwright/test';
import { analyserVersions } from '../scripts/analyser-versions';
import { SONG_NAME, SONG_SLUG, STEM_COUNT, clickSeek, elapsed, engineState, openSong, parseTime, syncReport } from './helpers';

test.beforeEach(async ({ page }) => {
  await openSong(page);
});

test('share link opens the player and desktop expands without changing mobile', async ({ page }) => {
  await expect(page.locator('.player__title')).toHaveText(SONG_NAME);
  await expect(page.locator('.stem-row')).toHaveCount(STEM_COUNT);
  // Removed features stay removed.
  await expect(page.locator('.chips')).toHaveCount(0);
  await expect(page.locator('.footer')).toContainText('by Kheelesh Poorun');

  const player = page.locator('.player');
  await page.setViewportSize({ width: 393, height: 844 });
  await expect(player).toHaveCSS('display', 'flex');
  expect((await player.boundingBox())!.width).toBeLessThanOrEqual(520);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(player).toHaveCSS('display', 'grid');
  const stems = await page.locator('.stems').boundingBox();
  const controls = await page.locator('.player__bottom').boundingBox();
  expect((await player.boundingBox())!.width).toBeGreaterThanOrEqual(1400);
  expect(stems).not.toBeNull();
  expect(controls).not.toBeNull();
  expect(controls!.x).toBeGreaterThan(stems!.x + stems!.width);

  await page.setViewportSize({ width: 393, height: 844 });
  await expect(player).toHaveCSS('display', 'flex');
  expect((await player.boundingBox())!.width).toBeLessThanOrEqual(520);
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

test('play switches the iOS audio session to playback so the silent switch does not mute it', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' }, configurable: true });
  });
  await openSong(page);
  await page.locator('.transport__play').click();
  await expect.poll(() => page.evaluate(() => (navigator as unknown as { audioSession: { type: string } }).audioSession.type)).toBe('playback');
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

test('solo mutes the other stems, and solo again unmutes them', async ({ page }) => {
  const first = page.locator('.stem-row').first();
  await first.locator('.stem-row__menu').click();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await expect(page.locator('.stem-row--off')).toHaveCount(STEM_COUNT - 1);
  await expect(first).not.toHaveClass(/stem-row--off/);
  const stems = (await engineState(page)).stems;
  expect(stems.map((s) => s.muted)).toEqual(stems.map((_, i) => i !== 0));

  // Already the only stem playing: the option now unmutes everything.
  await page.getByRole('button', { name: 'Unmute all' }).click();
  await expect(page.locator('.stem-row--off')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Solo', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // Soloing a muted stem unmutes it and mutes the rest.
  const last = page.locator('.stem-row').last();
  await last.locator('.stem-row__icon').click();
  await last.locator('.stem-row__menu').click();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.stem-row--off')).toHaveCount(STEM_COUNT - 1);
  await expect(last).not.toHaveClass(/stem-row--off/);
});

test('holding a stem icon solos it, holding again unmutes all', async ({ page }) => {
  const first = page.locator('.stem-row').first();
  const hold = async () => {
    await first.locator('.stem-row__icon').hover();
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
  };

  await hold();
  await expect(page.locator('.stem-row--off')).toHaveCount(STEM_COUNT - 1);
  // The click that ends the hold must not mute the soloed stem.
  await expect(first).not.toHaveClass(/stem-row--off/);
  expect((await engineState(page)).stems[0].muted).toBe(false);

  await hold();
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

test('metronome is delayed to match the pitch shifter, and not when it is bypassed', async ({ page }) => {
  expect((await syncReport(page)).musicDelay).toBe(0);
  await page.getByRole('button', { name: 'Pitch and speed' }).click();
  await page.getByRole('button', { name: 'Increase pitch' }).click();
  // SoundTouch's measured processing delay (~0.1–0.15 s) shifts every click by the same amount.
  await expect.poll(async () => (await syncReport(page)).musicDelay).toBeGreaterThan(0.05);
  expect((await syncReport(page)).musicDelay).toBeLessThan(0.2);
  await page.getByRole('button', { name: 'Decrease pitch' }).click();
  await expect.poll(async () => (await syncReport(page)).musicDelay).toBe(0);
});

test('space bar toggles playback', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect.poll(async () => (await engineState(page)).playing).toBe(true);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await engineState(page)).playing).toBe(false);
});

test('each stem shows a waveform that follows the playhead and the mute state', async ({ page }) => {
  const waves = page.locator('.stem-wave');
  await expect(waves).toHaveCount(STEM_COUNT);

  // Every base canvas has something drawn on it.
  const inked = await page.$$eval('.stem-wave__base', (canvases) =>
    canvases.map((c) => {
      const canvas = c as HTMLCanvasElement;
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let alpha = 0;
      for (let i = 3; i < data.length; i += 4) alpha += data[i];
      return canvas.width > 0 && alpha > 0;
    }),
  );
  expect(inked).toEqual(Array(STEM_COUNT).fill(true));

  // The played portion tracks the position.
  const progress = () => page.locator('.stems').evaluate((el) => parseFloat((el as HTMLElement).style.getPropertyValue('--progress')));
  expect(await progress()).toBe(0);
  await clickSeek(page, 0.5);
  await expect.poll(progress).toBeGreaterThan(40);

  // Muting flattens the stem's waveform.
  const row = page.locator('.stem-row').first();
  await row.locator('.stem-row__icon').click();
  await expect(row.locator('.stem-wave')).toHaveCSS('--level', '0.08');
});

test('waveforms can be hidden from the song menu, and the choice sticks', async ({ page }) => {
  await expect(page.locator('.stem-wave')).toHaveCount(STEM_COUNT);
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Hide waveforms' }).click();
  await expect(page.locator('.stem-wave')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.transport__play')).toBeEnabled({ timeout: 45_000 });
  await expect(page.locator('.stem-wave')).toHaveCount(0);

  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Show waveforms' }).click();
  await expect(page.locator('.stem-wave')).toHaveCount(STEM_COUNT);
});

test('the waveform highlight follows the seek bar while dragging', async ({ page }) => {
  const progress = () => page.locator('.stems').evaluate((el) => parseFloat((el as HTMLElement).style.getPropertyValue('--progress')));
  const box = (await page.locator('.seek .slider').boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 8 });

  // Mid-drag: the highlight has moved but the playhead hasn't.
  await expect.poll(progress).toBeGreaterThan(50);
  expect((await engineState(page)).position).toBeLessThan(1);

  await page.mouse.up();
  await expect.poll(async () => (await engineState(page)).position).toBeGreaterThan(0);
  const { duration, position } = await engineState(page);
  expect(await progress()).toBeCloseTo((position / duration) * 100, 0);
});

test('chord strip shows the key and the chords on top of the stems, and follows the playhead', async ({ page }) => {
  const chips = page.locator('.chords__chip');
  await expect.poll(() => chips.count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await expect(page.locator('.chords__key')).toHaveText(/^Key[A-G][♯♭]?m?$/);

  // Above the first stem row.
  const strip = (await page.locator('.chords').boundingBox())!;
  const firstStem = (await page.locator('.stem-row').first().boundingBox())!;
  expect(strip.y + strip.height).toBeLessThanOrEqual(firstStem.y);

  // Seeking scrolls the strip and highlights the chord under the playhead.
  const shift = () => page.locator('.chords__track').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  expect(await shift()).toBe(0);
  await clickSeek(page, 0.5);
  await expect.poll(shift).toBeLessThan(-1000);
  await expect(page.locator('.chords__chip--active')).toHaveCount(1);
});

test('the chord sheet shows the chart bar by bar, following playback, in names or numbers', async ({ page }) => {
  await expect.poll(() => page.locator('.chords__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await clickSeek(page, 0.5);
  await page.getByRole('button', { name: /^Chord chart/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Chords' });
  await expect(sheet.locator('.chord-now__name')).toHaveText(/^[A-G]/);
  await expect(sheet.locator('.chord-meta')).toHaveText(/^Key [A-G][♯♭]?m? · [34]\/4 · Bar \d+ of \d+$/);

  // Four bars a line, the current one lit with its beats; bars played again show a repeat sign.
  const bars = sheet.locator('.chord-chart__bar');
  expect(await bars.count()).toBeGreaterThan(40);
  await expect(sheet.locator('.chord-chart__bar.is-now')).toHaveCount(1);
  const meter = Number(/([34])\/4/.exec((await sheet.locator('.chord-meta').textContent())!)![1]);
  await expect(sheet.locator('.chord-chart__bar.is-now .chord-chart__beats span')).toHaveCount(meter);
  await expect(sheet.locator('.chord-chart__bar.is-now .chord-chart__beats .is-on')).toHaveCount(1);
  expect(await sheet.locator('.chord-chart__repeat svg').count()).toBeGreaterThan(0);
  await expect(sheet.locator('.chord-chart__num').first()).toHaveText('1');
  await expect(sheet.locator('.chord-chart__num').nth(1)).toHaveText('5');

  // Numbers: Roman numerals relative to the key, remembered.
  await sheet.getByRole('button', { name: 'Numbers' }).click();
  await expect(sheet.locator('.chord-now__name')).toHaveText(/^(♭|♯)?(I|II|III|IV|V|VI|VII|i|ii|iii|iv|v|vi|vii)(7|maj7)?$/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Chord chart/ }).click();
  await expect(sheet.getByRole('button', { name: 'Numbers' })).toHaveAttribute('aria-pressed', 'true');
});

test('tapping a chord chart bar or a song map progression seeks there', async ({ page }) => {
  await expect.poll(() => page.locator('.chords__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await page.getByRole('button', { name: /^Chord chart/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Chords' });

  await sheet.getByRole('button', { name: 'Bar 21', exact: true }).click();
  await expect(sheet.locator('.chord-meta')).toContainText('Bar 21 of');
  await expect(sheet.getByRole('button', { name: 'Bar 21', exact: true })).toHaveClass(/is-now/);

  const items = sheet.locator('.chord-map__item');
  expect(await items.count()).toBeGreaterThan(2);
  await expect(sheet.locator('.chord-map__item .drum-map__count', { hasText: /^×\d+$/ }).first()).toBeVisible();
  const target = items.nth(2);
  const first = Number((await target.locator('.drum-map__bars').textContent())!.split('–')[0]);
  await target.click();
  await expect(target).toHaveClass(/is-now/);
  await expect(sheet.locator('.chord-meta')).toContainText(`Bar ${first} of`);
});

test('the chord chart turns a page when playback leaves the view, and leaves a reader who scrolled away alone', async ({ page }) => {
  await expect.poll(() => page.locator('.chords__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await page.getByRole('button', { name: /^Chord chart/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Chords' });
  const body = sheet.locator('.sheet__body');
  const bars = sheet.locator('.chord-chart__bar');
  const scrollTop = () => body.evaluate((el) => el.scrollTop);
  // DOM clicks seek like a tap, without Playwright scrolling the bar into view first.
  const seekTo = (k: number) => bars.nth(k).evaluate((el) => (el as HTMLElement).click());
  const settle = () => page.waitForTimeout(800);
  await seekTo(0);
  await expect(bars.first()).toHaveClass(/is-now/);
  await settle();
  expect(await scrollTop()).toBe(0);

  // A bar on a line already in full view: the chart doesn't move (no creeping row by row).
  await seekTo(4);
  await expect(bars.nth(4)).toHaveClass(/is-now/);
  await settle();
  expect(await scrollTop()).toBe(0);

  // The first line that isn't fully in view: playing it turns the page, putting it under the header.
  const k = await sheet.locator('.chord-chart').evaluate((chart) => {
    const view = chart.closest('.sheet__body')!.getBoundingClientRect();
    const rows = [...chart.children].filter((_, i) => i % 4 === 0);
    return rows.findIndex((el) => el.getBoundingClientRect().bottom > view.bottom) * 4;
  });
  expect(k).toBeGreaterThan(0);
  await seekTo(k);
  const gap = () =>
    sheet.evaluate((el) => {
      const head = el.querySelector('.chord-head')!.getBoundingClientRect().bottom;
      return el.querySelector('.chord-chart__bar.is-now')!.getBoundingClientRect().top - head;
    });
  await expect.poll(gap).toBeGreaterThanOrEqual(0);
  await expect.poll(gap).toBeLessThan(12);

  // Scrolled down to the song map: playback moving on doesn't pull the reader back to the chart.
  await body.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await settle();
  const atMap = await scrollTop();
  expect(atMap).toBeGreaterThan(0);
  await seekTo(k + 8);
  await expect(bars.nth(k + 8)).toHaveClass(/is-now/);
  await settle();
  expect(await scrollTop()).toBe(atMap);
});

test('guitar and piano shapes of the song\'s chords are tucked away until opened', async ({ page }) => {
  await expect.poll(() => page.locator('.chords__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await clickSeek(page, 0.5);
  await page.getByRole('button', { name: /^Chord chart/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Chords' });
  await expect(sheet.locator('svg.guitar')).toHaveCount(0);

  const toggle = sheet.getByRole('button', { name: /^Chord shapes/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  const shapes = sheet.locator('.chord-shape');
  expect(await shapes.count()).toBeGreaterThan(2);
  expect(await sheet.locator('svg.guitar').count()).toBe(await shapes.count());
  await expect(sheet.locator('.chord-shape.is-now')).toHaveCount(1);
  await expect(sheet.locator('.chord-shape.is-now .chord-shape__name')).toHaveText((await sheet.locator('.chord-now__name').textContent())!);

  await sheet.getByRole('button', { name: 'Piano' }).click();
  expect(await sheet.locator('svg.piano').count()).toBe(await shapes.count());
  expect(await sheet.locator('.chord-shape.is-now .piano .is-on').count()).toBeGreaterThanOrEqual(3);

  // Stays open next time.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Chord chart/ }).click();
  await expect(sheet.getByRole('button', { name: /^Chord shapes/ })).toHaveAttribute('aria-expanded', 'true');
});

test('key and chord names follow the pitch, in the strip and in Pitch & speed', async ({ page }) => {
  await expect.poll(() => page.locator('.chords__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  const badge = page.locator('.chords__key span');
  const key = await badge.textContent();
  const firstChord = await page.locator('.chords__chip').first().textContent();

  // The key badge opens Pitch & speed, whose Key row names the key.
  await page.locator('.chords__key').click();
  await expect(page.locator('.key-label')).toHaveText(key!);
  await page.getByRole('button', { name: 'Increase pitch' }).click();
  await page.getByRole('button', { name: 'Increase pitch' }).click();
  await expect(page.locator('.key-label')).toHaveText(new RegExp(`^${key} → `));
  const transposed = (await page.locator('.key-label').textContent())!.split(' → ')[1];
  expect(transposed).not.toBe(key);

  await page.keyboard.press('Escape');
  await expect(badge).toHaveText(transposed);
  await expect(page.locator('.chords__chip').first()).not.toHaveText(firstChord!);
});

test('chords can be hidden from the song menu, and the choice sticks', async ({ page }) => {
  await expect(page.locator('.chords')).toBeVisible();
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Hide chords' }).click();
  await expect(page.locator('.chords')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.transport__play')).toBeEnabled({ timeout: 45_000 });
  await expect(page.locator('.chords')).toHaveCount(0);

  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Show chords' }).click();
  await expect(page.locator('.chords')).toBeVisible();
});

test('drum strip reads like a chart under the chord strip, and follows the playhead', async ({ page }) => {
  const chips = page.locator('.drums__chip');
  await expect.poll(() => chips.count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await expect(page.locator('.drums__badge')).toHaveText(/^\d+ BPM[34]\/4$/);
  // Every bar shows its own pattern: groove changes are marked, and bars that play the one before
  // again are drawn too, with a small 𝄎 tag rather than a repeat sign in place of the pattern.
  expect(await page.locator('.drums__chip--change .drums__mini').count()).toBeGreaterThan(0);
  const repeats = page.locator('.drums__chip--repeat');
  expect(await repeats.count()).toBeGreaterThan(0);
  expect(await repeats.locator('.drums__mini').count()).toBe(await repeats.count());
  expect(await repeats.locator('.drums__tag svg').count()).toBe(await repeats.count());
  expect(await page.locator('.drums__chip .drums__mini').count()).toBe(await chips.count());
  // Every drawn pattern (fills too, despite their tag) spans its whole bar, so hits line up with time.
  const spans = await page.locator('.drums__chip').evaluateAll((els) =>
    els.flatMap((chip) => {
      const mini = chip.querySelector('.drums__mini');
      if (!mini) return [];
      const c = chip.getBoundingClientRect();
      const m = mini.getBoundingClientRect();
      return [{ left: m.left - c.left, right: c.right - m.right }];
    }),
  );
  expect(spans.length).toBeGreaterThan(0);
  for (const { left, right } of spans) {
    expect(left).toBeLessThanOrEqual(2); // just the bar line
    expect(right).toBeLessThanOrEqual(0.5);
  }

  // Between the chord strip and the first stem row.
  const chords = (await page.locator('.chords').boundingBox())!;
  const strip = (await page.locator('.drums').boundingBox())!;
  const firstStem = (await page.locator('.stem-row').first().boundingBox())!;
  expect(strip.y).toBeGreaterThanOrEqual(chords.y + chords.height);
  expect(strip.y + strip.height).toBeLessThanOrEqual(firstStem.y);

  const shift = () => page.locator('.drums__track').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  expect(await shift()).toBe(0);
  await clickSeek(page, 0.5);
  await expect.poll(shift).toBeLessThan(-1000);
  await expect(page.locator('.drums__chip--active')).toHaveCount(1);
});

test('a stale drum result in storage is analysed again instead of breaking the drum sheet', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const key = `mosaic:drums:${analyserVersions(process.cwd()).drums}:${SONG_SLUG}`;
  const old = `mosaic:drums:v1:${SONG_SLUG}`;
  // Under the current key but with fewer lanes (as a broken or hand-edited entry would be), plus a
  // result from an older analyser under its old key.
  await page.addInitScript(
    ([key, old]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      const bar = { start: 0, end: 2, beats: [0, 0.5, 1, 1.5], kind: 'groove', groove: 0, repeat: false, steps: [[1, 0, 0, 0], [0, 0, 1, 0]] };
      const stale = JSON.stringify({ bars: [bar], meter: 4, division: 4, swing: false });
      localStorage.setItem(key, stale);
      localStorage.setItem(old, stale);
    },
    [key, old],
  );
  await page.reload();
  await expect.poll(() => page.locator('.drums__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await page.locator('.drums__view').click();
  await expect(page.getByRole('dialog', { name: 'Drums' })).toBeVisible();
  expect(errors).toEqual([]);

  // The fresh result replaced the broken one, and the old analyser's entry is gone.
  const stored = await page.evaluate(([key, old]) => [JSON.parse(localStorage.getItem(key)!).bars.length, localStorage.getItem(old)], [key, old]);
  expect(stored[0]).toBeGreaterThan(10);
  expect(stored[1]).toBeNull();
});

test('re-analyse song forgets the cached beats, chords, drums and bass and works them out again', async ({ page }) => {
  test.slow(); // every analysis runs twice
  await expect.poll(() => page.locator('.drums__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await expect.poll(() => page.locator('.chords__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await expect.poll(() => page.locator('.bass__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  const cached = () =>
    page.evaluate((slug) => Object.keys(localStorage).filter((k) => /^mosaic:(beats|chords|drums|bass):/.test(k) && k.endsWith(`:${slug}`)).length, SONG_SLUG);
  await expect.poll(cached).toBe(4);
  // A marker on the cached drums: re-analysing must replace it.
  await page.evaluate((slug) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('mosaic:drums:') && k.endsWith(`:${slug}`))!;
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)!), marker: true }));
  }, SONG_SLUG);

  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Re-analyse song' }).click();
  await expect(page.locator('.drums__status')).toContainText('Analysing drums');
  await expect.poll(() => page.locator('.drums__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await expect.poll(() => page.locator('.chords__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await expect.poll(() => page.locator('.bass__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await expect.poll(cached).toBe(4);
  const marker = await page.evaluate((slug) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('mosaic:drums:') && k.endsWith(`:${slug}`))!;
    return JSON.parse(localStorage.getItem(key)!).marker ?? null;
  }, SONG_SLUG);
  expect(marker).toBeNull();
});

test('the drum sheet shows this bar and the next, as a grid or as notation', async ({ page }) => {
  await expect.poll(() => page.locator('.drums__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await clickSeek(page, 0.5);
  await page.getByRole('button', { name: /^Drum part/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Drums' });
  await expect(sheet.locator('.chord-now__name')).toHaveText(/^Bar \d+$/);
  await expect(sheet.locator('.drum-feel')).toHaveText(/^[34]\/4 · (Straight|Shuffle)$/);

  const bars = sheet.locator('.drum-read__bar');
  await expect(bars).toHaveCount(2);
  await expect(bars.first().locator('.drum-read__caption')).toContainText('Now');
  await expect(bars.nth(1).locator('.drum-read__caption')).toContainText('Next');
  expect(await sheet.locator('.drum-grid__lane').count()).toBeGreaterThanOrEqual(6); // ≥ 3 drums × 2 bars
  await expect(bars.first().locator('.drum-grid__count').first()).toHaveText('1');
  expect(await bars.first().locator('.drum-grid__hit').count()).toBeGreaterThan(2);

  await sheet.getByRole('button', { name: 'Notation' }).click();
  await expect(sheet.locator('svg.notation')).toHaveCount(2);
  expect(await sheet.locator('svg.notation').first().locator('.notation__head').count()).toBeGreaterThan(2);
  await expect(sheet.locator('svg.notation').first().locator('.notation__line')).not.toHaveCount(0);

  // The choice sticks.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Drum part/ }).click();
  await expect(sheet.locator('svg.notation')).toHaveCount(2);
});

test('the drum sheet exports the complete score with the song title to PDF', async ({ page }) => {
  const drumPart = page.getByRole('button', { name: /^Drum part/ });
  await expect(drumPart).toBeEnabled({ timeout: 45_000 });
  await drumPart.click();
  await page.evaluate(() => {
    (window as Window & { printCalls?: number }).printCalls = 0;
    window.print = () => {
      (window as Window & { printCalls?: number }).printCalls! += 1;
    };
  });

  const sheet = page.getByRole('dialog', { name: 'Drums' });
  await sheet.getByRole('button', { name: 'Export PDF' }).click();
  await expect(page.locator('.drum-score-print__header h1')).toHaveText(SONG_NAME);
  await expect(page.locator('.drum-score-print__header')).toContainText('Drum set');
  await expect(page.locator('.drum-score-print__system').first()).toHaveAttribute('aria-label', /^Drum score bars 1 to \d+$/);
  expect(await page.locator('.drum-score-print__system').count()).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => (window as Window & { printCalls?: number }).printCalls)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#root')).toBeHidden();
  await expect(page.locator('.drum-score-print')).toBeVisible();
});

test('the song map lists grooves and fills, and jumps to them', async ({ page }) => {
  await expect.poll(() => page.locator('.drums__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await page.getByRole('button', { name: /^Drum part/ }).click();
  const items = page.getByRole('dialog', { name: 'Drums' }).locator('.drum-map__item');
  expect(await items.count()).toBeGreaterThan(2);
  await expect(page.locator('.drum-map__item--groove .drum-map__count').first()).toHaveText(/^×\d+$/);

  const target = page.locator('.drum-map__item--groove').nth(1);
  await target.click();
  const bars = (await target.locator('.drum-map__bars').textContent())!;
  const first = Number(bars.split('–')[0]);
  await expect(page.locator('.chord-now__name')).toHaveText(`Bar ${first}`);
  await expect(target).toHaveClass(/is-now/);
});

test('the drum badge opens the metronome', async ({ page }) => {
  await expect(page.locator('.drums__badge')).toBeVisible({ timeout: 45_000 });
  await page.locator('.drums__badge').click();
  await expect(page.getByRole('dialog', { name: 'Metronome' })).toBeVisible();
});

test('drums can be hidden from the song menu, and the choice sticks', async ({ page }) => {
  await expect(page.locator('.drums')).toBeVisible();
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Hide drums' }).click();
  await expect(page.locator('.drums')).toHaveCount(0);
  await expect(page.locator('.chords')).toBeVisible();

  await page.reload();
  await expect(page.locator('.transport__play')).toBeEnabled({ timeout: 45_000 });
  await expect(page.locator('.drums')).toHaveCount(0);

  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Show drums' }).click();
  await expect(page.locator('.drums')).toBeVisible();
});

test('the drum sheet docks a mini player to pause, play and seek without closing it', async ({ page }) => {
  await expect.poll(() => page.locator('.drums__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await page.getByRole('button', { name: /^Drum part/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Drums' });
  const mini = sheet.locator('.mini-player');
  await expect(mini).toBeVisible();

  await mini.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await engineState(page)).playing).toBe(true);
  await mini.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => (await engineState(page)).playing).toBe(false);

  const heading = await sheet.locator('.chord-now__name').textContent();
  const box = (await mini.locator('.slider').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  const { duration, position } = await engineState(page);
  expect(position / duration).toBeGreaterThan(0.4);
  expect(position / duration).toBeLessThan(0.6);
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.chord-now__name')).not.toHaveText(heading!);
  await expect(mini.locator('.mini-player__time').first()).toHaveText(await elapsed(page).textContent() as string);

  // It stays pinned while the sheet's content scrolls.
  await sheet.locator('.sheet__body').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(mini).toBeInViewport();
});

test('the chord, metronome and pitch sheets have the mini player; menus do not', async ({ page }) => {
  await expect.poll(() => page.locator('.chords__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await page.getByRole('button', { name: /^Chord chart/ }).click();
  await expect(page.getByRole('dialog', { name: 'Chords' }).locator('.mini-player')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.locator('.transport').getByRole('button', { name: 'Metronome' }).click();
  await expect(page.getByRole('dialog', { name: 'Metronome' }).locator('.mini-player')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Pitch and speed' }).click();
  await expect(page.getByRole('dialog', { name: 'Pitch & speed' }).locator('.mini-player')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'More options' }).click();
  await expect(page.getByRole('dialog', { name: SONG_NAME })).toBeVisible();
  await expect(page.locator('.mini-player')).toHaveCount(0);
});

test('bass strip shows Songsterr fret numbers and string labels under the drum strip, and follows the playhead', async ({ page }) => {
  const chips = page.locator('.bass__chip');
  await expect.poll(() => chips.count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await expect(page.locator('.bass__badge')).toHaveText('5-strTAB');
  await expect(page.locator('.bass__strings')).toHaveText('GDAEB');
  expect(await page.locator('.bass__chip .bass__fret').count()).toBeGreaterThan(20);

  const drums = (await page.locator('.drums').boundingBox())!;
  const strip = (await page.locator('.bass').boundingBox())!;
  const firstStem = (await page.locator('.stem-row').first().boundingBox())!;
  expect(strip.y).toBeGreaterThanOrEqual(drums.y + drums.height);
  expect(strip.y + strip.height).toBeLessThanOrEqual(firstStem.y);

  const shift = () => page.locator('.bass__track').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  expect(await shift()).toBe(0);
  await clickSeek(page, 0.5);
  await expect.poll(shift).toBeLessThan(-1000);
  await expect(page.locator('.bass__chip--active')).toHaveCount(1);
});

test('a stale bass result in storage is analysed again instead of breaking the bass sheet', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const key = `mosaic:bass:${analyserVersions(process.cwd()).bass}:${SONG_SLUG}`;
  const old = `mosaic:bass:v0:${SONG_SLUG}`;
  await page.addInitScript(
    ([key, old]) => {
      if (sessionStorage.getItem('seeded-bass')) return;
      sessionStorage.setItem('seeded-bass', '1');
      // Invalid shape: string 9 out of range.
      const bar = {
        start: 0,
        end: 2,
        beats: [0, 0.5, 1, 1.5],
        kind: 'riff',
        riff: 0,
        repeat: false,
        notes: [{ step: 0, midi: 28, string: 9, fret: 0, duration: 4, velocity: 0.8 }],
      };
      const stale = JSON.stringify({ bars: [bar], meter: 4, division: 4, swing: false });
      localStorage.setItem(key, stale);
      localStorage.setItem(old, stale);
    },
    [key, old],
  );
  await page.reload();
  await expect.poll(() => page.locator('.bass__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await page.locator('.bass__view').click();
  await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
  await expect(page.getByRole('main', { name: 'Bass tab' })).toBeVisible();
  expect(errors).toEqual([]);

  const stored = await page.evaluate(([key, old]) => [JSON.parse(localStorage.getItem(key)!).bars.length, localStorage.getItem(old)], [key, old]);
  expect(stored[0]).toBeGreaterThan(10);
  expect(stored[1]).toBeNull();
});

test('clicking the bass strip opens a full-screen Bass tab page with responsive Songsterr systems, 4/5-string switch, ASCII view, song map, instrument playback, and pitch transposition', async ({
  page,
}) => {
  test.slow();
  await expect.poll(() => page.locator('.bass__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await clickSeek(page, 0.5);
  await page.evaluate(() => {
    const w = window as unknown as { __mosaicEngine: unknown; __savedEngine?: unknown };
    w.__savedEngine = w.__mosaicEngine;
  });
  await page.getByRole('button', { name: /^Bass tab/ }).click();
  await expect(page).toHaveURL(/\?song=.*&view=bass$/);
  await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
  const sheet = page.getByRole('main', { name: 'Bass tab' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.chord-now__name')).toHaveText(/^Bar \d+$/);
  await expect(sheet.locator('.drum-feel')).toHaveText(/^5-str \(B–G\) · [34]\/4 · (Straight|Shuffle)$/);
  await expect(sheet.locator('.chord-meta')).toHaveText(/^Bar \d+ of \d+ · ♩ = \d+$/);
  await expect(sheet.locator('.mini-player')).toBeVisible();

  // Mobile uses 2 bars per Songsterr system; desktop expands to full width and fits 4 bars per system
  await page.setViewportSize({ width: 393, height: 844 });
  await expect(sheet.locator('svg.songsterr__system').first()).toHaveAttribute('aria-label', 'Bass tab bars 1 to 2');
  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await sheet.boundingBox())!.width).toBeGreaterThanOrEqual(1400);
  await expect(sheet.locator('svg.songsterr__system').first()).toHaveAttribute('aria-label', 'Bass tab bars 1 to 4');
  await page.setViewportSize({ width: 393, height: 826 });

  // Full-song Songsterr multi-bar systems with T A B clef, tuning labels, active bar + cursor
  expect(await sheet.locator('svg.songsterr__system').count()).toBeGreaterThan(5);
  const firstLabels = await sheet.locator('svg.songsterr__system').first().locator('.bass-tab__label').allTextContents();
  expect(firstLabels).toEqual(['G', 'D', 'A', 'E', 'B']);
  await expect(sheet.locator('.songsterr__bar.is-now')).toHaveCount(1);
  await expect(sheet.locator('.songsterr__cursor')).toHaveCount(1);
  expect(await sheet.locator('.bass-tab__fret').count()).toBeGreaterThan(20);
  // Active measure highlight must paint behind the horizontal string lines so they stay visible.
  const linesOnTop = await sheet.locator('svg.songsterr__system:has(.songsterr__bar-now)').evaluate((sys) => {
    const bg = sys.querySelector('.songsterr__bar-now')!;
    const lines = [...sys.querySelectorAll('.notation__line')];
    return lines.length > 0 && lines.every((line) => !!(bg.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(linesOnTop).toBe(true);

  // Tapping a bar in the Songsterr page seeks there
  await sheet.getByRole('button', { name: 'Bar 21', exact: true }).click();
  await expect(sheet.locator('.chord-now__name')).toHaveText('Bar 21');

  // Song map seeks to a section
  const items = sheet.locator('.drum-map__item');
  expect(await items.count()).toBeGreaterThan(1);
  const target = items.nth(1);
  const firstBar = Number((await target.locator('.drum-map__bars').textContent())!.split('–')[0]);
  await target.click();
  await expect(sheet.locator('.chord-now__name')).toHaveText(`Bar ${firstBar}`);

  // In-page instrument selector: Bass only -> open Stems dropdown -> toggle Drums on -> All
  const mix = sheet.getByRole('group', { name: 'Instruments to play' });
  await mix.getByRole('button', { name: 'Bass only' }).click();
  let stems = (await engineState(page)).stems;
  expect(stems.filter((s) => !s.muted).map((s) => s.name)).toEqual([expect.stringMatching(/bass/i)]);
  await mix.getByRole('button', { name: /^Stems/ }).click();
  await mix.getByRole('button', { name: 'Drums' }).click();
  stems = (await engineState(page)).stems;
  expect(stems.filter((s) => !s.muted)).toHaveLength(2);
  await mix.getByRole('button', { name: 'All', exact: true }).click();
  stems = (await engineState(page)).stems;
  expect(stems.every((s) => !s.muted)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeVisible();

  // Switch between 5-string and 4-string bass inside the page
  await sheet.getByRole('button', { name: '4-string', exact: true }).click();
  await expect(sheet.locator('.drum-feel')).toHaveText(/^4-str \(E–G\) · [34]\/4 · (Straight|Shuffle)$/);
  expect(await sheet.locator('svg.songsterr__system').first().locator('.bass-tab__label').allTextContents()).toEqual(['G', 'D', 'A', 'E']);

  // ASCII view toggles and sticks across Back button return / reopen without reloading audio
  await sheet.getByRole('button', { name: 'ASCII', exact: true }).click();
  await expect(sheet.locator('.bass-ascii')).toContainText('G|');
  await expect(sheet.locator('.bass-ascii')).not.toContainText('B|');
  await sheet.getByRole('button', { name: 'Back to mixer' }).click();
  await expect(page).toHaveURL(/\?song=[^&]+$/);
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  await expect(page.locator('.transport__play')).toBeEnabled();
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { __mosaicEngine: unknown; __savedEngine?: unknown };
      return w.__mosaicEngine === w.__savedEngine;
    }),
  ).toBe(true);
  await expect(page.locator('.bass__badge')).toHaveText('4-strTAB');
  await expect(page.locator('.bass__strings')).toHaveText('GDAE');
  await page.getByRole('button', { name: /^Bass tab/ }).click();
  await expect(sheet.locator('.bass-ascii')).toBeVisible();

  // Switch back to Tab, verify browser Back returns cleanly, and pitch transposition updates fret numbers
  await sheet.getByRole('button', { name: 'Tab', exact: true }).click();
  const tabFretsBefore = await sheet.locator('.bass-tab__fret').allTextContents();
  await page.goBack();
  await expect(page).toHaveURL(/\?song=[^&]+$/);
  await expect(page.locator('.transport__play')).toBeEnabled();
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { __mosaicEngine: unknown; __savedEngine?: unknown };
      return w.__mosaicEngine === w.__savedEngine;
    }),
  ).toBe(true);
  await page.getByRole('button', { name: 'Pitch and speed' }).click();
  await page.getByRole('button', { name: 'Increase pitch' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Bass tab/ }).click();
  const tabFretsAfter = await sheet.locator('.bass-tab__fret').allTextContents();
  expect(tabFretsAfter).not.toEqual(tabFretsBefore);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\?song=[^&]+$/);
});

test('strips and bass options sheet toggles strips and 4/5-string bass, and sticks across reload', async ({ page }) => {
  await expect.poll(() => page.locator('.bass__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Strips and bass options' }).click();
  const dialog = page.getByRole('dialog', { name: 'Strips & bass' });

  await dialog.getByRole('switch', { name: 'Chords strip' }).click();
  await dialog.getByRole('switch', { name: 'Drums strip' }).click();
  await dialog.getByRole('button', { name: '4-string (E–G)' }).click();
  await expect(dialog).toBeVisible(); // stays open for multiple toggles
  await page.keyboard.press('Escape');

  await expect(page.locator('.chords')).toHaveCount(0);
  await expect(page.locator('.drums')).toHaveCount(0);
  await expect(page.locator('.bass')).toBeVisible();
  await expect(page.locator('.bass__badge')).toHaveText('4-strTAB');
  await expect(page.locator('.bass__strings')).toHaveText('GDAE');

  await page.reload();
  await expect(page.locator('.transport__play')).toBeEnabled({ timeout: 45_000 });
  await expect(page.locator('.chords')).toHaveCount(0);
  await expect(page.locator('.drums')).toHaveCount(0);
  await expect(page.locator('.bass__badge')).toHaveText('4-strTAB');
});

test('the bass page exports Markdown (.md) and PDF scores', async ({ page }) => {
  await expect.poll(() => page.locator('.bass__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await expect.poll(() => page.locator('.chords__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await page.getByRole('button', { name: /^Bass tab/ }).click();
  const sheet = page.getByRole('main', { name: 'Bass tab' });

  // Markdown (.md) download
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    sheet.getByRole('button', { name: 'Export .md' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`${SONG_SLUG}-bass-tab.md`);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const md = Buffer.concat(chunks).toString('utf8');
  expect(md).toContain(`# ${SONG_NAME} — Bass Tablature`);
  expect(md).toContain('**Tuning:** 5-string standard (B–E–A–D–G)');
  expect(md).toContain('**Key:** ');
  expect(md).toContain('BPM');
  expect(md).toContain('G|');
  expect(md).toContain('B|');

  // PDF print score
  await page.evaluate(() => {
    (window as Window & { printCalls?: number }).printCalls = 0;
    window.print = () => {
      (window as Window & { printCalls?: number }).printCalls! += 1;
    };
  });
  await sheet.getByRole('button', { name: 'Export PDF' }).click();
  await expect(page.locator('.bass-score-print__header h1')).toHaveText(SONG_NAME);
  await expect(page.locator('.bass-score-print__header')).toContainText('Bass tablature (5-string B–E–A–D–G)');
  await expect(page.locator('.bass-score-print__system').first()).toHaveAttribute('aria-label', /^Bass tab bars 1 to \d+$/);
  expect(await page.locator('.bass-score-print__system').count()).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => (window as Window & { printCalls?: number }).printCalls)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#root')).toBeHidden();
  await expect(page.locator('.bass-score-print')).toBeVisible();

  // Switch back to screen and verify 4-string export
  await page.emulateMedia({ media: 'screen' });
  await sheet.getByRole('button', { name: '4-string', exact: true }).click();
  await expect(page.locator('.bass-score-print__header')).toContainText('Bass tablature (4-string E–A–D–G)');
  const [download4] = await Promise.all([
    page.waitForEvent('download'),
    sheet.getByRole('button', { name: 'Export .md' }).click(),
  ]);
  const stream4 = await download4.createReadStream();
  const chunks4: Buffer[] = [];
  for await (const chunk of stream4) chunks4.push(chunk as Buffer);
  const md4 = Buffer.concat(chunks4).toString('utf8');
  expect(md4).toContain('**Tuning:** 4-string standard (E–A–D–G)');
  expect(md4).toContain('\nG|');
  expect(md4).not.toContain('\nB|');
});

test('bass tab can be hidden from the song menu, and the choice sticks', async ({ page }) => {
  await expect(page.locator('.bass')).toBeVisible();
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Hide bass tab' }).click();
  await expect(page.locator('.bass')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.transport__play')).toBeEnabled({ timeout: 45_000 });
  await expect(page.locator('.bass')).toHaveCount(0);

  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Show bass tab' }).click();
  await expect(page.locator('.bass')).toBeVisible();
});

test('A–B loop repeats a region in sync on the main mixer, toggles off, and clears', async ({ page }) => {
  await expect(page.getByRole('group', { name: 'Playback speed' })).toHaveCount(0);
  await clickSeek(page, 0.1);
  await page.getByRole('button', { name: 'Set loop start A' }).click();
  await page.locator('.transport__play').click();
  await page.waitForTimeout(850);
  await page.getByRole('button', { name: 'Set loop end B' }).click();

  const initial = await engineState(page);
  expect(initial.loop.enabled).toBe(true);
  expect(initial.loop.start).not.toBeNull();
  expect(initial.loop.end).not.toBeNull();
  expect(initial.loop.end! - initial.loop.start!).toBeGreaterThanOrEqual(0.25);
  await expect(page.locator('.seek .loop-overlay__range')).toBeVisible();

  // Inline speed control appears in loop mode and updates every stem's playbackRate in sync.
  const speedGroup = page.getByRole('group', { name: 'Playback speed' });
  await expect(speedGroup).toBeVisible();
  await speedGroup.getByRole('button', { name: 'Slower' }).click();
  expect((await engineState(page)).speed).toBe(0.95);
  await expect.poll(async () => (await syncReport(page)).sources.every((s) => !!s && Math.abs(s.rate - 0.95) < 1e-3)).toBe(true);
  await speedGroup.getByRole('button', { name: /Reset speed/ }).click();
  expect((await engineState(page)).speed).toBe(1);

  const report = await syncReport(page);
  expect(report.loopingPass).toBe(true);
  expect(report.sources).toHaveLength(STEM_COUNT);
  expect(
    report.sources.every(
      (s) =>
        s !== null &&
        s.loop === true &&
        Math.abs(s.loopStart - initial.loop.start!) < 1e-3 &&
        Math.abs(s.loopEnd - initial.loop.end!) < 1e-3,
    ),
  ).toBe(true);

  // Playback wraps and stays inside [A, B] past the loop's duration.
  await page.waitForTimeout(1400);
  const looped = await engineState(page);
  expect(looped.playing).toBe(true);
  expect(looped.position).toBeGreaterThanOrEqual(initial.loop.start! - 0.05);
  expect(looped.position).toBeLessThanOrEqual(initial.loop.end! + 0.05);

  // Toggling loop off keeps A & B, hides inline speed, and lets playback continue past B.
  await page.getByRole('button', { name: 'A-B loop' }).click();
  await expect(page.getByRole('group', { name: 'Playback speed' })).toHaveCount(0);
  const disabled = await engineState(page);
  expect(disabled.loop.enabled).toBe(false);
  expect(disabled.loop.start).toBeCloseTo(initial.loop.start!, 3);
  expect(disabled.loop.end).toBeCloseTo(initial.loop.end!, 3);
  await expect.poll(async () => (await engineState(page)).position).toBeGreaterThan(initial.loop.end! + 0.1);

  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Clear loop' }).click();
  expect((await engineState(page)).loop).toEqual({ start: null, end: null, enabled: false });
  await expect(page.locator('.seek .loop-overlay__range')).toHaveCount(0);

  // Keyboard shortcuts [, ], and L set A, set B, and toggle loop.
  await clickSeek(page, 0.2);
  await page.keyboard.press('BracketLeft');
  const afterA = (await engineState(page)).loop;
  expect(afterA.start).not.toBeNull();
  expect(afterA.end).toBeNull();
  await page.getByRole('button', { name: 'Forward 5 seconds' }).click();
  await page.keyboard.press('BracketRight');
  const afterB = (await engineState(page)).loop;
  expect(afterB.enabled).toBe(true);
  expect(afterB.end! - afterB.start!).toBeGreaterThan(4);
  await page.keyboard.press('KeyL');
  expect((await engineState(page)).loop.enabled).toBe(false);
  await page.keyboard.press('KeyL');
  expect((await engineState(page)).loop.enabled).toBe(true);
});

test('Bass page supports bar-snapped A–B looping, bar nudging, Shift+click range, and Song map riff looping', async ({ page }) => {
  await expect.poll(() => page.locator('.bass__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await page.getByRole('button', { name: /^Bass tab/ }).click();
  const sheet = page.getByRole('main', { name: 'Bass tab' });
  await expect(sheet).toBeVisible();

  await sheet.getByRole('button', { name: 'Bar 5', exact: true }).click();
  await sheet.getByRole('button', { name: 'A-B loop' }).click();
  await expect(sheet.getByRole('button', { name: 'Set loop start A' })).toHaveText('A · 5');
  await expect(sheet.getByRole('button', { name: 'Set loop end B' })).toHaveText('B · 5');
  await expect(sheet.locator('.songsterr__bar-loop')).toHaveCount(1);

  // Loop background stays behind horizontal string lines so strings stay legible.
  const loopBehindLines = await sheet.locator('svg.songsterr__system:has(.songsterr__bar-loop)').evaluate((sys) => {
    const bg = sys.querySelector('.songsterr__bar-loop')!;
    const lines = [...sys.querySelectorAll('.notation__line')];
    return lines.length > 0 && lines.every((line) => !!(bg.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(loopBehindLines).toBe(true);

  await sheet.getByRole('button', { name: 'Later end bar' }).click();
  await expect(sheet.getByRole('button', { name: 'Set loop end B' })).toHaveText('B · 6');
  await expect(sheet.locator('.songsterr__bar-loop')).toHaveCount(2);

  await sheet.getByRole('button', { name: 'Bar 8', exact: true }).click({ modifiers: ['Shift'] });
  await expect(sheet.getByRole('button', { name: 'Set loop start A' })).toHaveText('A · 5');
  await expect(sheet.getByRole('button', { name: 'Set loop end B' })).toHaveText('B · 8');
  await expect(sheet.locator('.songsterr__bar-loop')).toHaveCount(4);

  // One-tap Song map loop button jumps to the riff and loops it cleanly.
  const mapRow = sheet.locator('.drum-map__row').nth(1);
  const barsText = (await mapRow.locator('.drum-map__bars').textContent())!;
  const firstBar = Number(barsText.split('–')[0]);
  const mapLoopBtn = mapRow.locator('.drum-map__loop');
  await mapLoopBtn.click();
  await expect(mapLoopBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.locator('.chord-now__name')).toHaveText(`Bar ${firstBar}`);
  await expect(sheet.locator('.mini-player .loop-overlay__range')).toBeVisible();

  const mapState = await engineState(page);
  expect(mapState.loop.enabled).toBe(true);

  // Returning to mixer preserves the loop and highlights looped bars on the Bass strip.
  await sheet.getByRole('button', { name: 'Back to mixer' }).click();
  await expect(page.locator('.bass')).toBeVisible();
  expect(await page.locator('.bass__chip--loop').count()).toBeGreaterThan(0);
});

test('Bass coach listens to live bass input, grades notes on the tab, and offers one-click corrections', async ({ page }) => {
  await page.addInitScript(() => {
    let ctx: AudioContext | null = null;
    let osc: OscillatorNode | null = null;
    let gain: GainNode | null = null;
    let dest: MediaStreamAudioDestinationNode | null = null;
    let freq = 41.2034; // E1
    let gainVal = 0.45;
    let stoppedTracks = 0;

    (window as unknown as { __mockBass?: unknown }).__mockBass = {
      setFreq(hz: number) {
        freq = hz;
        if (osc && ctx) osc.frequency.setValueAtTime(hz, ctx.currentTime);
      },
      setGain(g: number) {
        gainVal = g;
        if (gain && ctx) gain.gain.setValueAtTime(g, ctx.currentTime);
      },
      getStoppedTracks: () => stoppedTracks,
    };

    const mediaDevices = {
      getUserMedia: async () => {
        if (!ctx) {
          ctx = new AudioContext();
          osc = ctx.createOscillator();
          gain = ctx.createGain();
          dest = ctx.createMediaStreamDestination();
          osc.type = 'sawtooth';
          osc.frequency.value = freq;
          gain.gain.value = gainVal;
          osc.connect(gain);
          gain.connect(dest);
          osc.start();
        }
        await ctx.resume();
        const stream = dest!.stream.clone();
        for (const tr of stream.getTracks()) {
          const origStop = tr.stop.bind(tr);
          tr.stop = () => {
            stoppedTracks += 1;
            origStop();
          };
        }
        return stream;
      },
      enumerateDevices: async () => [
        { deviceId: 'mock-di', kind: 'audioinput', label: 'Mock Bass DI', groupId: 'g1', toJSON: () => ({}) },
        { deviceId: 'mock-mic', kind: 'audioinput', label: 'Mock Mic', groupId: 'g2', toJSON: () => ({}) },
      ],
    };
    Object.defineProperty(navigator, 'mediaDevices', { value: mediaDevices, configurable: true });
  });

  await openSong(page);
  await expect.poll(() => page.locator('.bass__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);

  // Locate a bar with at least 2 bass notes so playback hits & misses can be tested reliably.
  const targetBar = await page.evaluate((slug) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('mosaic:bass:') && k.endsWith(`:${slug}`))!;
    const data = JSON.parse(localStorage.getItem(key)!) as {
      bars: { start: number; end: number; notes: { step: number; midi: number }[] }[];
    };
    const idx = data.bars.findIndex((b) => b.notes.length >= 2);
    return { idx, midi: data.bars[idx].notes[0].midi };
  }, SONG_SLUG);

  await page.getByRole('button', { name: /^Bass tab/ }).click();
  const sheet = page.getByRole('main', { name: 'Bass tab' });
  await sheet.getByRole('button', { name: `Bar ${targetBar.idx + 1}`, exact: true }).click({ position: { x: 10, y: 20 } });

  const listenBtn = sheet.getByRole('button', { name: 'Listen to my bass' });
  await listenBtn.click();
  await expect(listenBtn).toHaveAttribute('aria-pressed', 'true');
  const coach = sheet.getByRole('region', { name: 'Bass coach' });
  await expect(coach).toBeVisible();

  // Live tuner detects E1, then A1.
  await expect(coach.locator('.bass-coach__you strong')).toHaveText('E1');
  await page.evaluate(() => (window as unknown as { __mockBass: { setFreq(hz: number): void } }).__mockBass.setFreq(55));
  await expect(coach.locator('.bass-coach__you strong')).toHaveText('A1');

  // Mute song bass button toggles the bass stem mute cleanly.
  await coach.getByRole('button', { name: 'Mute song bass' }).click();
  await expect(coach.getByRole('button', { name: 'Song bass muted' })).toHaveAttribute('aria-pressed', 'true');
  const bassStem = (await engineState(page)).stems.find((s) => /bass/i.test(s.name))!;
  expect(bassStem.muted).toBe(true);

  // Play the exact target pitch for the bar's first note -> graded hit, then silence -> missed note & loop tip.
  await page.evaluate((midi) => {
    const hz = 440 * Math.pow(2, (midi - 69) / 12);
    (window as unknown as { __mockBass: { setFreq(h: number): void } }).__mockBass.setFreq(hz);
  }, targetBar.midi);
  await sheet.locator('.mini-player__play').click();
  await expect(sheet.locator('.bass-tab__fret--hit').first()).toBeVisible({ timeout: 5000 });

  await page.evaluate(() => (window as unknown as { __mockBass: { setGain(g: number): void } }).__mockBass.setGain(0));
  await expect(sheet.locator('.bass-tab__fret--miss').first()).toBeVisible({ timeout: 5000 });
  const loopTipBtn = coach.getByRole('button', { name: /^Loop bar \d+$/ });
  await expect(loopTipBtn).toBeVisible();
  await loopTipBtn.click();
  expect((await engineState(page)).loop.enabled).toBe(true);

  // Stopping Listen closes the coach panel and stops the MediaStream tracks.
  await listenBtn.click();
  await expect(coach).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __mockBass: { getStoppedTracks(): number } }).__mockBass.getStoppedTracks()),
  ).toBeGreaterThan(0);
});

test('Bass coach reports denied microphone permission gracefully', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
        },
      },
      configurable: true,
    });
  });

  await openSong(page);
  await expect.poll(() => page.locator('.bass__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await page.getByRole('button', { name: /^Bass tab/ }).click();
  const sheet = page.getByRole('main', { name: 'Bass tab' });
  await sheet.getByRole('button', { name: 'Listen to my bass' }).click();

  await expect(sheet.locator('.bass-coach--error')).toContainText('Microphone permission denied');
  expect(errors).toEqual([]);
});

test('Bass page boosts the bass stem automatically and exposes inline speed control', async ({ page }) => {
  await expect.poll(() => page.locator('.bass__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  const mixerState = await engineState(page);
  const bassIdx = mixerState.stems.findIndex((s) => /bass/i.test(s.name));
  expect(bassIdx).toBeGreaterThanOrEqual(0);
  expect(mixerState.bassBoost).toBe(false);
  expect((await syncReport(page)).gains.every((g) => Math.abs(g - 1) < 1e-3)).toBe(true);

  await page.getByRole('button', { name: /^Bass tab/ }).click();
  const sheet = page.getByRole('main', { name: 'Bass tab' });
  await expect(sheet).toBeVisible();

  // Entering Bass tab automatically enables bass boost without overwriting stem slider volumes.
  expect((await engineState(page)).bassBoost).toBe(true);
  const mix = sheet.getByRole('group', { name: 'Instruments to play' });
  const boostBtn = mix.getByRole('button', { name: 'Bass boost' });
  await expect(boostBtn).toHaveAttribute('aria-pressed', 'true');
  let gains = (await syncReport(page)).gains;
  expect(gains[bassIdx]).toBeCloseTo(1.75, 2);
  gains.forEach((g, idx) => {
    if (idx !== bassIdx) expect(g).toBeCloseTo(0.72, 2);
  });

  // Inline speed control is available immediately on Bass page even without an active loop.
  const speedGroup = sheet.getByRole('group', { name: 'Playback speed' });
  await expect(speedGroup).toBeVisible();
  await speedGroup.getByRole('button', { name: 'Slower' }).click();
  await speedGroup.getByRole('button', { name: 'Slower' }).click();
  expect((await engineState(page)).speed).toBe(0.9);
  await expect(sheet.locator('.chord-meta')).toContainText('90%');
  await speedGroup.getByRole('button', { name: 'Faster' }).click();
  expect((await engineState(page)).speed).toBe(0.95);
  await speedGroup.getByRole('button', { name: /Reset speed/ }).click();
  expect((await engineState(page)).speed).toBe(1);

  // Muting the song's bass restores full backing-band gain so the player isn't ducked while playing along.
  const stemsBtn = mix.getByRole('button', { name: /^Stems/ });
  await stemsBtn.click();
  await mix.getByRole('button', { name: 'Bass', exact: true }).click();
  gains = (await syncReport(page)).gains;
  expect(gains[bassIdx]).toBe(0);
  gains.forEach((g, idx) => {
    if (idx !== bassIdx) expect(g).toBeCloseTo(1, 2);
  });
  await mix.getByRole('button', { name: 'Bass', exact: true }).click();
  gains = (await syncReport(page)).gains;
  expect(gains[bassIdx]).toBeCloseTo(1.75, 2);
  await stemsBtn.click();

  // Bass boost toggle turns boost off and on.
  await boostBtn.click();
  await expect(boostBtn).toHaveAttribute('aria-pressed', 'false');
  expect((await engineState(page)).bassBoost).toBe(false);
  expect((await syncReport(page)).gains.every((g) => Math.abs(g - 1) < 1e-3)).toBe(true);
  await boostBtn.click();
  await expect(boostBtn).toHaveAttribute('aria-pressed', 'true');
  expect((await syncReport(page)).gains[bassIdx]).toBeCloseTo(1.75, 2);

  // Leaving Bass tab automatically restores normal mix gain.
  await sheet.getByRole('button', { name: 'Back to mixer' }).click();
  expect((await engineState(page)).bassBoost).toBe(false);
  expect((await syncReport(page)).gains.every((g) => Math.abs(g - 1) < 1e-3)).toBe(true);
});

test('Bass page dock and loop/speed bar stay compact, aligned, and within bounds on mobile viewports', async ({ page }) => {
  await expect.poll(() => page.locator('.bass__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await page.getByRole('button', { name: /^Bass tab/ }).click();
  const sheet = page.getByRole('main', { name: 'Bass tab' });
  await expect(sheet).toBeVisible();

  // Helper to inspect horizontal bounds, single/multi-row alignment, dropdown state, and >= 44px touch targets.
  const inspectDock = () =>
    sheet.evaluate((root) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const body = root.querySelector('.bass-page__body')!.getBoundingClientRect();
      const mix = root.querySelector('.bass-mix')!;
      const mixChildren = [...mix.querySelectorAll(':scope > .bass-mix__btn, :scope > .bass-mix__dropdown > .bass-mix__trigger')]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            label: el.textContent?.trim() || '',
            visible: getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0,
            y: r.y,
            left: r.left,
            right: r.right,
            height: r.height,
          };
        })
        .filter((item) => item.visible);
      const triggerEl = mix.querySelector('.bass-mix__trigger')!;
      const triggerRect = triggerEl.getBoundingClientRect();
      const menuEl = mix.querySelector('.bass-mix__menu')!;
      const menuOpen = getComputedStyle(menuEl).display !== 'none';
      const menuRect = menuEl.getBoundingClientRect();
      const loopA = root.querySelector('.loop-bar__a')!.getBoundingClientRect();
      const loopB = root.querySelector('.loop-bar__b')!.getBoundingClientRect();
      const toggle = root.querySelector('.loop-bar__toggle')!.getBoundingClientRect();
      const clearEl = root.querySelector('.loop-bar__clear');
      const clear = clearEl ? clearEl.getBoundingClientRect() : null;
      const speed = root.querySelector('.loop-bar__speed')!.getBoundingClientRect();
      const buttons = [...root.querySelectorAll('.loop-bar button')].map((b) => {
        const r = b.getBoundingClientRect();
        return {
          label: b.getAttribute('aria-label') || b.textContent?.trim() || '',
          width: r.width,
          height: r.height,
          left: r.left,
          right: r.right,
        };
      });
      return {
        vw,
        vh,
        docScrollWidth: document.documentElement.scrollWidth,
        bodyHeight: body.height,
        mixScrollWidth: mix.scrollWidth,
        mixClientWidth: mix.clientWidth,
        mixRowItems: mixChildren,
        triggerVisible: getComputedStyle(triggerEl).display !== 'none' && triggerRect.width > 0,
        menuOpen,
        menuRect: { top: menuRect.top, left: menuRect.left, right: menuRect.right, bottom: menuRect.bottom },
        loopA: { x: loopA.x, y: loopA.y, width: loopA.width, height: loopA.height, right: loopA.right },
        loopB: { x: loopB.x, y: loopB.y, width: loopB.width, height: loopB.height, right: loopB.right },
        toggle: { x: toggle.x, y: toggle.y, width: toggle.width, height: toggle.height, right: toggle.right },
        clear: clear ? { x: clear.x, y: clear.y, width: clear.width, height: clear.height, right: clear.right } : null,
        speed: { x: speed.x, y: speed.y, width: speed.width, height: speed.height, right: speed.right },
        buttons,
      };
    });

  const mix = sheet.getByRole('group', { name: 'Instruments to play' });
  const stemsTrigger = mix.getByRole('button', { name: /^Stems/ });

  // 1. Mobile (393x826) & narrow mobile (360x740): top mix row fits without overflow, stems move into a dropdown, and loop/speed fit on ONE row.
  for (const vp of [
    { width: 393, height: 826 },
    { width: 360, height: 740 },
  ]) {
    await page.setViewportSize(vp);
    await expect.poll(async () => (await inspectDock()).vw).toBe(vp.width);
    const before = await inspectDock();
    expect(before.docScrollWidth).toBeLessThanOrEqual(vp.width);
    expect(before.mixScrollWidth).toBeLessThanOrEqual(before.mixClientWidth + 1);
    expect(before.triggerVisible).toBe(true);
    expect(before.mixRowItems.map((m) => m.label)).toEqual(['Bass only', 'Bass boost', 'Stems · All']);
    for (const item of before.mixRowItems) {
      expect(Math.abs(item.y - before.mixRowItems[0].y)).toBeLessThanOrEqual(2);
      expect(item.left).toBeGreaterThanOrEqual(0);
      expect(item.right).toBeLessThanOrEqual(vp.width + 0.5);
      expect(item.height).toBeGreaterThanOrEqual(43.5);
    }
    await expect(mix.getByRole('button', { name: 'All', exact: true })).toBeHidden();
    await expect(mix.getByRole('button', { name: 'Drums' })).toBeHidden();

    // Open the stems dropdown -> upward popover fits inside viewport, stays open across multi-stem toggles, closes cleanly on Escape.
    await stemsTrigger.click();
    await expect(stemsTrigger).toHaveAttribute('aria-expanded', 'true');
    const opened = await inspectDock();
    expect(opened.menuOpen).toBe(true);
    expect(opened.menuRect.top).toBeGreaterThanOrEqual(0);
    expect(opened.menuRect.left).toBeGreaterThanOrEqual(0);
    expect(opened.menuRect.right).toBeLessThanOrEqual(vp.width + 0.5);
    await expect(mix.getByRole('button', { name: 'All', exact: true })).toBeVisible();
    await expect(mix.getByRole('button', { name: 'Drums' })).toBeVisible();
    expect((await mix.getByRole('button', { name: 'Drums' }).boundingBox())!.height).toBeGreaterThanOrEqual(43.5);

    await mix.getByRole('button', { name: 'Drums' }).click();
    await expect(stemsTrigger).toHaveText('Stems · 5/6');
    await expect(mix.getByRole('button', { name: 'All', exact: true })).toBeVisible();
    await mix.getByRole('button', { name: 'All', exact: true }).click();
    await expect(stemsTrigger).toHaveText('Stems · All');

    await page.keyboard.press('Escape');
    await expect(stemsTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(sheet).toBeVisible();
    await expect(mix.getByRole('button', { name: 'Drums' })).toBeHidden();

    expect(Math.abs(before.loopA.y - before.loopB.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(before.loopA.y - before.toggle.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(before.loopA.y - before.speed.y)).toBeLessThanOrEqual(2);
    for (const btn of before.buttons) {
      expect(btn.left).toBeGreaterThanOrEqual(0);
      expect(btn.right).toBeLessThanOrEqual(vp.width + 0.5);
      expect(btn.height).toBeGreaterThanOrEqual(43.5);
    }
  }

  // 2. Activate a bar-snapped loop -> Row 1 has equal A & B steppers, Row 2 has Loop · Clear · Speed, >= 44px targets.
  await sheet.getByRole('button', { name: 'Bar 5', exact: true }).click();
  await sheet.getByRole('button', { name: 'A-B loop' }).click();
  await sheet.getByRole('button', { name: 'Later end bar' }).click();

  for (const vp of [
    { width: 393, height: 826 },
    { width: 360, height: 740 },
  ]) {
    await page.setViewportSize(vp);
    await expect.poll(async () => (await inspectDock()).vw).toBe(vp.width);
    const looped = await inspectDock();
    expect(looped.docScrollWidth).toBeLessThanOrEqual(vp.width);

    // Row 1: A and B share y and have equal width (within 2px).
    expect(Math.abs(looped.loopA.y - looped.loopB.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(looped.loopA.width - looped.loopB.width)).toBeLessThanOrEqual(2);
    expect(looped.loopA.x).toBeGreaterThanOrEqual(0);
    expect(looped.loopB.right).toBeLessThanOrEqual(vp.width + 0.5);

    // Row 2: Loop toggle, Clear, and Speed sit together on the row directly below Row 1.
    expect(looped.clear).not.toBeNull();
    expect(looped.toggle.y).toBeGreaterThanOrEqual(looped.loopA.y + looped.loopA.height - 1);
    expect(Math.abs(looped.toggle.y - looped.clear!.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(looped.toggle.y - looped.speed.y)).toBeLessThanOrEqual(2);
    expect(looped.speed.right).toBeLessThanOrEqual(vp.width + 0.5);

    for (const btn of looped.buttons) {
      expect(btn.left).toBeGreaterThanOrEqual(0);
      expect(btn.right).toBeLessThanOrEqual(vp.width + 0.5);
      expect(btn.width).toBeGreaterThanOrEqual(43.5);
      expect(btn.height).toBeGreaterThanOrEqual(43.5);
    }

    if (vp.width === 393) {
      expect(looped.bodyHeight).toBeGreaterThanOrEqual(220);
    }
  }

  // 3. Desktop (1440x900): dropdown trigger hides, All + stems show inline, and all 5 loop/speed controls sit on one row.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => (await inspectDock()).vw).toBe(1440);
  const desktop = await inspectDock();
  expect(desktop.docScrollWidth).toBeLessThanOrEqual(1440);
  expect(desktop.triggerVisible).toBe(false);
  await expect(mix.getByRole('button', { name: 'All', exact: true })).toBeVisible();
  await expect(mix.getByRole('button', { name: 'Drums' })).toBeVisible();
  expect(Math.abs(desktop.loopA.y - desktop.loopB.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(desktop.loopA.y - desktop.toggle.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(desktop.loopA.y - desktop.clear!.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(desktop.loopA.y - desktop.speed.y)).toBeLessThanOrEqual(2);
});

test('Tujhe Kitna bass tab starts by sliding to the 5th fret on the E string and renders legato slides across views', async ({ page }) => {
  test.slow();
  await page.goto('./?song=tujhe-kitna-chahein-aur-hum&view=bass');
  const sheet = page.getByRole('main', { name: 'Bass tab' });
  await expect(sheet).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => sheet.locator('.songsterr__system').count(), { timeout: 45_000 }).toBeGreaterThan(10);

  const summary = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('mosaic:bass:') && k.endsWith(':tujhe-kitna-chahein-aur-hum'))!;
    const analysis = JSON.parse(localStorage.getItem(key)!);
    const activeBars = analysis.bars
      .map((b: { notes: { step: number; midi: number; string: number; fret: number; slide?: string }[] }, idx: number) => ({ bar: idx + 1, notes: b.notes }))
      .filter((b: { notes: unknown[] }) => b.notes.length > 0);
    const slides = activeBars.flatMap((b: { bar: number; notes: { slide?: string; string: number; fret: number }[] }) =>
      b.notes.filter((n) => n.slide).map((n) => ({ bar: b.bar, ...n })),
    );
    return { firstTwoActive: activeBars.slice(0, 2), slideCount: slides.length };
  });

  // First bass entry (Bars 11 -> 12): starts on E string (string 3) and slides up to fret 5 on the E string.
  expect(summary.firstTwoActive[0].bar).toBe(11);
  expect(summary.firstTwoActive[0].notes.at(-1)).toMatchObject({ string: 3, fret: 1 });
  expect(summary.firstTwoActive[1].bar).toBe(12);
  expect(summary.firstTwoActive[1].notes[0]).toMatchObject({ step: 0, string: 3, fret: 5, slide: 'up' });
  expect(summary.slideCount).toBeGreaterThanOrEqual(15);

  // Songsterr SVG tab renders diagonal slide lines (.bass-tab__slide).
  expect(await sheet.locator('.bass-tab__slide').count()).toBeGreaterThanOrEqual(15);

  // ASCII view shows /5 on the E string in Bars 11-12.
  await sheet.getByRole('button', { name: 'ASCII' }).click();
  await expect(sheet.locator('.bass-ascii')).toContainText('|/5');
});

test('replay button restarts song from 0:00 in both main transport and docked mini player', async ({ page }) => {
  const { duration } = await engineState(page);

  // 1. Paused mid-song -> clicking Replay jumps back to 0:00 and starts playback.
  await clickSeek(page, 0.5);
  await expect.poll(async () => (await engineState(page)).position).toBeGreaterThan(duration * 0.45);
  await page.locator('.transport').getByRole('button', { name: 'Replay' }).click();
  await expect.poll(async () => (await engineState(page)).playing).toBe(true);
  await expect.poll(async () => (await engineState(page)).position).toBeLessThan(15);

  // 2. Playing mid-song -> clicking Replay restarts from 0:00 without pausing.
  await clickSeek(page, 0.6);
  await expect.poll(async () => (await engineState(page)).position).toBeGreaterThan(duration * 0.5);
  await page.locator('.transport').getByRole('button', { name: 'Replay' }).click();
  expect((await engineState(page)).playing).toBe(true);
  await expect.poll(async () => (await engineState(page)).position).toBeLessThan(15);

  // 3. Docked MiniPlayer (inside Metronome sheet) also restarts playback from 0:00.
  await page.getByRole('button', { name: 'Pause' }).click();
  await clickSeek(page, 0.4);
  await expect.poll(async () => (await engineState(page)).position).toBeGreaterThan(duration * 0.35);
  await page.getByRole('button', { name: 'Metronome' }).click();
  const miniReplay = page.locator('.mini-player').getByRole('button', { name: 'Replay' });
  await expect(miniReplay).toBeVisible();
  await miniReplay.click();
  await expect.poll(async () => (await engineState(page)).playing).toBe(true);
  await expect.poll(async () => (await engineState(page)).position).toBeLessThan(15);
});

test('Kabhi Na Kabhi bass tab simplifies ghost chatter to a clean Seggae groove', async ({ page }) => {
  test.slow();
  await page.goto('./?song=kabhi-na-kabhi-seggae-hindies-cover&view=bass');
  const sheet = page.getByRole('main', { name: 'Bass tab' });
  await expect(sheet).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => sheet.locator('.songsterr__system').count(), { timeout: 45_000 }).toBeGreaterThan(10);

  const stats = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('mosaic:bass:') && k.endsWith(':kabhi-na-kabhi-seggae-hindies-cover'))!;
    const analysis = JSON.parse(localStorage.getItem(key)!);
    const activeBars = analysis.bars.filter((b: { notes: unknown[] }) => b.notes.length > 0);
    const totalNotes = activeBars.reduce((sum: number, b: { notes: unknown[] }) => sum + b.notes.length, 0);
    const maxNotesInBar = Math.max(0, ...activeBars.map((b: { notes: unknown[] }) => b.notes.length));
    return {
      activeCount: activeBars.length,
      totalNotes,
      avgPerActiveBar: totalNotes / Math.max(1, activeBars.length),
      maxNotesInBar,
    };
  });

  expect(stats.activeCount).toBeGreaterThan(80);
  expect(stats.totalNotes).toBeLessThanOrEqual(560);
  expect(stats.avgPerActiveBar).toBeLessThanOrEqual(5.2);
  expect(stats.maxNotesInBar).toBeLessThanOrEqual(8);
});
