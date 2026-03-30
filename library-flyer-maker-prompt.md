# Claude Code Prompt: Library Programs Flyer Maker

## What This Document Is

This is a complete design specification and build prompt for a web-based tool that creates monthly library program flyers. Use this as the primary instruction document when building the project. Read the entire document before writing any code.

---

## Project Overview

### The Problem
A library staff member creates a monthly one-page flyer listing all programs happening across multiple library branches. She currently uses Canva. The flyer looks great, but whenever a program is added, removed, or changed, she has to manually shift every element below it to make room or close gaps. This tool eliminates that pain by automatically reflowing content when programs change.

### The Solution
A browser-based tool that:
- Lets the user enter programs organized by branch
- Automatically lays out and reflows the flyer when anything changes (the core feature)
- Shows a live WYSIWYG preview that matches the printed output
- Exports a print-ready 600 DPI PDF
- Saves/loads flyer data as JSON files for month-to-month reuse (she copies last month's flyer and edits it)
- Allows duplicating a page (for creating translated versions or other variants)

### Tech Stack
- **Vanilla HTML5/CSS3/JavaScript (ES6+)**, no frameworks, no build process
- Hosted on **GitHub Pages** (open `index.html` directly or via local server)
- IIFE module pattern for all JS files (no ES6 imports in browser code, no build step)
- External dependencies via CDN only: jsPDF, html2canvas, Sortable.js, Font Awesome, Google Fonts
- ESLint + Vitest for dev tooling (via npm)
- No backend, no database, no authentication

---

## Architecture

### File Structure
```
index.html                          Single-page application
assets/
  css/
    styles.css                      Main UI styles, CSS variables, responsive layout
  js/
    config.js                       All constants, defaults, colors, font config
    flyer-utils.js                  Shared pure/utility functions (testable)
    app.js                          Core application logic (IIFE)
  img/
    footer-english-default.png      Default English footer (4800x600px, 600 DPI)
    footer-spanish-default.png      Default Spanish footer (4800x600px, 600 DPI)
tests/
  flyer-utils.test.js               Unit tests for utility functions
eslint.config.js                    ES2022, sourceType "script", browser + CDN globals
vitest.config.js                    jsdom environment
CLAUDE.md                           Project documentation for Claude Code
```

### Script Load Order (in index.html)
CDN libraries load first (Sortable.js, jsPDF, html2canvas, Font Awesome, Google Fonts), then:
1. `config.js` -> exposes `CONFIG` globally
2. `flyer-utils.js` -> exposes `FlyerUtils` globally (depends on CONFIG)
3. `app.js` -> exposes `FlyerApp` globally, calls `init()` on DOMContentLoaded

### Module Pattern
All JS files use IIFEs that expose a single global object. No ES6 imports in browser code. This is intentional: no build step, direct GitHub Pages deployment.

```javascript
// Example pattern for each file:
const FlyerApp = (function() {
  'use strict';
  // Private state and functions
  // ...
  return { init, /* public API */ };
})();
```

### Development Commands
```bash
npm run lint        # ESLint on assets/js/
npm run test        # Vitest (one-shot)
npm run test:watch  # Vitest (watch mode)
```

Lint and test should both pass before committing changes.

---

## Fonts

The original Canva flyer uses two commercial fonts (Klein Condensed and Bw Mitga) that are not available as web fonts. The tool provides three free Google Fonts alternatives for each, configurable in settings. The user can switch between them.

### Klein Condensed Replacements (used for: header title, program names, dates, times, addresses)
Klein Condensed is a geometric condensed sans-serif inspired by Futura with humanist softening.

1. **Barlow Condensed** (DEFAULT) -- Closest match. Condensed grotesk, slightly rounded, low contrast. Designed for information-dense layouts. Full weight range: Thin through Black.
2. **Encode Sans Condensed** -- More neutral, very even stroke width, excellent small-size legibility. Clean and professional.
3. **Saira Condensed** -- More modern and technical feel, taller proportions, sharper personality.

### Bw Mitga Replacements (used for: branch/location names like DOWNTOWN, NORTHGATE)
Bw Mitga is a geometric sans-serif with sharp angles and subtly bowed diagonals. Used only for short, bold, all-caps display text.

1. **Red Hat Display** (DEFAULT) -- Geometric sans with even strokes and human touches. Designed for headlines and bold display use. Closest to Bw Mitga's personality.
2. **Albert Sans** -- Geometric with subtle humanist warmth. Softer, more approachable.
3. **Outfit** -- Clean geometric, sits between Red Hat Display's sharpness and Albert Sans's softness.

### Font Loading
All six font families must be loaded via Google Fonts CDN in `index.html`, with the weights needed (Regular 400, Bold 700 at minimum; Medium 500 and SemiBold 600 also useful). Include a font preloader section (hidden divs that force font loading before canvas drawing).

### Font Configuration in CONFIG
```javascript
// Font role assignments (which Google Font is used for which purpose)
FONT_ROLES: {
  headerTitle: "'Barlow Condensed', sans-serif",     // "LIBRARY PROGRAMS"
  headerMonth: "'Barlow Condensed', sans-serif",     // "FEBRUARY 2026"
  branchName: "'Red Hat Display', sans-serif",       // "DOWNTOWN", "NORTHGATE"
  programName: "'Barlow Condensed', sans-serif",     // Program titles
  programDate: "'Barlow Condensed', sans-serif",     // "Monday, February 2"
  programTime: "'Barlow Condensed', sans-serif",     // "5:30pm-6:30pm"
  programSubtitle: "'Barlow Condensed', sans-serif", // Subtitles, age groups
  branchAddress: "'Barlow Condensed', sans-serif",   // "1100 E STREET"
},

// Available font options for each role (user can switch in settings)
FONT_OPTIONS: {
  condensed: [
    { value: "'Barlow Condensed', sans-serif", label: 'Barlow Condensed' },
    { value: "'Encode Sans Condensed', sans-serif", label: 'Encode Sans Condensed' },
    { value: "'Saira Condensed', sans-serif", label: 'Saira Condensed' },
  ],
  display: [
    { value: "'Red Hat Display', sans-serif", label: 'Red Hat Display' },
    { value: "'Albert Sans', sans-serif", label: 'Albert Sans' },
    { value: "'Outfit', sans-serif", label: 'Outfit' },
  ],
},
```

---

## Colors

All colors from the original Canva flyer:

```javascript
COLORS: {
  headerTitle: '#000000',           // "LIBRARY PROGRAMS" -- black
  headerMonth: '#cc007e',           // "FEBRUARY 2026" -- magenta/pink

  branches: {
    downtown:  '#0474bf',           // Blue
    cityHall:  '#ff1a05',           // Red
    northgate: '#e87c09',           // Orange
    alBoro:    '#7ca633',           // Green
    online:    '#8d44ad',           // Purple
  },
},
```

Branch colors are used for:
- The colored sidebar strip on the left edge of each branch section
- The branch name text
- The address text (same color as branch)
- Program name text within that branch
- Date text within that branch (bold)
- The background fill for closure/holiday rows

### Footer Images

Two default footer images ship with the tool, both exactly 8 inches wide by 1 inch tall (4800 x 600 pixels at 600 DPI):

- `assets/img/footer-english-default.png` -- English branding (logos, contact info, ADA notice in English)
- `assets/img/footer-spanish-default.png` -- Spanish branding (logos, contact info, ADA notice in Spanish)

The footer image fills the full content width between margins. The footer source is stored per-page in the data model, so different pages can use different footers. The user can also upload a custom footer image that replaces both defaults for that page.

```javascript
FOOTER: {
  defaultImages: {
    'default-english': 'assets/img/footer-english-default.png',
    'default-spanish': 'assets/img/footer-spanish-default.png',
  },
  widthInches: 8.0,
  heightInches: 1.0,
  widthPx: 4800,    // at 600 DPI
  heightPx: 600,    // at 600 DPI
},
```

---

## Data Model

### Flyer Object (top-level state)
```javascript
{
  schema: 'library-flyer-v1',
  savedAt: ISO8601 string,
  meta: {
    month: 'February',
    year: 2026,
    pageSize: 'letter',             // 'letter' (8.5x11) or 'legal' (8.5x14)
    listName: 'Programs_February_2026',
  },
  header: {
    titleText: 'LIBRARY PROGRAMS',
    monthText: 'FEBRUARY 2026',
    titleColor: '#000000',
    monthColor: '#cc007e',
  },
  branches: [
    {
      id: 'branch-uuid',
      name: 'DOWNTOWN',
      address: '1100 E STREET',     // If empty/null, no address displays
      color: '#0474bf',             // Used for sidebar, name, address, program names
      visible: true,
      note: null,                   // Optional ad-hoc note text
      noteStyle: null,              // Optional: 'info' (default), 'alert'
      programs: [
        {
          id: 'program-uuid',
          name: 'Teen Film Screening and Discussion:',
          subtitle: 'The Lake Merritt Monster',
          dateText: 'Monday, February 2',
          timeText: '5:30pm-6:30pm',
          nameBold: true,
          subtitleItalic: false,
          asterisk: false,
          registrationRequired: false,
          ageGroup: null,            // e.g., 'For children.', 'For teens and adults.'
          isClosure: false,          // CLOSURE ROW: fills background with branch color, white text
          freeTextOverride: null,    // If set, replaces all structured fields
        }
      ]
    }
  ],
  footer: {
    source: 'default-english',      // 'default-english', 'default-spanish', or 'custom'
    customImageData: null,          // Base64 of uploaded custom image, used only when source is 'custom'
    asteriskNote: '*Programs in Spanish or where English is not necessary to participate.',
  },
  styles: {
    programNameFontSize: 11,        // pt
    programDateFontSize: 11,
    programTimeFontSize: 11,
    programSubtitleFontSize: 9,
    branchNameFontSize: 14,
    branchAddressFontSize: 10,
    headerTitleFontSize: 28,
    headerMonthFontSize: 28,
    programSpacing: 2,              // pt between program entries
    branchSpacing: 6,               // pt between branch sections
    programDateBold: true,
    programTimeBold: false,
    programNameBold: true,
  },
}
```

### Closure/Holiday Row Feature
When a program entry has `isClosure: true`, it renders as a special row:
- The entire row background fills with the branch's color
- All text in that row turns white (#FFFFFF)
- The "time" column displays text like "Library Closed"
- This is used for holidays like "Presidents' Day Holiday" showing "Monday, February 16" with "Library Closed"

This should be a toggle in the program edit form. When enabled, it automatically applies the colored background and white text styling.

### Program Entry Flexibility
Programs support both structured and free-text entry:

**Structured mode** (default): Separate fields for name, subtitle, date, time, age group, registration note. The rendering engine lays these out in the standard pattern:
```
Program Name*                    Day, Date              Time
  Subtitle / age note / registration note
```

**Free-text override**: A single text area that replaces all structured fields. For entries that don't fit the pattern (e.g., "Drop-in Tech Help" with multiple day/time combinations across several lines, or "Tech Tutor - By Appointment"). When free-text override is set, the structured fields are hidden in the edit form and the raw text renders directly.

### Branch Defaults
Initial branch configuration (loaded when starting a new flyer):

```javascript
BRANCH_DEFAULTS: [
  { name: 'DOWNTOWN',    address: '1100 E STREET',               color: '#0474bf' },
  { name: 'CITY HALL',   address: '1400\n5TH AVE',               color: '#ff1a05' },
  { name: 'NORTHGATE',   address: '5800 NORTHGATE DR\nSTE. 083', color: '#e87c09' },
  { name: 'AL BORO CC',  address: '50 CANAL ST',                 color: '#7ca633' },
  { name: 'ONLINE',      address: '',                             color: '#8d44ad' },
]
```

Branches are fully configurable: the user can rename them, change colors, change addresses, add new branches, remove branches, or reorder them.

---

## UI Layout

### Two-Panel Design
```
+-------------------------------------------------------------+
|  Header Bar: App name, Load, Save, Reset, Export PDF         |
+------------------+------------------------------------------+
|  Sidebar (340px) |  Main Content Area                        |
|                  |                                           |
|  [Programs Tab]  |  Live Preview                             |
|  [Settings Tab]  |  (The actual flyer at scale, WYSIWYG)     |
|                  |                                           |
|  Collapsible     |  Zoom controls (bottom-right)             |
|  via toggle      |                                           |
+------------------+------------------------------------------+
```

### Header Bar
Contains: app name/logo, action buttons (Load, Save, Reset, Export PDF). The Export PDF button should be visually prominent (success/green color).

### Sidebar - Programs Tab (Primary Workspace)
Shows branches as collapsible accordion sections. Each branch section has:

**Branch header row**: Branch name (in its color), expand/collapse toggle, [+ Add Program] button

**Program list** (within expanded branch): Each program shows as a compact card with a drag handle, the program name, date/time summary, and edit/delete buttons.

- Programs within a branch are reorderable via drag-and-drop
- Branches themselves are reorderable via drag-and-drop on the branch header
- [+ Add Branch] button at the bottom of all branches

### Program Edit Form (inline expansion)
When the user clicks edit or adds a new program, the card expands into a form with:
- Program Name text input
- Subtitle text input
- Date text input
- Time text input
- Age Group text input
- Checkboxes for: Registration required, Add asterisk (*), Closure/holiday
- Free-text override checkbox + textarea (shown only when checked, hides structured fields)
- Cancel and Save buttons

When "Closure/holiday" is checked, date and time fields remain visible (she enters the date and "Library Closed" as time text), but the preview shows the colored background and white text.

### Sidebar - Settings Tab
Organized as collapsible sections:

**Page Setup**: Page size toggle (Letter/Legal), Month name, Year

**Header**: Title text, month display text, title color picker, month color picker, font size controls

**Branch Settings**: For each branch: name, address (textarea for multi-line), color picker. Add/remove/reorder branches.

**Typography**: Font family selectors (condensed font for most text, display font for branch names), size controls for each text role, bold toggles, spacing controls

**Footer**: Footer image selector with three options: English Default, Spanish Default, or Upload Custom. The two default images ship with the tool (8 inches wide x 1 inch tall, 4800x600px at 600 DPI). When uploading a custom image, it replaces the footer for that page only. Asterisk note text field below the image selector.

**Pages**: List of pages with "Duplicate Page" and "Delete Page" buttons. Each page shows its name and footer selection (English Default / Spanish Default / Custom). The first page cannot be deleted.

### Main Content - Live Preview
The preview area shows the flyer rendered at scale, updated in real time. Key behaviors:
- Renders with correct page dimensions (letter or legal)
- Content reflows automatically when anything changes
- Shows a visual warning if content overflows the page (red border + warning message)
- Zoom controls in bottom-right corner (zoom in, zoom out, reset to 100%, fit to screen)
- Ctrl+scroll wheel zooming

---

## The Rendering Engine

This is the most critical component. It takes the data model and renders the flyer into the live preview. The preview must closely match the PDF output.

### Flyer Layout Structure (top to bottom)

The flyer has: a header bar at the top, branch sections with programs in the middle (this is the part that reflows), and a footer anchored at the bottom.

### Layout Rules

1. **Margins**: 0.25 inches on all sides

2. **Header**: Full width. "LIBRARY PROGRAMS" left-aligned in black, "FEBRUARY 2026" right-aligned in #cc007e. Both in the condensed font, bold. No background color (text on white).

3. **Branch sections**: Each branch has:
   - A thin colored vertical sidebar strip on the LEFT edge (using the branch color)
   - A thin colored vertical sidebar strip on the RIGHT edge (same color)
   - The branch name (bold, in branch color, in the display font) left-aligned
   - The address right-aligned in the same color, in the condensed font. Addresses are displayed vertically (rotated 90 degrees) running along the right sidebar strip. If address is empty/null, nothing displays there.
   - Programs listed below the branch name

4. **Program entries**: Three-column layout within each branch section:
   - LEFT: Program name (bold, in branch color, condensed font). Asterisk appended if flagged.
   - CENTER: Date text (bold, condensed font, in branch color)
   - RIGHT: Time text (regular weight, condensed font, in branch color)
   - BELOW (full width): Subtitle line if present (smaller size, condensed font). Age group and "Registration required." appended here.
   - All text within a branch uses that branch's color.

5. **Closure rows**: When `isClosure: true`:
   - The entire row gets a background fill in the branch color
   - All text in that row renders in white (#FFFFFF)
   - Typical content: name="Presidents' Day Holiday", dateText="Monday, February 16", timeText="Library Closed"

6. **Branch notes**: If a branch has a `note`, it renders as a distinct text block within the branch section, styled differently from program entries (e.g., slightly indented, italic, or with a subtle background).

7. **Footer**: Anchored to the bottom of the page. Displays one of three images: English default, Spanish default, or a user-uploaded custom image. The default images are 8 inches wide by 1 inch tall (4800x600px at 600 DPI), sized to fill the full content width between margins. The footer source is per-page, so when duplicating a page for a Spanish version, the user can switch the footer to the Spanish default without affecting the English page. The asterisk note text renders below or above the image.

8. **Reflow**: When content changes, the engine recalculates and re-renders everything between header and footer. No manual positioning ever.

### Overflow Handling
If content exceeds the available space between header and footer:
- Show a clear visual warning (red outline on the preview, warning message above it)
- Do NOT clip content silently
- The user's options: remove programs, switch to legal size, reduce font sizes
- Automatic pagination is NOT required for v1

---

## Core Features

### 1. Automatic Reflow (The Core Feature)
Every change triggers a re-render of the preview. The rendering engine calculates available vertical space (page height minus margins minus header minus footer) and lays out content sequentially. No manual positioning.

Use debouncing for changes that fire rapidly (like font size input), but keep the preview responsive enough that the user sees changes within ~300ms.

### 2. Save/Load System
Save the entire flyer state as a `.flyer` JSON file. Load a saved file to restore the full state. This is the month-to-month workflow: save February's flyer, load it in March, change the month, swap programs, save as March.

Also maintain a localStorage draft backup (debounced autosave) for crash recovery. On page load, check for a draft and offer to restore it.

Include a `beforeunload` warning when there are unsaved changes.

### 3. Duplicate Page
A "Duplicate Page" button creates a deep copy of the current page's data. The user can edit the copy independently (e.g., translate program names to Spanish, change the header text). Each page has its own footer selection, so when duplicating for a Spanish version, the user can switch from the English default footer to the Spanish default footer. Each page becomes a separate page in the exported PDF. Pages are listed in the Settings tab. The first page cannot be deleted.

### 4. PDF Export
Export all pages as a single PDF at 600 DPI.

Specifications:
- **Resolution**: 600 DPI
- **Canvas scale**: 600 / 96 (true 600 DPI rendering)
- **Page sizes**: Letter (8.5 x 11 inches) or Legal (8.5 x 14 inches)
- **Margins**: 0.25 inches all sides
- **No bleed or crop marks** (printed on a standard office printer)
- **Multi-page**: Each page in the tool becomes a page in the PDF
- **Image format**: JPEG compression at 0.92 quality within the PDF
- **Filename**: Derived from the listName field in meta

Use jsPDF + html2canvas with high-resolution canvas capture. Wait for fonts to load before capturing.

### 5. Drag-and-Drop Reordering
- Programs within a branch: reorder via drag handles (Sortable.js)
- Branches: reorder via drag handles on branch headers
- Both trigger automatic reflow

### 6. Branch Notes
Each branch has an optional free-text note field. When populated, it renders as a styled block within the branch section.

### 7. Notification System
Toast-style notifications for user feedback: success (green), error (red), info (blue). Auto-dismiss after 3 seconds.

---

## What NOT to Build in V1

- No user accounts or authentication
- No Firebase or any backend
- No automatic translation
- No automatic pagination (single page per flyer, with overflow warning)
- No undo/redo system
- No mascot, guided tour, or onboarding
- No AI-powered features
- No image generation or collage features
- No dark mode

---

## Build Order

Build in this order. Each step should be functional before moving to the next.

1. **Config and data model** (`config.js`, `flyer-utils.js`) -- Constants, defaults, pure utility functions for data manipulation. Write tests for utilities.

2. **Basic UI shell** -- Two-panel layout with sidebar (tabs for Programs and Settings) and main content area. Header bar with action buttons.

3. **Rendering engine** -- The live preview with automatic reflow. This is the hardest and most important part. Get it working with hardcoded test data before building the editor UI. The preview must render the full flyer layout: header, branches with sidebar strips, programs in three-column format, closure rows, footer area.

4. **Program editor** -- Add/edit/delete programs in the sidebar. Inline edit forms. Structured fields + free-text override toggle. Closure toggle. Changes update the preview in real time.

5. **Branch management** -- Add/edit/delete/reorder branches. Branch settings (name, address, color). Drag-and-drop reordering.

6. **Save/Load** -- JSON file I/O (`.flyer` files). localStorage draft autosave. Restore draft on page load. `beforeunload` warning.

7. **PDF Export** -- High-resolution canvas capture with jsPDF + html2canvas.

8. **Page duplication** -- Duplicate current page, edit independently, export all pages.

9. **Settings panel** -- Typography controls, page size toggle, header editing, footer management.

10. **Polish** -- Overflow warnings, drag-and-drop for both programs and branches, zoom controls, notification system.

---

## Code Patterns

### Constants
All magic numbers, colors, font names, defaults, and timing values go in `config.js` inside the `CONFIG` object. Never hardcode these in `app.js`.

### Pure Functions
Data manipulation functions (creating blank programs, creating blank branches, serializing/deserializing state, calculating layout metrics) go in `flyer-utils.js` inside the `FlyerUtils` object. These are testable with Vitest.

### DOM/UI Logic
All DOM manipulation, event binding, and rendering goes in `app.js` inside the `FlyerApp` IIFE.

### Debouncing
Autosave and preview regeneration should be debounced (~400ms for autosave, ~300ms for preview updates on rapid inputs).

### State Serialization
- `serializeState()` captures the entire application state as a plain JSON-serializable object
- `applyState(loaded)` takes a parsed state object and restores the full UI
- Save = `serializeState()` -> JSON.stringify -> Blob -> download
- Load = file read -> JSON.parse -> `applyState()`
- localStorage draft = `serializeState()` -> `localStorage.setItem()`

---

## CLAUDE.md

When the project is created, include a CLAUDE.md that documents:
- Project overview and purpose
- Tech stack and architecture
- File structure with descriptions
- Script load order and why it matters
- How to run the application (no build, just open index.html or use local server)
- Development commands (lint, test)
- Data model overview
- Key functional areas
- Cross-file dependencies (what to check when changing each file)
- Rules for modifying the codebase (where constants go, where utils go, etc.)
- Known patterns and conventions

This file is critical for future Claude Code sessions to understand the codebase without needing this prompt again.
