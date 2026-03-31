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
      branchName:      "'Red Hat Display', sans-serif",
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
      { name: 'DOWNTOWN',    address: '1100 E STREET',              color: '#0474bf' },
      { name: 'CITY HALL',   address: '1400 5TH AVE',              color: '#ff1a05' },
      { name: 'NORTHGATE',   address: '5800 NORTHGATE DR STE. 083', color: '#e87c09' },
      { name: 'AL BORO CC',  address: '50 CANAL ST',               color: '#7ca633' },
      { name: 'ONLINE',      address: '',                           color: '#8d44ad' },
    ],

    // ── Footer ───────────────────────────────────────────
    FOOTER: {
      defaultImages: {
        'default-english': 'assets/img/footer-english-default.png',
        'default-spanish': 'assets/img/footer-spanish-default.png',
      },
      widthInches: 8.0,
      heightInches: 1.0,
      widthPx: 4800,
      heightPx: 600,
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
    },

    // ── Default Header ───────────────────────────────────
    DEFAULT_HEADER: {
      titleText: 'LIBRARY PROGRAMS',
      monthText: 'MONTH YEAR',
      titleColor: '#000000',
      monthColor: '#cc007e',
    },

    // ── Language-based Title Mapping ─────────────────────
    HEADER_TITLE_BY_LANGUAGE: {
      'default-english': { text: 'LIBRARY PROGRAMS', fontSize: 34 },
      'default-spanish': { text: 'PROGRAMAS DE LA BIBLIOTECA', fontSize: 32 },
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
    },

    // ── Timing (ms) ──────────────────────────────────────
    DEBOUNCE: {
      preview: 300,
      autosave: 400,
    },
    NOTIFICATION_DURATION: 3000,

    // ── Sidebar ──────────────────────────────────────────
    SIDEBAR_WIDTH: 340,

    // ── Rendering ────────────────────────────────────────
    SIDEBAR_STRIP_WIDTH: 22,  // px in preview, wide enough for vertical branch name

    // ── PDF Export ────────────────────────────────────────
    PDF: {
      dpi: 600,
      jpegQuality: 0.92,
    },

    // ── Local Storage Key ────────────────────────────────
    STORAGE_KEY: 'library-flyer-draft',
  };
})();
