# Library Programs Flyer Maker

## Overview
A browser-based tool for creating monthly library program flyers with automatic content reflow. Eliminates manual repositioning when programs are added, removed, or changed.

## Tech Stack
- **Vanilla HTML5/CSS3/JavaScript (ES6+)** — no frameworks, no build process
- **IIFE module pattern** for all JS files (no ES6 imports in browser code)
- **CDN dependencies**: jsPDF, html2canvas, Sortable.js, Font Awesome, Google Fonts
- **Dev tooling**: ESLint + Vitest (via npm)
- **Hosting**: GitHub Pages (open `index.html` directly)

## File Structure
```
index.html                          Single-page application entry point
assets/
  css/styles.css                    All UI styles, CSS variables, responsive layout
  js/
    config.js                       Constants, defaults, colors, fonts, timing
    image-store.js                  IndexedDB wrapper for high-res image storage
    flyer-utils.js                  Pure/utility functions (testable, no DOM)
    app.js                          Core app logic: rendering, UI, state, PDF export
  img/
    footer-english-default.png      Default English footer (4800x600px, 600 DPI)
    footer-spanish-default.png      Default Spanish footer (4800x600px, 600 DPI)
tests/
  flyer-utils.test.js              Unit tests for utility functions
eslint.config.js                   ESLint config (ES2022, script sourceType, browser globals)
vitest.config.js                   Vitest config (jsdom environment)
CLAUDE.md                          This file
README.md                          Project overview and usage guide
```

## Script Load Order (critical)
In `index.html`, scripts load in this order:
1. CDN libraries (Sortable.js, jsPDF, html2canvas, Font Awesome, Google Fonts)
2. `config.js` → exposes `CONFIG` globally
3. `image-store.js` → exposes `ImageStore` globally (IndexedDB, no dependencies)
4. `flyer-utils.js` → exposes `FlyerUtils` globally (depends on CONFIG)
5. `app.js` → exposes `FlyerApp` globally, calls `init()` on DOMContentLoaded

Changing load order will break the app. Each file depends on the previous ones.

## Running the Application
No build step required. Either:
- Open `index.html` directly in a browser
- Use a local server: `npx serve .` or `python -m http.server`

## Development Commands
```bash
npm install          # Install dev dependencies (first time only)
npm run lint         # ESLint on assets/js/
npm run test         # Vitest (one-shot)
npm run test:watch   # Vitest (watch mode)
```

Both lint and test must pass before committing.

## Data Model
The app state is a multi-page JSON-serializable structure:
- `schema` — version string for forward compatibility
- `meta` — month, year, page size, list name (shared across pages)
- `fontRoles` — font family assignments per role (shared across pages)
- `pages[]` — array of page objects, each containing:
  - `header` — title/month text, colors
  - `branches[]` — array of branch objects, each with programs[]
  - `footer` — image source, custom image data, asterisk note (supports multi-line)
  - `styles` — font sizes, bold toggles, column widths, strip/border settings

Programs support:
- **Structured fields**: name, subtitle (with optional inline append), date (with date note), time
- **Free-text override**: single text block with custom font size, alignment, bold/italic
- **Closure mode**: branch-color background with white text (structured or free-text)
- **Color override**: per-program color that overrides the branch color

## Key Functional Areas
1. **Rendering Engine** (app.js) — Builds flyer preview as DOM, auto-reflows on change
2. **Program Editor** (app.js) — Sidebar with inline edit forms, drag-and-drop (cross-branch)
3. **Save/Load** (app.js) — JSON .flyer files, localStorage autosave, draft recovery
4. **PDF Export** (app.js) — 600 DPI via html2canvas + jsPDF, with vertical text rasterization
5. **Page System** (app.js) — Multi-page support with duplication and per-page settings
6. **Settings** (app.js) — Typography, column widths, colors, page size, footer management

## Layout Architecture
- **Content wrapper**: Flex column filling page margins (0.25" on all sides)
- **Header**: Title + month text, configurable colors and font size
- **Branches container**: `flex: 1` with `minHeight: 0` and `justify-content: space-between`
  - Branches auto-distribute vertically to fill available space
  - Container can shrink below content height to keep footer pinned
  - Overlap detection warns when branches are squeezed by 20px+
- **Footer**: Pinned at bottom, contains optional asterisk note + footer image
- **Branch rectangles**: Left strip (name) + content area + right strip (address)
  - Strips use `writing-mode: vertical-rl` with auto-sizing
  - Filled mode: container `backgroundColor` fills gaps (with `backgroundClip: padding-box`)
  - Unfilled mode: colored border lines between strips and content

## PDF Export Notes
- Vertical text (`writing-mode: vertical-rl`) is not supported by html2canvas
- `rasterizeVerticalText()` pre-renders vertical text onto canvas elements
- CSS `text-transform` must be applied manually to canvas-drawn text
- Export resets zoom to 100%, renders each page into off-screen containers sequentially

## Cross-File Dependencies
| When changing...    | Also check...                                    |
|---------------------|--------------------------------------------------|
| `config.js`         | `flyer-utils.js` (uses CONFIG), `app.js`, tests  |
| `image-store.js`    | `app.js` (calls ImageStore for kid mode images)   |
| `flyer-utils.js`    | `app.js` (calls FlyerUtils), tests               |
| `app.js`            | `index.html` (DOM IDs), `styles.css` (classes)    |
| `styles.css`        | `app.js` (class names, inline styles), `index.html` |
| `index.html`        | `app.js` (querySelector targets)                  |

## Rules for Modifying the Codebase
- **Constants** → `config.js` inside `CONFIG` object. Never hardcode in app.js.
- **Pure functions** → `flyer-utils.js` inside `FlyerUtils`. Must be testable without DOM.
- **DOM/UI logic** → `app.js` inside `FlyerApp` IIFE.
- **All JS files** use the IIFE pattern exposing a single global object.
- **No ES6 imports** in browser code (intentional: no build step).
- **Debounce** preview updates (~300ms) and autosave (~400ms).
- **Default layout baseline**: Filled Strips off + Branch Borders on. Changes must not alter dimensions relative to this baseline.

## Conventions
- UUIDs for all branch and program IDs
- Branch colors used for: sidebar strips, branch name, address, program text, closure rows
- Per-program color override takes precedence over branch color
- Closure rows: branch-color (or override color) background, white text
- Subtitles: always normal weight (400), never inherit bold from closure
- Footer images: 4800x600px (8"x1" at 600 DPI)
- Asterisk note: supports multi-line via `white-space: pre-line`
- PDF export: 600 DPI, JPEG 0.92 quality
- Save files use `.flyer` extension (JSON format, supports legacy single-page)
- Column widths: configurable per page (default: Name 48%, Date 32%, Time 20%)
- `lastColorOverride` remembers the most recent color override for convenience

## Kid Mode
A variant flyer format for children's programs. Each program is its own rounded-rectangle card (no branch grouping). Features:
- **Card layout**: Colored border (branch color), image zone (left), name+subtitle (center), date/time/branch (right)
- **Image support**: Per-card image upload and name image upload (replaces text name), stored in IndexedDB via `ImageStore`
- **Multi-location**: Cards can show multiple branch locations in a side-by-side layout
- **Announcement area**: Free-text zone between header and cards
- **Auto-reflow**: Cards distribute vertically to fill the page
- **Data model**: `cards[]` + `announcement` instead of `branches[]`; images embedded in .flyer files for portability
- **Letter size only**: Page size locked to letter when Kid Mode is active
