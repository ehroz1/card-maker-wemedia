# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Card Maker — a browser-only tool for generating Instagram cards (a cover + carousel
slides). No backend, no build tooling beyond a single Python packaging script, no
dependencies to install for normal use. Everything (fonts, logos, icons) is embedded
as data URIs into one self-contained `index.html` so it can be dropped on GitHub
Pages or opened from disk. UI text, code comments, and commit-facing docs in this
repo are in Russian — match that when editing README.md or user-facing strings.

The build also emits two small companion files for offline/installable use as a
PWA: `manifest.webmanifest` and `service-worker.js`, written next to `index.html`.
Unlike `index.html` these are *not* single-file-embeddable — a service worker can't
be registered from a `blob:`/`data:` URL by spec, so this is the one place the app
isn't fully self-contained in one file. All three must be deployed together and
kept at the same path (GitHub Pages "root" deploy already does this).

## Commands

Rebuild `index.html` (plus `manifest.webmanifest`/`service-worker.js`) from `src/` +
`brand/` after any source edit — the app that actually runs is the generated
`index.html`, not the files in `src/`:

```bash
python3 build.py
```

Optional, makes the build smaller by subsetting fonts to Latin+Cyrillic (otherwise
fonts embed uncut and the file is bigger, but the build still succeeds):

```bash
pip3 install fonttools brotli
```

Serve locally (needed because `file://` blocks clipboard access, which breaks
copy/paste of cards and photos):

```bash
python3 -m http.server 8000
```

There is no test framework, linter, or package.json. `a.js` is an ad-hoc script
(run with `node a.js`, requires `jsdom`) that exercises `editor.js` functions
(`editorText`, `markupToHtml`/`htmlToMarkup`, RTF clipboard parsing) — treat it as
a scratch harness to extend with more cases when touching `editor.js`, not a
suite to run in CI.

## Architecture

