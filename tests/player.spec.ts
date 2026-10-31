import { expect, test } from '@playwright/test';
import { analyserVersions } from '../scripts/analyser-versions';
import { SONG_NAME, SONG_SLUG, STEM_COUNT, clickSeek, elapsed, engineState, openSong, parseTime, syncReport } from './helpers';

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

test('re-analyse song forgets the cached beats, chords and drums and works them out again', async ({ page }) => {
  test.slow(); // every analysis runs twice
  await expect.poll(() => page.locator('.drums__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  await expect.poll(() => page.locator('.chords__chip').count(), { timeout: 45_000 }).toBeGreaterThan(10);
  const cached = () =>
    page.evaluate((slug) => Object.keys(localStorage).filter((k) => /^mosaic:(beats|chords|drums):/.test(k) && k.endsWith(`:${slug}`)).length, SONG_SLUG);
  await expect.poll(cached).toBe(3);
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
  await expect.poll(cached).toBe(3);
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

  await mini.getByRole('button', { name: 'Play' }).click();
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
