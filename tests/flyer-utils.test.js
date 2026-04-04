import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load config.js and flyer-utils.js as scripts (IIFE pattern, no ES6 exports)
beforeAll(() => {
  const configSrc = readFileSync(resolve(__dirname, '../assets/js/config.js'), 'utf-8');
  const utilsSrc = readFileSync(resolve(__dirname, '../assets/js/flyer-utils.js'), 'utf-8');

  // Execute in global scope so CONFIG and FlyerUtils are available
  // eslint-disable-next-line no-eval
  const script = new Function(configSrc + '\n' + utilsSrc + '\nreturn { CONFIG, FlyerUtils };');
  const result = script();
  globalThis.CONFIG = result.CONFIG;
  globalThis.FlyerUtils = result.FlyerUtils;
});

describe('FlyerUtils.generateId', () => {
  it('returns a string in UUID-like format', () => {
    const id = FlyerUtils.generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns unique values', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(FlyerUtils.generateId());
    }
    expect(ids.size).toBe(100);
  });
});

describe('FlyerUtils.createBlankProgram', () => {
  it('returns a program with all required fields', () => {
    const prog = FlyerUtils.createBlankProgram();
    expect(prog.id).toBeTruthy();
    expect(prog.name).toBe('');
    expect(prog.subtitle).toBe('');
    expect(prog.dateText).toBe('');
    expect(prog.timeText).toBe('');
    expect(prog.nameBold).toBe(true);
    expect(prog.subtitleItalic).toBe(false);
    expect(prog.isClosure).toBe(false);
    expect(prog.freeTextOverride).toBeNull();
  });

  it('generates unique IDs for each program', () => {
    const a = FlyerUtils.createBlankProgram();
    const b = FlyerUtils.createBlankProgram();
    expect(a.id).not.toBe(b.id);
  });
});

describe('FlyerUtils.createBlankBranch', () => {
  it('creates a branch with default values', () => {
    const branch = FlyerUtils.createBlankBranch();
    expect(branch.name).toBe('New Branch');
    expect(branch.address).toBe('');
    expect(branch.color).toBe('#666666');
    expect(branch.visible).toBe(true);
    expect(branch.programs).toHaveLength(1);
  });

  it('accepts custom values', () => {
    const branch = FlyerUtils.createBlankBranch('DOWNTOWN', '123 MAIN ST', '#0474bf');
    expect(branch.name).toBe('DOWNTOWN');
    expect(branch.address).toBe('123 MAIN ST');
    expect(branch.color).toBe('#0474bf');
  });
});

describe('FlyerUtils.createDefaultFlyer', () => {
  it('creates a flyer with the schema version', () => {
    const flyer = FlyerUtils.createDefaultFlyer();
    expect(flyer.schema).toBe('library-flyer-v1');
  });

  it('has 5 default branches', () => {
    const flyer = FlyerUtils.createDefaultFlyer();
    expect(flyer.branches).toHaveLength(5);
    expect(flyer.branches[0].name).toBe('Downtown');
    expect(flyer.branches[1].name).toBe('City Hall');
    expect(flyer.branches[2].name).toBe('Northgate');
    expect(flyer.branches[3].name).toBe('Al Boro CC');
    expect(flyer.branches[4].name).toBe('Online');
  });

  it('has default header', () => {
    const flyer = FlyerUtils.createDefaultFlyer();
    expect(flyer.header.titleText).toBe('Library Programs');
    expect(flyer.header.monthColor).toBe('#cc007e');
  });

  it('has default meta', () => {
    const flyer = FlyerUtils.createDefaultFlyer();
    expect(flyer.meta.pageSize).toBe('letter');
  });

  it('has default styles', () => {
    const flyer = FlyerUtils.createDefaultFlyer();
    expect(flyer.styles.programNameFontSize).toBe(15);
  });
});

