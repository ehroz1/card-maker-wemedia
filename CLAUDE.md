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
  positionally (selection, drag/pinch/wheel handlers, `setPhoto`) can look up
  the right bucket via `state.cardIds[i]`. This exists specifically so that
  inserting or deleting a card earlier in the text doesn't reassign another
  card's photo/zoom/style to the wrong card — don't reintroduce positional
  (`array[i]`) storage for anything per-card that must outlive a `syncCards()`
  call. Manual per-card style overrides (`state.cardStylesById`, `coverStyles`)
  override the `LAYOUTS` defaults, applied via `effectiveStyle`/
  `applyStylePatch`; rendering is scheduled/debounced through
  `scheduleRender()`/`renderAll()` rather than called directly from input
  handlers; `saveProject`/`loadProject` persist text/settings (not photos) to
  `localStorage` under `cardmaker.project.v3` / `cardmaker.templates.v2` —
  bump the version suffix if the stored shape changes incompatibly.
  `state.templates` (named, switchable via the **Шаблоны проекта** menu,
  `templatesMenu`) originally only held brand assets (`logo`/`logoDark`/
  `gradient`) but now also carries each template's own cover title/subtitle
  kegl and `coverStyles` (`coverTitleSize`/`coverBodySize`/`coverStyles` per
  entry) — `syncTemplateDesign()` writes the active document's current cover
  sizing into the active template on every change, `applyTemplateDesign()`
  reads it back out when switching templates. Keep both in sync when adding
  more per-template design fields — a new field needs to flow through both
  functions plus the "Новый шаблон…" seeding and "Вернуть логотипы по
  умолчанию" merge (which must preserve fields it isn't touching, not
  overwrite the whole template object).

The carousel text markup (`//1` new card with photo fallback to white template,
`//2-` photo-less card, `**bold**`, `_italic_`, blank line = spacer line, a
fully-bold line = larger subtitle) is documented for end users in README.md and
implemented across `parseCards` (render.js) and the markup⇄HTML conversion
(editor.js) — keep both in sync when changing the format.

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
reopens any time via the "✂" button `buildPreviews()` adds to video-card
frames (`.edit-trim`), so export itself (`exportAll`) no longer blocks on a
trim prompt, it just reads whatever is currently on `video.trimStart`/
`trimEnd`. Inside `askVideoTrim`, the scrubber (`.vt-scrubber`, two
pointer-dragged `.vt-handle`s) and the numeric fields write straight to
`video.trimStart`/`trimEnd` as the user interacts — no separate draft state —
so the modal's own "▶ Просмотр" preview always plays exactly what would be
exported; a snapshot of the original values taken at open time is restored
on Cancel. The same live `<video>` element is reparented into the modal
(`videoWrap.appendChild(video)`) while open and detached again on close
(`video.remove()`) rather than duplicating the source, since it's otherwise
never in the DOM (only ever a `ctx.drawImage()` source). Playing a video's
preview in its card thumbnail (the "▶" button `buildPreviews()` also adds)
works the same way at a smaller scale: `toggleVideoPreviewPlayback` sets
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
continuously. `exportAll` calls `stopAllVideoPreviews()` first to guarantee
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
leaves it unmuted so the preview ("▶" on the card, "▶ Просмотр" in the trim
modal) is actually audible, and `exportVideoCard` mutes it only for the
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
`updateExportProgress()`, which drives the thin bar under the Export button
(`#exportProgress`/`#exportProgressBar`) — each card is an equal share of
the bar, and a video card's share fills gradually instead of jumping.

`exportAll` no longer processes cards with a single `for` loop: photo cards
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

