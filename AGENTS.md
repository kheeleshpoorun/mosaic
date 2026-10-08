# AGENTS.md

Guidance for AI coding agents and contributors working on this repo.

## What this is

Mosaic is a static single-page app that copies the **Moises mobile mixer**. It plays song stems with per-stem mute, solo and volume, a metronome, and pitch and speed controls. There is **no backend**, and that is a hard constraint:

- **Library songs** live in `library/` and are copied into the build. They can be shared with `?song=<slug>`, which skips the home page.
- **Imported songs** come from drag and drop or the file picker. They exist only in memory as `File`s / blob URLs and can't be shared. Don't add features that assume a server.

Hosting is GitHub Pages, deployed by `.github/workflows/deploy.yml`.

## Commands

```bash
npm install
npm run dev        # dev server; serves library/ via the plugin's middleware
npm run build      # tsc --noEmit + vite build → dist/
npm run preview
npm run typecheck
npm test           # Playwright e2e + unit tests (builds and serves under /mosaic/)
```

Tests live in `tests/` and run against a production build under the GitHub Pages sub-path. Locally, `PW_CHANNEL=chrome npm test` uses your installed Chrome; otherwise run `npx playwright install chromium` once. CI runs the suite before every deploy. **Add or update tests whenever you change behaviour**, and run `npm test` before you finish.

`BASE_PATH` sets Vite's `base`. CI sets it to `/<repo>/`. Always build URLs from `import.meta.env.BASE_URL` and never hard-code `/`.

## Layout

```
scripts/library-plugin.ts   Vite plugin: scans library/ → `virtual:library` manifest; dev middleware serves
                            files under <base>library/; build emits them into dist/library/
src/App.tsx                 View switch + URL state (?song=<slug> | ?import=<id>), history handling
src/lib/parseStemName.ts    Filename → { songName, stemName }; slugify. Shared by the browser AND the Node plugin,
                            so keep it dependency-free.
src/lib/stemMeta.tsx        Stem name → label, icon, sort order (vocals, drums, bass, piano, keys, guitar, …, other)
src/lib/library.ts          Manifest → SongSource[]; shareUrl()
src/lib/importFiles.ts      Dropped files/folders → SongSource[]
src/audio/Engine.ts         Audio engine + tiny store (subscribe/getState for useSyncExternalStore)
src/audio/metronome.ts      Look-ahead click scheduler on the AudioContext clock (tracked beats or fixed grid)
src/audio/beats.ts          Beat tracker: onset envelope → tempo (autocorrelation) → DP beat tracking → downbeat.
                            Pure function of samples (unit-tested with synthetic drums in tests/beats.spec.ts)
src/audio/beats.worker.ts   Runs analyzeBeats off the main thread
src/audio/bpm.ts            detectBeats(buffer): mono downmix → worker (main-thread fallback)
src/components/Home/        Home page: drop zone, Library and Imported lists
src/components/Player/      Header, StemRow, SeekBar, Slider, Transport, bottom sheets
src/components/Footer.tsx   Version + credit line (home and player)
src/components/icons/       Hand-drawn inline SVG line icons in the Moises style
src/version.ts              APP_VERSION — bump together with package.json "version"
src/styles/tokens.css       Colour and size tokens sampled from the Moises screenshot
src/styles/app.css          All component styles (BEM-ish class names)
tests/                      Playwright specs (parse, home, player) + helpers.ts
playwright.config.ts        Builds with BASE_PATH=/mosaic/, serves via vite preview on :4173
library/                    Shareable stems (committed). Optional library/songs.json overrides title, or forces a fixed bpm/offset.
design/                     Local Moises reference screenshots (git-ignored)
```

## Naming convention for stems

`<Song name>_<stem>_mixed.<ext>` is the Moises export format. `<Song>_<stem>.<ext>` and `<Song> - <stem>.<ext>` also work. The **last** `_` separates the stem from the song name. Library slugs come from `slugify(songName)` and are part of share URLs, so changing `slugify` breaks existing links.

## Audio engine invariants

