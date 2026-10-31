# AGENTS.md

Guidance for AI coding agents and contributors working on this repo.

## What this is

Mosaic is a static single-page app that copies the **Moises mobile mixer**. It plays song stems with per-stem mute, solo and volume, a metronome, pitch and speed controls, and a chord strip with the song's key. There is **no backend**, and that is a hard constraint:

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

## Versioning

**Bump the version yourself** before you finish any change that affects the shipped app. Don't wait to be asked. Follow semver (`MAJOR.MINOR.PATCH`), and update `APP_VERSION` in `src/version.ts`, `"version"` in `package.json` and the root `version` fields in `package-lock.json` together.

1. **Look at the change set.** Run `git status` and `git diff HEAD` and include untracked files. If there's no commit yet, treat everything as new.
2. **Start from the version at `HEAD`** (`git show HEAD:src/version.ts`), not the working tree. That way repeated edits in one change set bump once. If the working tree already has a bump and the new work deserves a bigger one, raise it. For example, if the tree already has a patch bump, a new feature makes it a minor bump from `HEAD`. Never stack bumps.
3. **Pick the level from the biggest change:**
   - **Major** (`x.0.0`): something existing users or links would break on. Examples: share URLs stop resolving (`slugify` or `?song=` changes), the stem naming convention or `songs.json` format stops accepting files that used to work, or a user-facing feature is removed.
   - **Minor** (`1.x.0`): a new user-visible feature or capability, or a clear behaviour change that stays backwards compatible. Examples: a new control or sheet, a new import format, a reworked loading experience.
   - **Patch** (`1.1.x`): bug fixes, visual polish, copy changes, performance work and refactors that change nothing the user can see.
   - **No bump**: changes that don't ship in the app, such as tests only, docs (`README.md`, `AGENTS.md`), CI workflows or editor config.
4. Bumping resets the lower parts to zero (`1.2.3` → `1.3.0` for a minor bump). Say which level you picked and why in your summary.

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
src/audio/peaks.ts          computePeaks(channels): per-stem waveform overview (RMS dB, gated). Pure, unit-tested
src/audio/chords.ts        Chord + key recogniser: beat-synchronous chroma (harmonic stems + bass stem) → templates
                            (maj, min, 7, maj7, m7, N) → Viterbi → key. Pure, unit-tested in tests/chords.spec.ts
src/audio/chords.worker.ts  Runs analyzeChords off the main thread
src/audio/chordDetect.ts    detectChords(buffers, beats): mixes/decimates stems to ~11 kHz → worker (main-thread fallback)
src/audio/drums.ts          Drum transcriber: band energy rises (kick, toms, snare body/wires, cymbals) → hits on a
                            sixteenth (or, swung, triplet) grid per tracked beat → crash/open/closed hat by ring time,
                            ghost snares → meter → bars clustered into grooves (repeat / fill / rest) → roadMap().
                            Pure, unit-tested in tests/drums.spec.ts
src/audio/drums.worker.ts   Runs analyzeDrums off the main thread
src/audio/drumDetect.ts     detectDrums(drums, beats, downbeat): decimates the drums stem to ~22 kHz → worker (fallback)
src/audio/mixDown.ts        Sum buffers to mono + integer decimation (shared by chordDetect and drumDetect)
src/lib/chords.ts           Chord/key names (transposed, ♯/♭ spelled by key), Roman numerals, chord tones, guitar shapes
src/lib/chordChart.ts       Chords → bars (chordChart, beat by beat, repeat signs) → song map of progressions. Pure, unit-tested
src/audio/pitchDelay.ts     measurePitchDelay: SoundTouch's processing delay, measured offline per speed/pitch (cached)
src/components/Home/        Home page: drop zone, Library and Imported lists
src/components/Player/      Header, ChordStrip (+ useChords, ChordSheet chart/map/shapes), DrumStrip (+ useDrums, DrumSheet,
                            DrumNotation), MiniPlayer (docked in sheets), timeline.ts (segmentAt/useStarts), StemRow, StemWave, SeekBar, Slider,
                            Transport, bottom sheets
src/components/Footer.tsx   Version + credit line (home and player)
src/components/icons/       Hand-drawn inline SVG line icons in the Moises style
src/version.ts              APP_VERSION — bumped per change set (see Versioning), in sync with package.json
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