**Stock photo search** is the one place the app talks to the network at all —
everything else is genuinely offline-capable. A "🔍" button
`buildPreviews()` adds to every non-video frame (`.find-photo`, sharing its
corner with `.edit-trim`/`.has-video` the same way `.find-photo`/`.edit-trim`
are each other's complement via CSS) opens `#stockPhotoModal` via
`openStockPhotoModal(index)`, which pre-fills the query from
`stockQueryFor(index)` — the cover's title/body, or a card's first non-empty
`line` with markup stripped (`stripMarkupForQuery`) — and kicks off
`runStockSearch(true)`. `searchStockPhotos()` fans out to four source
functions in parallel (`searchPixabay`/`searchPexels`/`searchUnsplash`/
`searchOpenverse`), each normalizing its provider's very different response
shape into `{id, thumb, full, width, height, source, credit, creditUrl}`
(plus `downloadLocation`, Unsplash-only — see below), then
round-robin-interleaves whatever came back so the grid mixes sources instead
of listing one provider's results before the next. None of the four
functions ever throws — network/parse errors are caught and turned into an
empty array — so `Promise.all` in `searchStockPhotos()` never needs
`allSettled`, and one provider being down or unconfigured just thins the
results rather than breaking the search. `PIXABAY_API_KEY`/`PEXELS_API_KEY`/
`UNSPLASH_ACCESS_KEY` are placeholder strings (`'ВАШ_КЛЮЧ_...'`) that ship
unset; each search function checks for the placeholder prefix and returns
`[]` immediately rather than firing a request that can only 401 — all three
keys are free (no card) from pixabay.com/api, pexels.com/api and
unsplash.com/developers, and need to be pasted into these constants before
rebuilding for that source to participate. Unsplash's demo-tier key is
capped at 50 requests/hour (its own quota, separate from Pixabay/Pexels) —
raising that needs applying for Production access on
unsplash.com/oauth/applications, a manual review, not something this repo
can do for the user. Openverse needs no key (anonymous requests, tighter
per-IP rate limit) and works out of the box. Unlike Pixabay/Pexels/Unsplash
— all three blanket-licensed for commercial use — Openverse aggregates
mixed Creative Commons licenses, so its query pins `license=cc0,pdm,by,by-sa`
and the response filter drops anything without both `width`/`height`
reported (can't verify the `STOCK_MIN_SIZE` floor otherwise) — deliberately
not `by-nc`/`by-nd` variants, since the app always composites text/logo
over the photo, which is a derivative use an ND license forbids regardless
of the NC question. Clicking a result thumbnail (`insertStockPhoto`) closes
the modal, fetches `result.full` and hands the response `Blob` straight to
the existing `setPhoto(index, blob)` — no new image-loading path needed,
since `fileToImage()` already reads via `FileReader.readAsDataURL()`, which
accepts any `Blob` (not just a `File`), and a `Blob` from `fetch()` carries
a real `.type` from the server's `Content-Type` header so `isVideoFile()`
still resolves correctly. Routing the fetched bytes through `FileReader`
into a `data:` URI (rather than pointing an `Image.src` straight at the
provider's URL) is what keeps the canvas untainted for `renderCard`/export
even though the source was cross-origin — same reason regular file uploads
never hit CORS/tainting issues either. Unsplash's API Guidelines require
firing a tracking request to `links.download_location` whenever a photo is
actually used (not just displayed in search results) — `insertStockPhoto`
does this as a fire-and-forget `fetch()` right after `setPhoto` succeeds,
using `result.downloadLocation` carried through from `searchUnsplash`;
failing this silently (`.catch(() => {})`) is deliberate, since it's a
usage-accounting ping, not something the insert flow should ever block or
fail on.

**Dark theme** covers the tool's own UI chrome only — never the exported cards,
which always render in fixed brand colors regardless of app theme (`render.js`
has no theme awareness at all, by design). All chrome colors are CSS custom
properties on `:root` in `styles.css`; dark values live in two blocks that must
be kept in sync: `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {...} }`
(follows the OS setting until the user picks explicitly) and `:root[data-theme="dark"]`
(the explicit override, set by `toggleTheme()` in app.js and persisted to
`localStorage` under `cardmaker.theme.v1`). A tiny inline `<script>` in
`index.template.html`'s `<head>` — before `<style>`, deliberately not templated
through `__APP_JS__` — applies a saved explicit choice before first paint to
avoid a flash of the wrong theme; it must stay a plain inline script for that
ordering to work. Icons (`brand/icons/*.svg`) are inserted into the DOM as live
markup (`node.innerHTML = svg` in `paintIcons`), not `<img>`/data-URIs, so they
can reference the same CSS variables directly in their own `fill`/`stroke`
attributes (`var(--icon-bg)`/`var(--icon-fg)` for the neutral bar-button icons,
`var(--control)` for the small inline glyphs like the select caret) and repaint
automatically with the theme — a new icon should follow this convention rather
than hardcoding `white`/`#414141`. Two color roles are intentionally *not*
theme-reactive and must stay off the `--white`/`--ink` etc. variables: brand
accents (`--green`, the amber `--warn`) and `--on-accent` (always `#fff`, for
text/glyphs drawn on top of a permanently-colored surface like `.btn-green` or
the multi-select checkmark badge) — using the wrong one is the easiest way to
end up with invisible text after a theme edit.

**Mobile layout** builds on the responsive CSS that already existed
(`@media (max-width: 1000px)` stacks the three panels; `@media (max-width:
560px)` is the phone tier) rather than replacing it. Two real, previously
unnoticed bugs were found and fixed while testing this at actual phone
viewport widths (desktop-only manual testing had never caught either):
(1) `.modal { display: grid; place-items: center }` had no
`grid-template-columns`, so the single implicit column sized itself to the
modal card's own unconstrained `width: 560px` — `max-width: 100%` on the
card then resolved against that same self-sized column and constrained
nothing, so every modal (Help, stock-photo search, video trim) silently
overflowed the viewport on narrow screens with no visible scrollbar cue,
pushing close buttons and controls off-screen. Fixed by adding
`grid-template-columns: minmax(0, 1fr)`, which ties the column to the
modal's actual (viewport-derived) width instead of the item's preferred
size — a general trap with centered (non-stretched) grid/flex items and
worth remembering for any future modal-like component. (2) `.page-footer`
switches from `position: fixed` to `position: static` under the 560px
breakpoint (so it takes normal space instead of always overlapping page
bottom), but `body` stayed `display: flex` in row direction, so the footer
became a *second row-flex sibling* next to `.workspace` instead of a line
below it — visually, the footer text landed squeezed into the top-right
corner. Fixed with `body { flex-direction: column }` under the same
breakpoint. Separately (not a bug, a deliberate change): the bottom `.bar`
has ~20 buttons, which wrapped into a tall multi-row block on phone widths
that visibly covered page content — changed to a single non-wrapping row
with `overflow-x: auto` (native horizontal swipe/scroll) under the phone
breakpoint instead, keeping the bar's height to one row; button and frame
corner-control (`remove-photo`/`select-badge`/`edit-trim`/`find-photo`)
touch targets were also bumped up under `@media (hover: none)`, since their
desktop sizes (16–18px) are too small to reliably tap.

**Bottom bar as a dock**: on desktop the `.bar` never wraps
(`flex-wrap: nowrap`). Icon size is a CSS variable, `--dock-size`
(default 32px). `fitDock()` in app.js recomputes it on resize from the
real button/separator count and the bar's computed gap/padding, down to
`DOCK_MIN`, so the row shrinks instead of wrapping. Don't hardcode a
button count in CSS. `wireDock()` adds macOS-dock magnification, a vanilla
port of the idea behind Aceternity's React/framer-motion `FloatingDock`
(there's no React or framer-motion here): each button's target size falls
off with a cosine over `DOCK_RANGE` px from the cursor, and a rAF loop
eases the current size toward it. The loop reads every rect before writing
any size, to avoid layout thrash. The bar has a fixed height with
`align-items: flex-end`, so magnified icons grow upward past the bar
instead of resizing it. Inline sizes are removed once an icon settles back
to base. Tooltips (`.dock-tip`) replace native `title`: on each hover the
button's `title` moves to `data-tip`/`aria-label`, re-done on every hover
because `syncThemeButton()` rewrites the theme button's `title`.
Magnification only runs for `(hover: hover) and (pointer: fine)` above the
phone breakpoint (`DOCK_PHONE_MAX_WIDTH`, which must match the 560px phone
tier in styles.css), and it's skipped under `prefers-reduced-motion`. The
phone tier keeps its own fixed 40px, horizontally scrolling row and hides
`.dock-tip`.

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
without blocking export of the remaining photo cards; stock photo search is
the one feature that needs real network access to third-party APIs and
degrades to "no results" rather than breaking anything else when offline or
when a source's key isn't configured.

**Note for whoever picks this up next**: the stock photo search
(`searchPixabay`/`searchPexels`/`searchUnsplash`/`searchOpenverse`) was
built from the providers' documented API contracts but has never been
exercised against the live APIs — this dev sandbox's egress proxy
hard-blocks `api.openverse.org` (and presumably would block
`pixabay.com`/`pexels.com`/`api.unsplash.com` too) with a 403 on CONNECT,
and no Pixabay/Pexels/Unsplash API keys were available to test with
regardless. Everything *around* the network calls (modal
open/close, query prefill, the click-to-insert pipeline via `setPhoto`) was
verified end to end by swapping in a fake local image result, which is a
real test of that code path — but the actual `fetch()` calls, exact
response field names, and the assumption that these providers' image CDNs
send CORS headers permissive enough for `fetch()` to read the bytes (not
just `<img>`-display them) are unverified. Test against the real APIs
before trusting this in production, and if the response shape doesn't
match, the fix is almost certainly a small field-name mismatch in the one
`.map()` in the relevant search function, not the surrounding structure.