describe('FlyerUtils.deepClone', () => {
  it('creates an independent copy', () => {
    const original = { a: 1, b: { c: 2 } };
    const clone = FlyerUtils.deepClone(original);
    clone.b.c = 99;
    expect(original.b.c).toBe(2);
  });

  it('handles arrays', () => {
    const original = [1, [2, 3]];
    const clone = FlyerUtils.deepClone(original);
    clone[1].push(4);
    expect(original[1]).toEqual([2, 3]);
  });
});

describe('FlyerUtils.serializeState / deserializeState', () => {
  it('round-trips a flyer state', () => {
    const flyer = FlyerUtils.createDefaultFlyer();
    const json = FlyerUtils.serializeState(flyer);
    const restored = FlyerUtils.deserializeState(json);
    expect(restored).not.toBeNull();
    expect(restored.schema).toBe(flyer.schema);
    expect(restored.branches).toHaveLength(5);
    expect(restored.savedAt).toBeTruthy();
  });

  it('returns null for invalid JSON', () => {
    expect(FlyerUtils.deserializeState('not json')).toBeNull();
  });

  it('returns null for wrong schema', () => {
    const json = JSON.stringify({ schema: 'wrong-version' });
    expect(FlyerUtils.deserializeState(json)).toBeNull();
  });

  it('returns null for missing required fields', () => {
    const json = JSON.stringify({ schema: 'library-flyer-v1' });
    expect(FlyerUtils.deserializeState(json)).toBeNull();
  });
});

describe('FlyerUtils.validateFlyerData', () => {
  it('returns true for valid data', () => {
    const flyer = FlyerUtils.createDefaultFlyer();
    expect(FlyerUtils.validateFlyerData(flyer)).toBe(true);
  });

  it('returns false for null', () => {
    expect(FlyerUtils.validateFlyerData(null)).toBe(false);
  });

  it('returns false for wrong schema', () => {
    expect(FlyerUtils.validateFlyerData({ schema: 'wrong' })).toBe(false);
  });

  it('returns false for missing branches array', () => {
    expect(FlyerUtils.validateFlyerData({
      schema: 'library-flyer-v1',
      meta: {},
      header: {},
      branches: 'not-array',
      footer: {},
      styles: {},
    })).toBe(false);
  });
});

describe('FlyerUtils.getContentArea', () => {
  it('calculates letter content area', () => {
    const area = FlyerUtils.getContentArea('letter');
    expect(area.width).toBe(8.0);
    expect(area.height).toBe(10.5);
  });

  it('calculates legal content area', () => {
    const area = FlyerUtils.getContentArea('legal');
    expect(area.width).toBe(8.0);
    expect(area.height).toBe(13.5);
  });

  it('defaults to letter for unknown page size', () => {
    const area = FlyerUtils.getContentArea('unknown');
    expect(area.width).toBe(8.0);
    expect(area.height).toBe(10.5);
  });
});

describe('FlyerUtils.buildSubtitleLine', () => {
  it('returns empty string for program with no subtitle', () => {
    expect(FlyerUtils.buildSubtitleLine({ subtitle: '' })).toBe('');
  });

  it('returns subtitle text directly', () => {
    const line = FlyerUtils.buildSubtitleLine({
      subtitle: 'Ages 5-12 · Registration required.',
    });
    expect(line).toBe('Ages 5-12 · Registration required.');
  });
});

describe('FlyerUtils.duplicatePage', () => {
  it('creates a deep copy with new IDs', () => {
    const flyer = FlyerUtils.createDefaultFlyer();
    flyer.branches[0].programs.push(FlyerUtils.createBlankProgram());
    const originalBranchId = flyer.branches[0].id;
    const originalProgramId = flyer.branches[0].programs[0].id;

    const dup = FlyerUtils.duplicatePage(flyer);
    expect(dup.branches[0].id).not.toBe(originalBranchId);
    expect(dup.branches[0].programs[0].id).not.toBe(originalProgramId);
    expect(dup.branches[0].name).toBe('Downtown');
  });

  it('is independent from the original', () => {
    const flyer = FlyerUtils.createDefaultFlyer();
    const dup = FlyerUtils.duplicatePage(flyer);
    dup.header.titleText = 'CHANGED';
    expect(flyer.header.titleText).toBe('Library Programs');
  });
});