- **Every stem is decoded to an `AudioBuffer`** and played by an `AudioBufferSourceNode`: `source → GainNode → master → limiter → [SoundTouch] → output limiter → destination`. Don't go back to one `<audio>` element per stem. Separate media elements can't be kept sample-locked, and the drums audibly drift. The cost is memory (~120 MB per 5‑minute stereo stem at 44.1 kHz). Decoding runs two stems at a time to cap the peak.
- **Sync**: `startSources(offset)` stops every source, creates new ones and calls `start(when, offset)` with the **same** `when` (`currentTime + 50 ms`) on all of them, so they begin on the same audio frame. Position comes from that shared anchor (`anchorOffset + (ctx.currentTime − anchorTime) · speed`). Play, seek and skip all go through `startSources`.
- **Mute/solo rule**: a stem is audible when it isn't muted. Solo is not a separate state: `toggleSolo` mutes every other stem, or unmutes all of them when the stem is already the only one unmuted (`Engine.isSolo`, which also flips the menu label to "Unmute all"). Muted stems keep playing at gain 0 so they stay in sync.
- **Volume**: slider position 0..1. `DEFAULT_VOLUME = 0.75` is unity gain, and `sliderToGain` is quadratic. A limiter on the master stops boosted stems from clipping.
- **Speed** is `playbackRate` on every source, set with `setValueAtTime` on one shared time, and the anchor is re-based. SoundTouch gets the same `playbackRate` (so it cancels the pitch change) plus `pitchSemitones`. SoundTouch is bypassed when speed = 1 and pitch = 0. SoundTouch delays the music by ~0.1–0.15 s (its WSOLA window). `measurePitchDelay` (`pitchDelay.ts`) measures that delay offline for each speed/pitch, and the engine shifts the clicks by the same amount (`toHeardTime`, `heardPosition`). `startSources` connects a **fresh** SoundTouch node each time, because the old one keeps audio buffered from before a pause or seek and would push the music further behind.
- **Metronome** connects straight to the output limiter (after SoundTouch), so pitch shifting never affects it. It plays one pre-rendered click (`renderClick`, a bright 2–5 kHz tick, Moises style) on every beat, with no accent. Its volume slider goes up to +12 dB (`metronomeGain`), and the output limiter ducks the mix under the click rather than letting it clip, so it stays audible over loud songs. Clicks fall on **tracked beats** (`beats[k] + offset`). With a fixed grid (`beats === null`, after a manual tempo change or a `songs.json` bpm) they're at `offset + k·60/bpm`. Track times are mapped to the context clock with `toCtxTime` and scheduled up to 120 ms ahead.
- **Don't go back to a single fixed BPM grid as the default.** Detected tempos are never exact, and a 0.5 BPM error is already about 1 s off after 3 minutes. Off-the-shelf BPM detectors also return integer tempos, and `web-audio-beat-detector` failed outright on the sample song, which left the click at 120 BPM.
- **Beat tracking** reuses the decoded drums buffer, so nothing is downloaded again. It runs in a worker and the result is cached in localStorage as `mosaic:beats:v2:<slug>`. **Bump the version in the key** whenever `beats.ts` changes. Frame times must use the exact `fps = sampleRate / hop`, never the nominal 100, because a rounded hop stretches the timeline.
- **Chords** are recognised once per song, after the beats are known (tracked beats, the `songs.json` tempo, or the metronome grid if tracking failed), from the already-decoded stems (`Engine.chordBuffers`: everything but drums and vocals, plus the bass stem for roots). Nothing is fetched again. The result is cached in localStorage as `mosaic:chords:v1:<slug>`. **Bump the version in the key** whenever `chords.ts` changes. Later metronome edits don't move the chords.
- **Drums** are transcribed once per song the same way: after the beats are known (tracked beats + their `downbeat`, the `songs.json` tempo, or the metronome grid), from the already-decoded drums stem only (`Engine.drumBuffer`; no drums stem → "No drum stem", no other stem stands in). Cached as `mosaic:drums:v1:<slug>`. **Bump the version in the key** whenever `drums.ts` changes. Bar-level labels are the musician-facing ones: a groove's pattern, `repeat` (𝄎, same groove as the bar before), `fill`, `rest`. Don't go back to lettered grooves (A, B, C…): they meant nothing to a drummer and were unstable on busy songs. Hits are compared across bands to keep leakage out (a band far under the loudest one is absent; a snare needs body under its wires); keep that when tuning thresholds.
- `window.__mosaicEngine` is a test hook (Playwright reads `state`, `position` and `syncReport()`). Keep those names stable or update `tests/helpers.ts`.
- Always `dispose()` the engine when unmounting. It stops the sources, drops the buffers and closes the AudioContext.

