# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Card Maker — a browser-only tool for generating Instagram cards (a cover + carousel
slides). No backend, no build tooling beyond a single Python packaging script, no
dependencies to install for normal use. Everything (fonts, logos, icons) is embedded
as data URIs into one self-contained `index.html` so it can be dropped on GitHub
Pages or opened from disk. UI text, code comments, and commit-facing docs in this
repo are in Russian — match that when editing README.md or user-facing strings.

## Commands

Rebuild `index.html` from `src/` + `brand/` after any source edit — the app that
actually runs is the generated `index.html`, not the files in `src/`:

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
keyed by filename stem. **Always edit `src/`, `brand/`, or `build.py` — never
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
  renderer. Key ideas: `state.cards`/`state.cardStyles` are rebuilt from
  `state.cardsText` via `syncCards()` on every input; each card can have manual
  per-card style overrides (`cardStyles[i]`, `coverStyles`) that override the
  `LAYOUTS` defaults, applied via `effectiveStyle`/`applyStylePatch`; rendering
  is scheduled/debounced through `scheduleRender()`/`renderAll()` rather than
  called directly from input handlers; `saveProject`/`loadProject` persist
  text/settings (not photos) to `localStorage` under `cardmaker.project.v2` /
  `cardmaker.templates.v2` — bump the `.v2` suffix if the stored shape changes
  incompatibly.

The carousel text markup (`//1` new card with photo fallback to white template,
`//2-` photo-less card, `**bold**`, `_italic_`, blank line = spacer line, a
fully-bold line = larger subtitle) is documented for end users in README.md and
implemented across `parseCards` (render.js) and the markup⇄HTML conversion
(editor.js) — keep both in sync when changing the format.

Compatibility constraints baked into the code (see README.md "Совместимость"):
letter-spacing falls back to manual per-character drawing when
`ctx.letterSpacing` is unsupported; missing `ResizeObserver`/clipboard API must
degrade gracefully rather than break the page; `localStorage` may be unavailable
in private browsing.
