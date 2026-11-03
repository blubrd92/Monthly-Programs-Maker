# Monthly Programs Maker

A browser-based tool for creating monthly library program flyers with automatic content reflow. Built for library staff who need to produce professional flyers without manual layout work — programs automatically reposition when added, removed, or changed.

## Features

- **Automatic reflow** — Add or remove programs and the layout adjusts instantly
- **Multi-branch support** — Each library branch gets its own colored section with vertical name/address strips
- **Drag-and-drop** — Reorder programs and branches, move programs between branches
- **Multi-page** — Create multi-page flyers with per-page settings, duplicate pages
- **PDF export** — High-quality 600 DPI output ready for print
- **Save/Load** — Save projects as `.flyer` files, auto-saves drafts to localStorage
- **Bilingual support** — English and Spanish default footers with auto-switching header text
- **Customizable typography** — Font families, sizes, bold toggles, adjustable column widths
- **Program options** — Structured fields or free-text override, closure rows, inline subtitles, per-program color override
- **Page sizes** — Letter (8.5x11) and Legal (8.5x14)
- **Filled strips** — Toggle between outlined and filled branch sidebar strips
- **Import from the city calendar**: a bookmarklet copies the month shown on the [library events page](https://sanrafael.gov/library-events/); paste it into the tool, pick events, and they become programs (or Kid Mode cards). Repeating programs at the same branch and time merge into one row ("Fridays")

## Quick Start

No build step or installation required:

1. Open `index.html` in a browser
2. Edit programs in the sidebar
3. Adjust settings (typography, colors, page size) in the Settings tab
4. Export to PDF when ready

Or use a local server:
```bash
npx serve .
```

## Importing Events from the City Calendar

1. In the tool, click **Import Events from City Calendar** and drag the **SR Events → Flyer** button to your bookmarks bar (one time).
2. Open the [library events page](https://sanrafael.gov/library-events/), use the calendar arrows to show the month you want, and click the bookmark. Click **Copy events** in the panel that appears.
3. Back in the tool, open **Import Events** again and paste. Check the events you want, choose a branch for any off-site events, and click **Add**.

Importing removes the untouched sample "Program Name" rows from branches that receive events. Events already on the flyer (same name, date and time at that branch) show as *Already on flyer* and start unchecked, so pasting the same month twice is safe.

The bookmarklet reads the calendar's own data for that month and the city's iCal feed (for branch and location). Branch mapping and closure detection live in `CONFIG.EVENT_IMPORT` in `assets/js/config.js`. If the city renames a branch category, update `categoryBranches` there.

## Development

```bash
npm install          # Install dev dependencies (first time)
npm run lint         # Run ESLint
npm run test         # Run tests
npm run test:watch   # Run tests in watch mode
```

## Tech Stack

- Vanilla HTML5/CSS3/JavaScript (ES6+) — no frameworks, no build process
- jsPDF + html2canvas for PDF generation
- Sortable.js for drag-and-drop
- Google Fonts + Font Awesome via CDN

## Roadmap

- **Kid Mode** — A variant flyer format designed specifically for children's programs, with adjusted layout and styling appropriate for youth-focused library programming.