The build (`build.py`) is a pure string-templating step: it reads
`src/index.template.html` and replaces placeholder tokens
(`__FONT_FACES__`, `__CSS__`, `__BUNDLED_BRAND__`, `__ICONS__`, `__FAVICON__`,
`__APPLE_TOUCH_ICON__`, `__RENDER_JS__`, `__EDITOR_JS__`, `__APP_JS__`) with
the corresponding processed content, then writes `index.html`. It fails
loudly if any of the first four (font/CSS/brand/icons) tokens is left
unsubstituted — the two icon `<head>` tokens degrade instead of failing the
build (see below), since a missing icon shouldn't block shipping the app.
Font files from `brand/fonts/` are subset and converted to woff2 (via
fontTools, if installed) and inlined as `@font-face` data URIs; logos from
`brand/` are inlined as data URIs; icons from `brand/icons/*.svg` become a JS
`ICONS` object keyed by filename stem. `__FAVICON__` is `brand/pwa-icon.svg`
inlined as a data URI (SVG favicons work in every browser this app targets);
`__APPLE_TOUCH_ICON__` prefers a pre-rendered `brand/pwa-icon-180.png` over
the SVG — iOS Safari has long been unreliable at rasterizing SVG for the
home-screen icon specifically (unlike the favicon or the manifest icon,
where Android/Chrome's SVG support is fine), so a real PNG is the safe
choice there. `pwa-icon-180.png` is a checked-in binary asset, not generated
by `build.py` (no SVG-rasterizer dependency was worth adding for a single
static icon) — it was produced once by screenshotting `pwa-icon.svg` at
180×180 with headless Chromium; regenerate it by hand the same way if
`pwa-icon.svg` ever changes, `build.py` will only warn (not fail) if it's
stale or missing, falling back to the SVG. It then does the same
`__PWA_ICON__` substitution for `src/manifest.template.json` (also
`brand/pwa-icon.svg` as a data URI — the manifest icon and the favicon are
the same source image, substituted independently since they're two
different template files) and writes it as `manifest.webmanifest`, and
copies `src/service-worker.js` to the output root verbatim (no templating —
it's generic app-shell caching, nothing brand-specific to substitute).
**Always edit `src/`, `brand/`, or `build.py` — never edit `index.html`
directly**, since it's a generated artifact that gets overwritten on the
next build.

Runtime code is split into three plain scripts (no modules/bundler, concatenated
by the build into one `<script>` tag, sharing globals):

- **`src/render.js`** — pure Canvas rendering. `LAYOUTS` holds all three card
  profiles (`cover`, `cardPhoto`, `cardPlain`) as the single source of truth for
  every pixel value (margins, logo position, font sizes, line height) — these
  were measured from design mockups and must not be duplicated elsewhere.
  `parseCards(text)` turns the carousel markup text into card objects;
  `layoutParagraph`/`drawLine` handle text wrapping and glue-word logic
  (`GLUE_WORDS`, `isGlueWord` — short prepositions that must not end a line);
  `renderCard` is the entry point that draws one card (photo, gradient, logo,
  text block) to a canvas at export resolution. Has no DOM dependency beyond a
  `CanvasRenderingContext2D` and `Image` objects, so it's usable headlessly.
- **`src/editor.js`** — converts between the app's own lightweight markup
  (`**bold**`, `_italic_`, a fully-bold line = heading/subtitle, `\v<size>\v`
  size wrapping via `wrapSize`) and the `contenteditable` DOM, in both
  directions: `markupToHtml`/`htmlToMarkup` for the editor's live formatting
  display, plus `clipboardHtmlToMarkup`/`clipboardRtfToMarkup`/
  `clipboardPlainToMarkup` for pasting rich text from Google Docs/Telegram/Word
  without losing bold/italic. `walkEditor` is the shared DOM-tree-walking
  primitive both directions build on.
- **`src/app.js`** — all UI wiring, app `state`, and glue between the editor and
  renderer. Key ideas: `state.cards` is rebuilt from `state.cardsText` via
  `syncCards()` on every input; per-card data that must survive a rebuild
  (photo/video, manual style override, image zoom/pan/rotate) is keyed not by
  array position but by a stable key from `cardKeys()` — the card's `//`
  marker text plus an occurrence count — and stored in `state.photosById`/
  `state.cardStylesById`/`state.transformsById`; `state.cardIds` holds the keys
  for the current `state.cards`, parallel by index, so UI code that operates
  positionally (slide selection, stage pan/pinch/wheel, `setPhoto`) can look
  up the right bucket via `state.cardIds[i]`. This exists specifically so that
  inserting or deleting a card earlier in the text doesn't reassign another
  card's photo/zoom/style to the wrong card — don't reintroduce positional
  (`array[i]`) storage for anything per-card that must outlive a `syncCards()`
  call. The flip side: any operation that *rewrites markers on purpose*
  (toggling «Фото на карточке» turns `//3` into `//3-`; `moveCard` reorders
  blocks and may give the unmarked preamble block a marker) changes keys, so
  it must carry the buckets over with `remapCardKeys(oldKeys, newKeys)` —
  see the blocks model below. Manual per-card style overrides
  (`state.cardStylesById`, `coverStyles`) override the `LAYOUTS` defaults,
  applied via `targetStyle`/`applyStylePatch`; rendering is
  scheduled/debounced through `scheduleRender()`/`renderAll()` rather than
  called directly from input handlers.
  **Drafts**: every project is a draft in `localStorage` under
  `cardmaker.drafts.v1` (a list, newest first, capped at `MAX_DRAFTS` = 40):
  `{id, name, createdAt, updatedAt, data}`, where `data` is `projectData()` —
  text, cover, format, export settings, per-card styles, template name; never
  photos/videos. `saveProject()` re-reads the list before every write
  (read-modify-write, not an in-memory copy) so two tabs editing different
  drafts don't clobber each other. The old single-project key
  `cardmaker.project.v3` is migrated into the first draft by `readDrafts()`
  on first run and left untouched. Media can't be persisted (too big for
  `localStorage`), but `state.sessionMedia[draftId]` keeps each draft's
  photos/videos/transforms in memory while the tab is open
  (`stashSessionMedia`/`restoreSessionMedia`), so going home and reopening a
  draft doesn't lose them; `hasAnyMedia()` drives the `beforeunload` prompt.
  Bump the version suffix if the stored shape changes incompatibly; the
  project file (`exportProjectFile`/`importProjectFile`) is the same
  `projectData()` JSON, and importing opens it as a *new* draft.
  **Templates** (`state.templates`, `cardmaker.templates.v2`, switched and
  edited in the **Проект** tab — `renderProjectForm`) hold brand assets
  (`logo`/`logoDark`/`gradient`) plus each template's cover title/subtitle
  kegl and `coverStyles` (`coverTitleSize`/`coverBodySize`/`coverStyles`
  per entry) — `syncTemplateDesign()` writes the active document's current
  cover sizing into the active template on every change,
  `applyTemplateDesign()` reads it back out when switching templates or
  creating a draft. Keep both in sync when adding more per-template design
  fields — a new field needs to flow through both functions plus
  `newTemplate()` seeding and `resetLogos()` (which must merge — preserve
  fields it isn't touching — not overwrite the whole template object).

The carousel text markup (`//1` new card with photo fallback to white template,
`//2-` photo-less card, `**bold**`, `_italic_`, blank line = spacer line, a
fully-bold line = larger subtitle) is documented for end users in README.md and
implemented across `parseCards` (render.js) and the markup⇄HTML conversion
(editor.js) — keep both in sync when changing the format. `splitBlocks`/
`joinBlocks` in app.js (the per-card view of the same text, below) must also
agree with `parseCards` on where a card starts — they share `MARKER_RE`'s
idea of a marker line, and an unmarked non-empty preamble before the first
marker is a card for both.

**UI shell** (redesigned after the author's own edubridge project): two
screens in one page, toggled by `showHome()`/`showEditor()` (`state.screen`).
The **home** screen (`renderHome`) lists drafts with a live canvas preview of
each draft's cover (`paintPreview`, drawn with that draft's own template
assets) and three format tiles (`FORMAT_INFO`: 4:5 / 1:1 / 9:16), each with
«Начать с примером» / «Пустой» → `createDraft(format, withSample)`. The
**editor** is a topbar (back, editable `#docName`, undo/redo, focus mode,
help, theme, **Экспорт** popover) over a three-column `.workspace`: slide
list (`renderSlidesList`/`buildSlideItem` — thumbnails, per-item tools, drag
to reorder, file drop), the stage (`#stageCanvas` + `#stageOverlay`,
`wireStage` for pointer pan / pinch / wheel zoom / drop), and a side panel
with three tabs (`setTab`: `slide` / `text` / `project`). Only the active tab
is built; `refreshEditor()` re-renders it from `state` after any structural
change, so forms never hold state of their own.

**Hybrid text editing — the blocks model.** `state.cardsText` (the `//N`
markup) stays the single source of truth for carousel text. The «Весь текст»
tab edits it whole (`#cardsText`); the «Слайд» tab's `#cardEditor` edits
only the current card's block. `splitBlocks(text)` → `{prefix, blocks}`
where each block is `{marker, body[]}` (`marker: null` for an unmarked
preamble; leading blank lines are `prefix`), and `joinBlocks` is its exact
inverse (`joinBlocks(splitBlocks(t)) === t`). `cardBody(i)`/`setCardBody(i,
markup)` read/write one block's body *minus/plus its trailing blank lines*,
which are the visual separator in the whole-text view and belong to the
gap, not the card. Both editors go through one abstraction — a *binding*
`{kind, el, get, set}` (`wholeBinding()`/`cardBinding()`, resolved from the
DOM with `bindingFor(node)`) — so paste, ⌘B/⌘I, the selection-size picker
(`restyleSelection`) and `insertMarkup` are written once. `lastCaret`
remembers the selection when focus moves to a toolbar button or the size
`<select>`. While typing in the whole text, `followCaretCard()` selects the
slide under the caret. Structural card ops (`addCard`, `duplicateCard`,
`moveCard`, `deleteCard`, `setCardUsePhoto`) all work on blocks, then
`commitCardsText()` (`syncCards` + `refreshEditor` + `saveProject`);
`autoSplitText()` rewrites the whole text and ends the same way.

**Checks under the stage** (`renderWarnings`): `renderCard()` returns
`{overflow}`, which `paintCard` records per slide in `state.overflow` — shown
as «Текст не помещается» plus a «Уместить» button and an amber dot on the
slide's thumbnail. `autoFit(index)` shrinks kegl in 1% steps, re-running
`renderCard` on a scratch canvas until it fits, never below `FIT_MIN_RATIO`
(70%) of the `LAYOUTS` size — for the cover it scales title and subtitle
together (template-level sizes, so it goes through `syncTemplateDesign`),
for a card it patches that card's style override. `photoUpscale(card)`
warns when the export would stretch a photo more than `UPSCALE_WARN`
(1.25×); duplicate photos are detected by `findDuplicatePhotoOwner`.

**Export** (`exportSlides(mode, onlyIndex)`, `mode` = `'zip'` | `'files'`,
`onlyIndex` for «Только текущий слайд») lives in the topbar popover
(`openExportPop`/`syncExportPop`; ⌘S runs `state.exportMode`). File names are
ASCII on purpose: Chromium silently renames an `a.download` containing
Cyrillic to `download`, so slides are `00-oblozhka`/`NN-kartochka` and the
ZIP/project file names go through `fileSlug()` (Russian→Latin `TRANSLIT`
table + slugify, with a fallback when nothing survives).

**Video support** generalizes the existing photo pipeline rather than
duplicating it: `state.photosById[id]` holds either an `HTMLImageElement` or
an `HTMLVideoElement`, and `ctx.drawImage()`/canvas rendering in `render.js`
accepts both interchangeably, so `renderCard`/`drawPhoto`/`coverCrop` needed
almost no video-specific branching — the one exception is `coverCrop`, which
reads `img.videoWidth || img.width` (`<video>.width`/`.height` are HTML
attributes, not the decoded frame size, unlike `<img>`). `fileToVideo()` in
app.js (parallel to `fileToImage()`) creates the `<video>` element via
`URL.createObjectURL` (not a data URI — keeps large video files out of
memory as base64) and stashes `trimStart`/`trimEnd`/`durationUnknown`
directly as properties on the element itself, which is enough for them to
ride along through undo/redo (`state.photosById` snapshots are shallow
copies) without any new persistence machinery. Because a `<video>` element
has a single shared `currentTime`, `duplicateCard` cannot share a video
reference the way it safely shares an `Image` between two card keys — it
goes through `cloneMediaForDuplicate()` to create an independent `<video>`
on the same source URL, which is why `duplicateCard` is `async`. Trim is
asked immediately on upload — `setPhoto` awaits `askVideoTrim([{card, index}])`
right after a video resolves — rather than gating export; the same modal
reopens any time via «Обрезать» in the stage overlay (`renderStageOverlay`
adds a `.media-tools` pill over a video slide → `openTrimFor(index)`), so
export itself (`exportSlides`) never blocks on a trim prompt, it just reads whatever is currently on `video.trimStart`/
`trimEnd`. Inside `askVideoTrim`, the scrubber (`.vt-scrubber`, two
pointer-dragged `.vt-handle`s) and the numeric fields write straight to
`video.trimStart`/`trimEnd` as the user interacts — no separate draft state —
so the modal's own "▶ Просмотр" preview always plays exactly what would be
exported; a snapshot of the original values taken at open time is restored
on Cancel. The same live `<video>` element is reparented into the modal
(`videoWrap.appendChild(video)`) while open and detached again on close
(`video.remove()`) rather than duplicating the source, since it's otherwise
never in the DOM (only ever a `ctx.drawImage()` source). Playing a video's
preview on the stage («Смотреть»/«Пауза» in the same overlay pill) works
the same way at a smaller scale: `toggleVideoPreviewPlayback` sets
`video._previewPlaying` and calls `.play()`, a `timeupdate` listener
(`wirePreviewLoop`, shared between `fileToVideo()` and
`cloneMediaForDuplicate()` so a duplicated video card's preview loops too —
it was previously missing there, a latent gap from before preview-looping
existed) loops `currentTime` back to `trimStart` whenever playback reaches
`trimEnd` (only while `_previewPlaying` is true — export doesn't set that
flag, so its own `timeupdate` stop-detection in `exportVideoCard` never
races with it), and a shared
`requestAnimationFrame` loop (`ensurePreviewPlayLoop`) calls `renderAll()`
at a throttled ~25fps for as long as any card's video is playing, since the
normal debounced `scheduleRender()` path only redraws on input, not
continuously. `exportSlides` calls `stopAllVideoPreviews()` first to guarantee
no preview loop is fighting a video mid-export. `exportVideoCard` re-draws
`renderCard()` on every `requestAnimationFrame` while the source video plays
through the trim window, captured via `canvas.captureStream()` +
`MediaRecorder`; `VIDEO_EXPORT_CANDIDATES` tries `video/mp4` variants before
falling back to `video/webm` ones via `MediaRecorder.isTypeSupported()` —
Chrome/Edge can record MP4 directly today, Safari always could, browsers
that can't fall back to WebM with no extra code path, and there's
deliberately no ffmpeg.wasm or other muxer dependency to force MP4
everywhere (would fight the single-file/no-dependency architecture for a
multi-MB WASM payload; Firefox has no MediaRecorder MP4 support at all as of
this writing, so it's the one browser that still gets WebM even though the
fallback list would happily hand it MP4 if `isTypeSupported()` ever said
yes). The canvas stream is video-only by construction, so audio is tapped
separately straight off the source: `video.captureStream()` (or
`.mozCaptureStream()`) is called on the same `<video>` used as the render
source, and its audio track(s) are merged into a combined `MediaStream`
with the canvas's video track before it's handed to `MediaRecorder`. No Web
Audio graph needed for this; that would only matter for mixing/volume
control, not just passing audio through. The video element is *not*
`.muted` by default any more (it was, back when export was silent and
muting kept preview/export behavior visually consistent) — `fileToVideo()`
leaves it unmuted so the preview («Смотреть» on the stage, "▶ Просмотр" in
the trim modal) is actually audible, and `exportVideoCard` mutes it only for the
duration of its own recording (saves/restores `video.muted`) purely so a
several-video export doesn't blast every clip's audio out the speakers at
once. In Chrome/Firefox this local mute has no effect on
`captureStream()`'s audio track — verified against a real decoded
recording — but it does in Safari: a user report showed Safari's exported
MP4 silently losing audio while the same clip in Firefox (WebM) kept it,
and the working theory (WebKit's media pipeline ties the captured track's
content to presentation `.muted` state more tightly than Chromium's does)
led to two order-of-operations fixes in `exportVideoCard`, both cheap and
harmless in browsers that didn't need them: (1) `captureStream()`'s audio
tracks are grabbed *before* `video.muted = true` runs, not after — the
recorder is constructed once we already have the tracks, so the mute can
no longer taint them; (2) the `<video>` element, which otherwise is never
in the DOM at all outside the trim modal, is temporarily appended
off-screen (`position: fixed; left: -9999px`, not `display: none` — some
engines pause decoding for elements with no layout box at all) for the
span of the recording and removed again in a `finally`, on a report that
Safari's `captureStream()` is unreliable for audio on a detached element.
Neither fix has been confirmed against real Safari (not available to test
here) — if audio is still missing there after this, the mute-timing and
DOM-attachment theories were wrong and the real cause needs revisiting
with an actual WebKit build in hand, not more guessing from Chromium
behavior.
`VIDEO_EXPORT_CANDIDATES_WITH_AUDIO` (picked over the video-only list
whenever `getAudioTracks()` returns anything) drops the explicit codec
string for MP4 down to bare `video/mp4` — `MediaRecorder.isTypeSupported()`
rejects explicit AAC codec strings like `mp4a.40.2`/`aac` even where it
accepts the unqualified MIME type, verified empirically, not from spec
reading. If the browser has no `captureStream()` on `<video>` at all (older
Safari) or the source clip has no audio track, export silently falls back
to the video-only path exactly as before — no error, no user-visible
difference beyond the exported file being silent. An
`onProgress(fraction)` callback threaded through `exportVideoCard` (driven
by the same `timeupdate` listener that detects the trim end) feeds
`updateExportProgress()`, which drives the thin bar in the export popover
(`#exportProgress`/`#exportProgressBar`) — each card is an equal share of
the bar, and a video card's share fills gradually instead of jumping.

**MediaRecorder start/stop ordering in `exportVideoCard`** — measured in
Chromium, don't "simplify" it back: the encoder (MP4 especially) only spins
up once the canvas track delivers its first frame, and the `start` event
arrives 0.3–1 s after that. (a) Calling `recorder.stop()` before `start` has
fired produces a **0-byte file** — this is how short clips used to export
empty — and stopping right after `start` still drops frames that hadn't
reached the encoder (the file keeps one frame). So once the trim end is
reached, `stop()` only pauses the video and sets `ended`; the actual
`recorder.stop()` waits until `STOP_GRACE_MS` (300 ms) after `onstart`,
while the rAF `draw` loop keeps feeding the (now static) last frame so the
encoder keeps receiving frames. (b) Frames drawn *before* `start` fires are
**not** lost — the file's timeline starts at the first frame — so playback
starts immediately after `recorder.start()`, not in `onstart`. (c) Don't
pre-draw a frame before `recorder.start()` "to wake the encoder" (edubridge
does): the timeline would then start at that frame and the whole encoder
spin-up would be baked into the file as a frozen first frame (a 1.47 s clip
exported as ~2.6 s). Net effect verified: 1.47 s → 1.46 s, 5 s → 4.95 s,
and a 0.37 s clip → ~0.46 s (full clip plus a short held tail) instead of
empty. The `hardStopAt` guard still ends everything if `start` never comes.

`exportSlides` doesn't process cards with a single `for` loop: photo cards
all render concurrently via `Promise.all` (cheap, no reason to serialize),
and video cards run through a small worker-pool (`VIDEO_EXPORT_CONCURRENCY`
workers each pulling the next unprocessed video index off a shared
`cursor`) instead of one `exportVideoCard` at a time. This matters because
video export is real-time-bound — recording an 8s clip takes ≥8s no matter
what — so the only way to cut a multi-video carousel's total export time is
to have several recordings in flight at once instead of summing their
durations; wall-clock time for N video cards tends toward
`ceil(N / VIDEO_EXPORT_CONCURRENCY) × (longest clip in that batch)` rather
than the sum of all of them. `VIDEO_EXPORT_CONCURRENCY` is derived from
`navigator.hardwareConcurrency`, clamped to [2, 4] — deliberately not
unbounded, since each concurrent recording is its own canvas +
`MediaRecorder` + rAF loop, and letting a carousel with a dozen video cards
launch a dozen simultaneous encoders is more likely to drop frames or
exhaust memory than to finish faster. This is safe to parallelize because
`exportVideoCard` is fully self-contained per call — its own `canvas`,
`ctx`, `recorder`, and closures, operating on a distinct card object and a
distinct `<video>` element per card (every video card always has its own
element; see `cloneMediaForDuplicate` above) — the only things read across
calls (`currentAssets()`, `currentGradient()`, `state.format`,
`state.exportScale`) are effectively read-only for the duration of an
export. `slots`/`progress` are indexed by the card's position in the
export list so results and per-card progress land in the right place
regardless of which job (photo or video) finishes first; `rendered` (the
final `{name, blob}` list used for ZIP/download) is `slots.filter(Boolean)`
built only after every job in both groups has settled.

`copyCurrent()`/`sendToTelegram()` were deliberately left photo-only in
behavior — for a video card they fall back to snapshotting the current
frame, not the full clip. Videos are never explicitly
`URL.revokeObjectURL()`-ed, matching the existing precedent of never
disposing photo `Image` objects (both can still be reachable from the undo
stack).

**Dark theme** covers the tool's own UI chrome only — never the exported cards,
which always render in fixed brand colors regardless of app theme (`render.js`
has no theme awareness at all, by design). The chrome is mostly white/black
with five accents, each with one fixed role (documented at the top of
`styles.css`): `--blue` #3A80FE selection/focus/progress, `--green` #059458
"all good", `--red` #C32B5B delete/errors, `--amber` #BF8300 warnings,
`--violet` #7344EA video and `//N` markers in the text. Primary buttons are
black on light and invert to white on dark (`--primary-bg`/`--primary-text`),
not an accent. Accent *fills* are the same in both themes; text drawn in an
accent color uses the `--*-text` variants, which are lightened in dark mode
for contrast, and tinted backgrounds use `--*-soft`. All chrome colors are
CSS custom properties on `:root`; dark values live in two blocks that must
be kept in sync: `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {...} }`
(follows the OS setting until the user picks explicitly) and `:root[data-theme="dark"]`
(the explicit override, set by `toggleTheme()` in app.js and persisted to
`localStorage` under `cardmaker.theme.v1`). A tiny inline `<script>` in
`index.template.html`'s `<head>` — before `<style>`, deliberately not templated
through `__APP_JS__` — applies a saved explicit choice before first paint to
avoid a flash of the wrong theme; it must stay a plain inline script for that
ordering to work. Icons are Phosphor Icons, Bold weight (MIT, license in
`brand/icons/LICENSE`, taken from the `@phosphor-icons/core` npm package),
each a single-path SVG with `fill="currentColor"`. They're inserted into the
DOM as live markup (`paintIcons` for `data-icon` placeholders in the
template, the `icon` attribute of the `h()`/`btn()` helpers for UI built in
code), not `<img>`/data-URIs, so they simply take the `color` of whatever
button they sit in and repaint with the theme — a new icon should be another
Phosphor Bold SVG with `fill="currentColor"`, never a hardcoded color. The
stage overlay pills (`.slot-hint`, `.media-tools`) intentionally use fixed
colors, not theme variables: they sit on top of the card canvas, whose
colors don't follow the theme either.

**Mobile layout**: breakpoints in `styles.css` are 1180px (narrower side
columns), 900px (the three columns stack: stage first, then the slide list
as a horizontal strip, then the side panel; per-thumbnail tools are hidden
there, so the same actions also live in the slide form's «Карточка» block)
and 560px (phone: `.hide-sm` controls hidden, modals go full-screen, the
export popover spans the width). Under 900px `.stage` gets an explicit
`height: 60vh` — as a `flex: 1` child of an auto-height column it would
collapse to zero. `.modal` keeps `grid-template-columns: minmax(0, 1fr)`:
without it the implicit grid column sizes itself to the modal card's own
preferred width, `max-width: 100%` then resolves against that same column
and constrains nothing, and every modal silently overflows a phone screen
with its close button off-screen — a general trap with centered grid/flex
items worth remembering for any future modal-like component. Touch targets
are enlarged under `@media (hover: none)`.

**Installing to the home screen** was already technically possible before
this (manifest + service worker satisfy Chrome/Android's installability
criteria) but undiscoverable — Chrome/Android's own install affordance is
tucked into a menu and won't offer itself on a first visit, and iOS Safari
has no install-prompt API at all (the only path is Share → "Add to Home
Screen", which nothing on the page ever mentioned). `wireInstallBanner()`
in app.js adds a single dismissible in-app banner (`#installBanner`) that
covers both cases from one code path: on Android/Chrome it listens for
`beforeinstallprompt`, calls `preventDefault()` to suppress the browser's
own mini-infobar, stashes the event, and shows a real "Установить" button
that calls the saved event's `.prompt()` when clicked; on iOS
(`isIosDevice()` — iPadOS 13+ reports as `platform: 'MacIntel'` like a real
Mac, distinguished only by `maxTouchPoints > 1`) there is no such event, so
the banner instead just shows static instructions, with no action button
(there is nothing to programmatically trigger). The banner never shows at
all if `isStandaloneDisplay()` is already true (`display-mode: standalone`
media query, or `navigator.standalone` — the old iOS Safari property) or if
the user already dismissed it once (`cardmaker.installDismissed.v1` in
localStorage) — it's meant to be seen once, not nagged.

Compatibility constraints baked into the code (see README.md "Совместимость"):
letter-spacing falls back to manual per-character drawing when
`ctx.letterSpacing` is unsupported; missing `ResizeObserver`/clipboard API must
degrade gracefully rather than break the page; `localStorage` may be unavailable
in private browsing; video export feature-detects `MediaRecorder.isTypeSupported()`
across `VIDEO_EXPORT_CANDIDATES` (mp4 variants, then vp9 → vp8 → plain webm)
and fails with a clear message rather than a crash if none is supported,
without blocking export of the remaining photo cards. The app makes no
network requests at all at runtime (stock photo search was removed in the
redesign), so everything works offline once the page is cached.
