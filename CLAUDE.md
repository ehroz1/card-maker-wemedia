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
(`__FONT_FACES__`, `__CSS__`, `__BUNDLED_BRAND__`, `__ICONS__`, `__RENDER_JS__`,
`__EDITOR_JS__`, `__APP_JS__`) with the corresponding processed content, then
writes `index.html`. It fails loudly if any token is left unsubstituted. Font
files from `brand/fonts/` are subset and converted to woff2 (via fontTools, if
installed) and inlined as `@font-face` data URIs; logos from `brand/` are
inlined as data URIs; icons from `brand/icons/*.svg` become a JS `ICONS` object
keyed by filename stem. It then does the same substitution for
`src/manifest.template.json` (the one token, `__PWA_ICON__`, becomes a data URI
of `brand/pwa-icon.svg`) and writes it as `manifest.webmanifest`, and copies
`src/service-worker.js` to the output root verbatim (no templating — it's
generic app-shell caching, nothing brand-specific to substitute). **Always edit
`src/`, `brand/`, or `build.py` — never
edit `index.html` directly**, since it's a generated artifact that gets
overwritten on the next build.

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

Compatibility constraints baked into the code (see README.md "Совместимость"):
letter-spacing falls back to manual per-character drawing when
`ctx.letterSpacing` is unsupported; missing `ResizeObserver`/clipboard API must
degrade gracefully rather than break the page; `localStorage` may be unavailable
in private browsing; video export feature-detects `MediaRecorder.isTypeSupported()`
across `VIDEO_EXPORT_CANDIDATES` (mp4 variants, then vp9 → vp8 → plain webm)
and fails with a clear message rather than a crash if none is supported,
without blocking export of the remaining photo cards.
