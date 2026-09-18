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
on the same source URL, which is why `duplicateCard` is `async`. Export asks
the user for a trim range per video card (`askVideoTrim`, a modal built like
`#helpModal`) immediately before the export loop runs, then
`exportVideoCard` re-draws `renderCard()` on every `requestAnimationFrame`
while the source video plays through the trim window, captured via
`canvas.captureStream()` + `MediaRecorder` into a WEBM blob — deliberately
silent (no audio track): muxing audio and video client-side was judged too
fragile for this pass. `copyCurrent()`/`sendToTelegram()` were deliberately
left photo-only in behavior — for a video card they fall back to snapshotting
the current frame, not the full clip. Videos are never explicitly
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
(vp9 → vp8 → plain webm) and fails with a clear message rather than a crash
if none is supported, without blocking export of the remaining photo cards.
