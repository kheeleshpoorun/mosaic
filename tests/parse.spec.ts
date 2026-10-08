import { expect, test } from '@playwright/test';
import { isAudioFileName, parseStemName, slugify } from '../src/lib/parseStemName';

test.describe('parseStemName', () => {
  test('parses the Moises export format', () => {
    expect(parseStemName('Tujhe Kitna Chahein Aur Hum_drums_mixed.mp3')).toEqual({
      songName: 'Tujhe Kitna Chahein Aur Hum',
      stemName: 'drums',
    });
  });

  test('parses names without the _mixed suffix', () => {
    expect(parseStemName('My Song_Vocals.wav')).toEqual({ songName: 'My Song', stemName: 'vocals' });
  });

  test('uses the last underscore as the stem separator', () => {
    expect(parseStemName('Song_with_underscores_bass_mixed.mp3')).toEqual({
      songName: 'Song with underscores',
      stemName: 'bass',
    });
  });

  test('parses "Song - stem" names', () => {
    expect(parseStemName('Another Song - piano.m4a')).toEqual({ songName: 'Another Song', stemName: 'piano' });
  });

  test('falls back for names without a separator', () => {
    expect(parseStemName('vocals.mp3')).toEqual({ songName: 'Imported song', stemName: 'vocals' });
  });
});

test('slugify makes stable share-link slugs', () => {
  expect(slugify('Tujhe Kitna Chahein Aur Hum')).toBe('tujhe-kitna-chahein-aur-hum');
  expect(slugify('  Café — Déjà Vu! ')).toBe('cafe-deja-vu');
});

test('isAudioFileName accepts audio and rejects other files', () => {
  expect(isAudioFileName('a.MP3')).toBe(true);
  expect(isAudioFileName('a.flac')).toBe(true);
  expect(isAudioFileName('cover.jpg')).toBe(false);
  expect(isAudioFileName('songs.json')).toBe(false);
});