## UI rules

- The look must match Moises (reference: `design/` screenshots, which are local only). Use the tokens in `tokens.css`, not new raw colours.
- Mobile-first column (`--column: 520px`) with a vertical gradient background, white content and grey secondary text. Stem rows show only an icon, a thin white slider and a ⋮ menu, with no names. Behind the slider sits a faint, smooth, filled whole-song waveform (`StemWave`; the song ⋮ menu can hide it, remembered per viewer in localStorage as `mosaic:waveforms`): brighter where already played (clipped to `--progress` on `.stems`, so playback never redraws the canvas), scaled with the volume and dimmed when muted. It's `pointer-events: none`; the slider keeps all input. Peaks are computed once from the already-decoded buffer (`Engine.peaksFor`), never by fetching or decoding again.
- **Chord strip** sits on top of the stems: a fixed key badge (tapping opens Pitch & speed) and chords scrolling right to left under a fixed playhead, driven by the same `scrub ?? position` as the waveforms (only the track's `transform` changes per frame). Tapping it opens `ChordSheet`, a chord chart like the drum sheet: chord now / next and `Key · meter · Bar n of N` pinned on top, then the chart (bars four per line, each bar's chords by beat, 𝄎 for a bar played again, the current bar lit with a beat cursor and kept in view; tapping a bar seeks there), then the song map (progressions ×count, loose bars, stretches with no chords; tapping one seeks), then "Chord shapes", collapsed by default (`mosaic:chord-shapes`): guitar/piano diagrams of every chord in the song (`mosaic:chord-instrument`), the one playing lit. Names or Roman numerals relative to the key (`mosaic:chord-view`). Bars come from the drum transcription (its meter and downbeat) when there is one, else the metronome's beats in 4/4 (`barsFromBeats`). Chord and key names follow the pitch control and are spelled with ♯ or ♭ to match the transposed key. The key is shown once per place: the strip badge, and the subtitle of the existing Key row in Pitch & speed (`Am → Bm` when transposed). The song ⋮ menu can hide the strip (`mosaic:chords`).
- **Drum strip** sits under the chord strip, built the same way (shared CSS rules, same `PX_PER_SECOND` and playhead), and reads like a drum chart: the bar's mini pattern (cymbals / snare+toms / kick rows, faint beat lines) where a groove starts (`drums__chip--change`), a repeat sign for each bar that plays it again, fills highlighted, rests left empty. Its badge shows BPM and meter and opens the Metronome. Tapping it opens `DrumSheet`: the bar playing now (step cursor) and the next one, as a step grid (one row per drum the song uses, counted "1 e & a") or `DrumNotation` (five-line percussion staff, simplified engraving, remembered as `mosaic:drum-view`), then the song map (grooves ×bars, fills, rests; tapping one seeks there). The song ⋮ menu can hide the strip (`mosaic:drums`).
- **Mini player**: the sheets you read or tweak while listening (Drums, Chords, Metronome, Pitch & speed) pass a `MiniPlayer` as `Sheet`'s `dock`, pinned under the scrolling `.sheet__body`: seek bar, ±5 s and play/pause, sharing the player's `scrub` state so the strips and sheets follow a drag. Menus (song ⋮, stem ⋮) have no dock. It uses its own classes (`.mini-player*`), never `.seek` / `.transport__play`, which the tests use to find the main controls.
- Features deliberately left out: lyrics, sections, A‑B loop, isolate chips. Don't add dead placeholder buttons for them.
- **Dev server honours HTTP Range** (`library-plugin.ts` middleware returns 206). Keep it: browsers and range-based fetches depend on it.
- `Slider` is driven by native `input`/`change` listeners and only writes `value` to the element while not dragging. Don't turn it back into a controlled React range input: the seek bar's value changes every frame and fights the drag.
- Tapping a stem icon toggles mute; holding it for 500 ms calls `toggleSolo` (as in Moises), and the click that ends the hold is swallowed. The ⋮ menu keeps Solo / Unmute all too.
- Icons are inline SVG (`currentColor`, 1.5 stroke, round caps). Add new ones to `components/icons/index.tsx`.
- Touch targets are at least 44px. Keep `env(safe-area-inset-*)` padding.

## Deployment notes

- Pages source must be set to **GitHub Actions** in the repo settings.
- Library audio is committed directly. **Don't use Git LFS** (Pages serves LFS pointer files), and GitHub's per-file limit is 100 MB.
- `design/` is git-ignored. Don't commit screenshots of the Moises app.
