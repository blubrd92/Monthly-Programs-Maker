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
```

## Script Load Order (critical)
In `index.html`, scripts load in this order:
1. CDN libraries (Sortable.js, jsPDF, html2canvas, Font Awesome, Google Fonts)
2. `config.js` → exposes `CONFIG` globally
3. `flyer-utils.js` → exposes `FlyerUtils` globally (depends on CONFIG)
4. `app.js` → exposes `FlyerApp` globally, calls `init()` on DOMContentLoaded

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
The app state is a single JSON-serializable object containing:
- `schema` — version string for forward compatibility
- `meta` — month, year, page size, list name
- `header` — title/month text and colors
- `branches[]` — array of branch objects, each with programs[]
- `footer` — image source, custom image data, asterisk note
- `styles` — all font sizes, spacing, bold toggles

Programs support structured fields (name, subtitle, date, time, age group) or a free-text override for non-standard entries.

## Key Functional Areas
1. **Rendering Engine** (app.js) — Builds flyer preview as DOM, auto-reflows on change
2. **Program Editor** (app.js) — Sidebar with inline edit forms, drag-and-drop
3. **Save/Load** (app.js) — JSON .flyer files, localStorage autosave, draft recovery
4. **PDF Export** (app.js) — 600 DPI via html2canvas + jsPDF
5. **Page System** (app.js) — Multi-page support with duplication
6. **Settings** (app.js) — Typography, colors, page size, footer management

## Cross-File Dependencies
| When changing...    | Also check...                                    |
|---------------------|--------------------------------------------------|
| `config.js`         | `flyer-utils.js` (uses CONFIG), `app.js`, tests  |
| `flyer-utils.js`    | `app.js` (calls FlyerUtils), tests               |
| `app.js`            | `index.html` (DOM IDs), `styles.css` (classes)    |
| `styles.css`        | `app.js` (class names), `index.html`              |
| `index.html`        | `app.js` (querySelector targets)                  |

## Rules for Modifying the Codebase
- **Constants** → `config.js` inside `CONFIG` object. Never hardcode in app.js.
- **Pure functions** → `flyer-utils.js` inside `FlyerUtils`. Must be testable without DOM.
- **DOM/UI logic** → `app.js` inside `FlyerApp` IIFE.
- **All JS files** use the IIFE pattern exposing a single global object.
- **No ES6 imports** in browser code (intentional: no build step).
- **Debounce** preview updates (~300ms) and autosave (~400ms).

## Conventions
- UUIDs for all branch and program IDs
- Branch colors used for: sidebar strips, branch name, address, program text, closure rows
- Closure rows: branch-color background, white text
- Footer images: 4800x600px (8"x1" at 600 DPI)
- PDF export: 600 DPI, JPEG 0.92 quality
- Save files use `.flyer` extension (JSON format)
