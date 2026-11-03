/* eslint-disable no-unused-vars */

/**
 * CONFIG — All constants, defaults, colors, fonts, and timing values.
 * Loaded first. No dependencies.
 */
const CONFIG = (function () {
  'use strict';

  return {
    // ── Schema ────────────────────────────────────────────
    SCHEMA_VERSION: 'library-flyer-v1',

    // ── Page Dimensions (inches) ─────────────────────────
    PAGE: {
      letter: { width: 8.5, height: 11 },
      legal:  { width: 8.5, height: 14 },
    },
    MARGINS: { top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 },
    DPI: 600,
    SCREEN_DPI: 96,

    // ── Colors ───────────────────────────────────────────
    COLORS: {
      headerTitle: '#000000',
      headerMonth: '#cc007e',
      branches: {
        downtown:  '#0474bf',
        cityHall:  '#ff1a05',
        northgate: '#e87c09',
        alBoro:    '#7ca633',
        online:    '#8d44ad',
      },
      closureText: '#FFFFFF',
    },

    // ── Font Roles ───────────────────────────────────────
    FONT_ROLES: {
      headerTitle:     "'Barlow Condensed', sans-serif",
      headerMonth:     "'Barlow Condensed', sans-serif",
      branchName:      "'Outfit', sans-serif",
      programName:     "'Barlow Condensed', sans-serif",
      programDate:     "'Barlow Condensed', sans-serif",
      programTime:     "'Barlow Condensed', sans-serif",
      programSubtitle: "'Barlow Condensed', sans-serif",
      branchAddress:   "'Barlow Condensed', sans-serif",
    },

    // ── Font Options ─────────────────────────────────────
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

    // ── Branch Defaults ──────────────────────────────────
    BRANCH_DEFAULTS: [
      { name: 'Downtown',    address: '1100 E Street',              color: '#0474bf' },
      { name: 'City Hall',   address: '1400 5th Ave',              color: '#ff1a05' },
      { name: 'Northgate',   address: '5800 Northgate Dr Ste. 083', color: '#e87c09' },
      { name: 'Al Boro CC',  address: '50 Canal St',               color: '#7ca633' },
      { name: 'Online',      address: '',                           color: '#8d44ad' },
    ],

    // ── Footer ───────────────────────────────────────────
    FOOTER: {
      defaultImages: {
        'default-english': 'assets/img/footer-english-default.png',
        'default-spanish': 'assets/img/footer-spanish-default.png',
      },
      widthInches: 8.0,
      heightInches: 0.8,
      widthPx: 4800,
      heightPx: 480,
    },

    // ── Default Styles ───────────────────────────────────
    DEFAULT_STYLES: {
      programNameFontSize: 15,
      programDateFontSize: 15,
      programTimeFontSize: 14,
      programSubtitleFontSize: 12,
      branchNameFontSize: 14,
      branchAddressFontSize: 10,
      headerTitleFontSize: 34,
      headerMonthFontSize: 34,
      programDateBold: true,
      programTimeBold: false,
      programNameBold: true,
      stripFilled: false,
      branchBorders: true,
      columnNameWidth: 48,
      columnTimeWidth: 20,
    },

    // ── Default Header ───────────────────────────────────
    DEFAULT_HEADER: {
      titleText: 'Library Programs',
      monthText: 'Month Year',
      titleColor: '#000000',
      monthColor: '#cc007e',
    },

    // ── Language-based Title Mapping ─────────────────────
    HEADER_TITLE_BY_LANGUAGE: {
      'default-english': { text: 'Library Programs', fontSize: 34 },
      'default-spanish': { text: 'Programas de la Biblioteca', fontSize: 34 },
      'kid-english':     { text: "San Rafael Public Library\nChildren's Programs", fontSize: 30 },
      'kid-spanish':     { text: 'Biblioteca Pública de San Rafael\nProgramas Para Niños', fontSize: 30 },
    },

    // ── Default Footer ───────────────────────────────────
    DEFAULT_FOOTER: {
      source: 'default-english',
      customImageData: null,
      asteriskNote: '*Programs in Spanish or where English is not necessary to participate.',
    },

    // ── Default Meta ─────────────────────────────────────
    DEFAULT_META: {
      month: 'February',
      year: 2026,
      pageSize: 'letter',
      listName: 'Programs_February_2026',
      mode: 'standard',
    },

    // ── Placeholder Program ──────────────────────────────
    // Sample row every new branch (and new Kid Mode page) starts with.
    // Untouched copies are removed when events are imported.
    PLACEHOLDER_PROGRAM: {
      name: 'Program Name',
      subtitle: 'Age Group · Details',
      dateText: 'Day, Month #',
      timeText: '00:00 AM',
    },

    // ── Timing (ms) ──────────────────────────────────────
    DEBOUNCE: {
      preview: 300,
      autosave: 400,
    },
    NOTIFICATION_DURATION: 3000,

    // ── Sidebar ──────────────────────────────────────────
    SIDEBAR_WIDTH: 340,

    // ── Kid Mode Defaults ──────────────────────────────────
    KID_MODE_DEFAULTS: {
      styles: {
        programNameFontSize: 18,
        programDateFontSize: 12,
        programTimeFontSize: 12,
        programSubtitleFontSize: 16,
        programNoteFontSize: 9,
        headerTitleFontSize: 30,
        headerMonthFontSize: 30,
        programNameBold: true,
        programDateBold: true,
        programTimeBold: false,
        cardBorderWidth: 3,
        cardBorderRadius: 40,
        cardGap: 4,
        cardImageWidth: 180,
      },
    },

    // ── Rendering ────────────────────────────────────────
    SIDEBAR_STRIP_WIDTH: 22,  // px in preview, wide enough for vertical branch name
    // Smallest font (px) a branch name may shrink to while kept whole.
    // When a short branch (e.g. one program) can't fit its name's longest
    // word at this size, that branch grows just enough to fit it.
    BRANCH_NAME_MIN_READABLE_PX: 11,

    // ── PDF Export ────────────────────────────────────────
    PDF: {
      dpi: 600,
      jpegQuality: 0.92,
    },

    // ── Local Storage Key ────────────────────────────────
    STORAGE_KEY: 'library-flyer-draft',

    // ── City Calendar Event Import ───────────────────────
    // The bookmarklet runs on the city's library events page, reads the
    // month the calendar is showing, and copies those events as JSON.
    // The import dialog turns that JSON into flyer programs.
    EVENT_IMPORT: {
      calendarPageUrl: 'https://sanrafael.gov/library-events/',
      // Events Manager iCal feed for the "Library" category. Supplies the
      // branch categories and location the month-view data leaves out.
      icalUrl: 'https://sanrafael.gov/events/categories/library/ical/',
      // Calendar category id used when the page's own filter is unavailable
      defaultCategoryId: 1188,
      payloadSource: 'sr-library-events',
      payloadVersion: 1,
      bookmarkletLabel: 'SR Events → Flyer',
      // City calendar category → flyer branch name (checked first)
      categoryBranches: {
        'Downtown Library': 'Downtown',
        'Northgate Library': 'Northgate',
        'Pickleweed Library': 'Al Boro CC',
        'City Hall Council Chambers': 'City Hall',
        'Online Programs': 'Online',
      },
      // Location text fragments → flyer branch name (fallback when an
      // event has no branch category). Matched case-insensitively.
      locationBranches: [
        { match: 'downtown', branch: 'Downtown' },
        { match: '1100 e street', branch: 'Downtown' },
        { match: 'northgate', branch: 'Northgate' },
        { match: 'pickleweed', branch: 'Al Boro CC' },
        { match: 'boro community center', branch: 'Al Boro CC' },
        { match: '50 canal', branch: 'Al Boro CC' },
        { match: 'council chambers', branch: 'City Hall' },
        { match: '1400 5th', branch: 'City Hall' },
        { match: '1400 fifth', branch: 'City Hall' },
      ],
      // All-day events whose title starts like this become closure rows
      closureTitlePattern: '^\\s*(closed|cerrad)',
      // A closure covering all of these branches becomes ONE row at the
      // top of the flyer (no branch name) instead of a row per branch.
      // Online and City Hall are not required.
      allBranchesClosure: {
        requiredBranches: ['Downtown', 'Northgate', 'Al Boro CC'],
        token: '__all_branches__', // import-row id for "all branches"
        label: 'All branches (top of flyer)',
        sidebarLabel: 'All Branches',
        color: '#000000',
      },
      // Events with no branch go to a grey "Offsite" group that is created
      // on import (it is not part of the default page). Their location
      // goes in the subtitle (Kid Mode: the card's address line).
      offsiteBranch: {
        name: 'Offsite',
        color: '#6e6e6e',
      },
      // Location parts dropped when shortening an address for a subtitle
      locationNoisePattern: '^(san rafael|ca|california|united states|usa|\\d{5}(-\\d{4})?)$',
      // Spanish month names, so "Noviembre 2026" headers are understood
      // (also used for Spanish dates in closure text)
      spanishMonthNames: [
        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
      ],
      spanishWeekdayNames: [
        'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado',
      ],
      // Imported closures use the free-text override with these settings.
      // Text: one line per language, each with its own date, e.g.
      //   CLOSED – Veteran's Day: Wednesday, November 11
      //   CERRADO – Día de los Veteranos: miércoles 11 de noviembre
      closureFreeText: {
        fontSize: 15, // pt
        align: 'center',
        bold: true,
        italic: false,
        // Kid Mode cards don't keep line breaks in free text, so the
        // two language lines are joined with this instead
        kidLineSeparator: ' / ',
      },
      // Time ranges render like "4:00pm–5:00pm" to match existing flyers
      timeRangeSeparator: '–',
    },
  };
})();