- **Every stem is decoded to an `AudioBuffer`** and played by an `AudioBufferSourceNode`: `source → GainNode → master → limiter → [SoundTouch] → destination`. Don't go back to one `<audio>` element per stem. Separate media elements can't be kept sample-locked, and the drums audibly drift. The cost is memory (~120 MB per 5‑minute stereo stem at 44.1 kHz). Decoding runs two stems at a time to cap the peak.
- **Sync**: `startSources(offset)` stops every source, creates new ones and calls `start(when, offset)` with the **same** `when` (`currentTime + 50 ms`) on all of them, so they begin on the same audio frame. Position comes from that shared anchor (`anchorOffset + (ctx.currentTime − anchorTime) · speed`). Play, seek and skip all go through `startSources`.
- **Mute/solo rule**: a stem is audible when `!muted && (!anySolo || soloed)`. See `Engine.audible`. Muted stems keep playing at gain 0 so they stay in sync.
- **Volume**: slider position 0..1. `DEFAULT_VOLUME = 0.75` is unity gain, and `sliderToGain` is quadratic. A limiter on the master stops boosted stems from clipping.
- **Speed** is `playbackRate` on every source, set with `setValueAtTime` on one shared time, and the anchor is re-based. SoundTouch gets the same `playbackRate` (so it cancels the pitch change) plus `pitchSemitones`. SoundTouch is bypassed when speed = 1 and pitch = 0.
- **Metronome** connects straight to the destination, so pitch shifting never affects it. Clicks fall on **tracked beats** (`beats[k] + offset`). With a fixed grid (`beats === null`, after a manual tempo change or a `songs.json` bpm) they're at `offset + k·60/bpm`. Track times are mapped to the context clock with `toCtxTime` and scheduled up to 120 ms ahead. The accent falls on every 4th beat from `downbeat`.
- **Don't go back to a single fixed BPM grid as the default.** Detected tempos are never exact, and a 0.5 BPM error is already about 1 s off after 3 minutes. Off-the-shelf BPM detectors also return integer tempos, and `web-audio-beat-detector` failed outright on the sample song, which left the click at 120 BPM.
- **Beat tracking** reuses the decoded drums buffer, so nothing is downloaded again. It runs in a worker and the result is cached in localStorage as `mosaic:beats:v2:<slug>`. **Bump the version in the key** whenever `beats.ts` changes. Frame times must use the exact `fps = sampleRate / hop`, never the nominal 100, because a rounded hop stretches the timeline.
- `window.__mosaicEngine` is a test hook (Playwright reads `state`, `position` and `syncReport()`). Keep those names stable or update `tests/helpers.ts`.
- Always `dispose()` the engine when unmounting. It stops the sources, drops the buffers and closes the AudioContext.

## UI rules

- The look must match Moises (reference: `design/` screenshots, which are local only). Use the tokens in `tokens.css`, not new raw colours.
- Mobile-first column (`--column: 520px`) with a vertical gradient background, white content and grey secondary text. Stem rows show only an icon, a thin white slider and a ⋮ menu. They have no names and no waveforms.
- Features deliberately left out: chord strip, lyrics, sections, A‑B loop, isolate chips. Don't add dead placeholder buttons for them.
- **Dev server honours HTTP Range** (`library-plugin.ts` middleware returns 206). Keep it: browsers and range-based fetches depend on it.
- `Slider` is driven by native `input`/`change` listeners and only writes `value` to the element while not dragging. Don't turn it back into a controlled React range input: the seek bar's value changes every frame and fights the drag.
- Icons are inline SVG (`currentColor`, 1.5 stroke, round caps). Add new ones to `components/icons/index.tsx`.
- Touch targets are at least 44px. Keep `env(safe-area-inset-*)` padding.

## Deployment notes

- Pages source must be set to **GitHub Actions** in the repo settings.
- Library audio is committed directly. **Don't use Git LFS** (Pages serves LFS pointer files), and GitHub's per-file limit is 100 MB.
- `design/` is git-ignored. Don't commit screenshots of the Moises app.