describe('FlyerUtils.getCurrentMonthYear', () => {
  it('returns month and year', () => {
    const { month, year } = FlyerUtils.getCurrentMonthYear();
    expect(typeof month).toBe('string');
    expect(month.length).toBeGreaterThan(0);
    expect(typeof year).toBe('number');
    expect(year).toBeGreaterThanOrEqual(2024);
  });
});

// ═══════════════════════════════════════════════════
// KID MODE TESTS
// ═══════════════════════════════════════════════════

describe('FlyerUtils.createBlankCard', () => {
  it('returns a card with all required fields', () => {
    const card = FlyerUtils.createBlankCard();
    expect(card.id).toBeTruthy();
    expect(card.name).toBe('');
    expect(card.subtitle).toBe('');
    expect(card.dateText).toBe('');
    expect(card.timeText).toBe('');
    expect(card.branchName).toBe('Downtown');
    expect(card.branchColor).toBe('#0474bf');
    expect(card.isClosure).toBe(false);
    expect(card.freeTextOverride).toBeNull();
    expect(card.colorOverride).toBeNull();
  });

  it('generates unique IDs for each card', () => {
    const a = FlyerUtils.createBlankCard();
    const b = FlyerUtils.createBlankCard();
    expect(a.id).not.toBe(b.id);
  });

  it('accepts custom values', () => {
    const card = FlyerUtils.createBlankCard({
      name: 'Storytime',
      branchName: 'Northgate',
      branchColor: '#e87c09',
    });
    expect(card.name).toBe('Storytime');
    expect(card.branchName).toBe('Northgate');
    expect(card.branchColor).toBe('#e87c09');
  });
});

describe('FlyerUtils.createDefaultKidPage', () => {
  it('creates a kid page with correct structure', () => {
    const page = FlyerUtils.createDefaultKidPage();
    expect(page.header).toBeDefined();
    expect(page.header.titleText).toBe("San Rafael Public Library\nChildren's Programs");
    expect(Array.isArray(page.cards)).toBe(true);
    expect(page.cards).toHaveLength(1);
    expect(page.cards[0].name).toBe('Program Name');
    expect(page.footer).toBeDefined();
    expect(page.styles).toBeDefined();
    expect(page.styles.cardBorderWidth).toBe(3);
    expect(page.styles.cardBorderRadius).toBe(30);
    expect(page.styles.cardGap).toBe(4);
  });
});

describe('FlyerUtils.duplicatePage (kid mode)', () => {
  it('creates a deep copy of a kid page with new card IDs', () => {
    const page = FlyerUtils.createDefaultKidPage();
    page.cards.push(FlyerUtils.createBlankCard({ name: 'Test Card' }));
    const originalCardId = page.cards[0].id;

    const dup = FlyerUtils.duplicatePage(page);
    expect(dup.cards).toHaveLength(2);
    expect(dup.cards[0].id).not.toBe(originalCardId);
    expect(dup.cards[0].name).toBe('Program Name');
    expect(dup.cards[1].name).toBe('Test Card');
  });

  it('is independent from the original kid page', () => {
    const page = FlyerUtils.createDefaultKidPage();
    const dup = FlyerUtils.duplicatePage(page);
    dup.header.titleText = 'CHANGED';
    dup.cards[0].name = 'CHANGED';
    expect(page.header.titleText).toBe("San Rafael Public Library\nChildren's Programs");
    expect(page.cards[0].name).toBe('Program Name');
  });
});

describe('FlyerUtils.validateFlyerData (kid mode)', () => {
  it('returns true for kid mode data with cards array', () => {
    expect(FlyerUtils.validateFlyerData({
      schema: 'library-flyer-v1',
      meta: {},
      header: {},
      cards: [],
      footer: {},
      styles: {},
    })).toBe(true);
  });

  it('returns false when neither branches nor cards exist', () => {
    expect(FlyerUtils.validateFlyerData({
      schema: 'library-flyer-v1',
      meta: {},
      header: {},
      footer: {},
      styles: {},
    })).toBe(false);
  });
});
