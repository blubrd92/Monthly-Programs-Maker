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
