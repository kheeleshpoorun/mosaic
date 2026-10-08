import { expect, type Page } from '@playwright/test';

export const SONG_SLUG = 'tujhe-kitna-chahein-aur-hum';
export const SONG_NAME = 'Tujhe Kitna Chahein Aur Hum';
export const STEM_COUNT = 6;

/** Opens the sample library song via its share link and waits until all stems are decoded. */
export async function openSong(page: Page) {
  await page.goto(`./?song=${SONG_SLUG}`);
  await expect(page.locator('.transport__play')).toBeEnabled({ timeout: 45_000 });
}

/** Reads the engine through the test hook exposed by the Player component. */
export function engineState(page: Page) {
  return page.evaluate(() => {
    const engine = (window as unknown as { __mosaicEngine: { state: unknown; position: number } }).__mosaicEngine;
    return { ...(engine.state as Record<string, unknown>), position: engine.position } as {
      playing: boolean;
      duration: number;
      position: number;
      speed: number;
      pitch: number;
      stems: { name: string; muted: boolean; volume: number }[];
      metronome: { enabled: boolean; bpm: number; offset: number; detecting: boolean; beats: number[] | null; downbeat: number };
    };
  });
}

export function syncReport(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { __mosaicEngine: { syncReport(): { sources: ({ rate: number } | null)[] } } }).__mosaicEngine.syncReport(),
  );
}

/** Clicks the seek bar at a fraction (0..1) of its width. */
export async function clickSeek(page: Page, fraction: number) {
  const box = (await page.locator('.seek .slider').boundingBox())!;
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}

/** "m:ss" → seconds */
export function parseTime(text: string | null): number {
  const [m, s] = (text ?? '0:00').replace('-', '').split(':').map(Number);
  return m * 60 + s;
}

export const elapsed = (page: Page) => page.locator('.seek__times span').first();
