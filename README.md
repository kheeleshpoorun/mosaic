# Mosaic

A stem player for your browser that looks and works like the [Moises](https://moises.ai) mixer. You can mute, solo and change the volume of each stem, and it has a metronome plus pitch and speed controls.

Moises won't let you share a playable link with friends, but it will export the separate stems. Mosaic fills that gap:

- **Library songs**: you commit stems to the `library/` folder and they're published with the site. Each one gets a link you can share, and the link opens the player directly.
- **Imports**: anyone can drag and drop their own stems onto the home page. These play only on that device, because without a backend there's nowhere to upload them.

Everything is static and hosted free on GitHub Pages.

---

## Using the app

### Home page

- **Drop your stems here**: drag stem files (or a whole folder of them) onto the page, or click **Browse files**. Stems are grouped into songs by file name. If you import one song, it opens right away.
- **Library**: songs that are already published. Tap one to open it, or tap 🔗 to copy its share link.
- **Imported**: songs you imported during this visit. They disappear when you reload the page.

### Player

| Control | What it does |
| --- | --- |
| ⌄ (top left) | Go back to the song list |
| Share icon | Copy or share the direct link (library songs only) |
| ⋮ (top right) | Copy link, reset the mix |
| Stem icon | Mute or unmute the stem. A muted stem is greyed out with a slash. |
| Stem slider | Stem volume. The default position (¾) is the original level, and the far right is about +5 dB. |
| Stem ⋮ | **Solo**, **Mute**, **Reset volume** |
| Seek bar | Elapsed time on the left, remaining time on the right. Click or drag to seek. |
| Metronome icon | Opens the metronome. The click **follows the song's actual beats**, which are tracked automatically from the drums, so it stays in time even if the band speeds up or slows down. You can turn it on or off, set the volume, and nudge the timing in 10 ms steps. **Beat is here** shifts the clicks onto the current position. Changing the tempo or using **Tap tempo** switches to a fixed tempo, and **Follow the song** switches back. |
| ⏪ / ⏩ | Skip back or forward 5 seconds |
| ▶ / ❚❚ | Play or pause (**Space** also works) |
| ♭♯ | Key (±12 semitones) and speed (50–150%, pitch preserved) |

Keyboard shortcuts: **Space** plays and pauses, **← / →** skip 5 seconds.

---

## Adding songs to the library (shareable)

1. Export the stems from Moises. The file names look like `<Song name>_<stem>_mixed.mp3`, for example:
   ```
   Tujhe Kitna Chahein Aur Hum_vocals_mixed.mp3
   Tujhe Kitna Chahein Aur Hum_drums_mixed.mp3
   ```
2. Copy them into `library/`.
3. Commit and push to `main`. The GitHub workflow rebuilds and redeploys the site.

The song title comes from the file name: everything before the last `_<stem>` part, with `_mixed` removed. `Song - vocals.mp3` also works. Supported formats are mp3, wav, m4a, aac, ogg, opus, flac and webm.

### Share links

Each library song has a URL that opens the player straight away:

```
https://<your-user>.github.io/<repo>/?song=<slug>
```

The slug is the song name in lower-case kebab-case, for example `?song=tujhe-kitna-chahein-aur-hum`. The 🔗 button and the share icon copy this link for you.

### Optional: pin a title or force a fixed tempo

The metronome tracks the beats automatically the first time a song is opened (this takes under a second), and caches the result in the browser. You normally don't need to do anything. To override the title, or to force a strict fixed-tempo click for a song, create `library/songs.json` (see `library/songs.example.json`):

```json
{
  "tujhe-kitna-chahein-aur-hum": { "title": "Tujhe Kitna Chahein Aur Hum" },
  "some-other-song": { "bpm": 96, "offset": 0.21 }
}
```

Setting `bpm` turns off beat tracking for that song. `offset` is the time, in seconds, of the first beat. Leave both out to keep the tracked click.

---

## Running locally

Requires Node 20.19+ (22 recommended).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/
```

The dev server picks up new files in `library/` and reloads.

To test the GitHub Pages sub-path locally:

```bash
BASE_PATH=/mosaic/ npm run build && BASE_PATH=/mosaic/ npm run preview
# open http://localhost:4173/mosaic/
```

(In Git Bash on Windows, prefix with `MSYS_NO_PATHCONV=1` so `/mosaic/` isn't rewritten as a Windows path.)

### Tests

End-to-end tests use [Playwright](https://playwright.dev) and live in `tests/`. They build the app, serve it under `/mosaic/` and check the home page, share links, importing, playback, seeking, stem sync, mute/solo, the metronome, pitch/speed and the footer.

```bash
npx playwright install chromium   # once
npm test                          # or: PW_CHANNEL=chrome npm test  (use your installed Chrome)
npm run test:ui                   # interactive runner
```

The GitHub workflow runs the tests before each deploy. If they fail, nothing is published.

---

## Deploying to GitHub Pages

1. Push the repo to GitHub.
2. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push to `main`, or run the **Deploy to GitHub Pages** workflow manually from the Actions tab.

The workflow (`.github/workflows/deploy.yml`) builds with `BASE_PATH=/<repo-name>/` and publishes `dist/`. The site will be at `https://<your-user>.github.io/<repo-name>/`.

---

## Versioning

The version shown in the footer comes from `src/version.ts`. Bump it together with `"version"` in `package.json` when you release.

## Limitations

- **Imported songs can't be shared.** They stay in your browser's memory and nothing is uploaded. To share a song, add it to `library/`.
- **File size**: GitHub rejects files over 100 MB, and a Pages site should stay under 1 GB. MP3 stems are usually 3–10 MB each.
- **Don't use Git LFS for `library/`.** GitHub Pages serves LFS pointer files, not the audio.
- **Memory**: stems are decoded fully so they stay perfectly in sync. A 5‑minute song with 6 stems uses roughly 700 MB of RAM. That's fine on computers and recent phones, but very old phones may struggle.
- Beat tracking works from the drums stem (or the first stem if there's no drums). Songs with very sparse or no percussion can confuse it. If that happens, set the tempo by hand or use **Tap tempo** in the metronome panel.
- iOS: the hardware silent switch can mute web audio. Turn it off if you hear nothing.

## Tech

Vite, React and TypeScript, using the Web Audio API. Every stem is decoded into memory and all stems start on the same audio-clock frame, so they stay sample-locked. [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) (AudioWorklet) handles pitch and keeps speed changes pitch-correct, and a built-in beat tracker (onset detection plus dynamic-programming beat tracking, after Ellis 2007, running in a Web Worker) drives the metronome. See [AGENTS.md](AGENTS.md) for the architecture.
