import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load config.js, flyer-utils.js and events-bookmarklet.js as scripts (IIFE pattern)
beforeAll(() => {
  const read = (f) => readFileSync(resolve(__dirname, '../assets/js/' + f), 'utf-8');
  const script = new Function(
    read('config.js') + '\n' + read('flyer-utils.js') + '\n' + read('events-bookmarklet.js') +
    '\nreturn { CONFIG, FlyerUtils, EventsBookmarklet };'
  );
  const result = script();
  globalThis.CONFIG = result.CONFIG;
  globalThis.FlyerUtils = result.FlyerUtils;
  globalThis.EventsBookmarklet = result.EventsBookmarklet;
});

// Shapes copied from the city's November 2026 calendar
function ev(title, start, end, categories, extra) {
  return Object.assign({
    id: Math.floor(Math.random() * 1e6),
    title: title,
    start: start,
    end: end,
    allDay: false,
    url: '',
    categories: categories,
    location: '',
  }, extra || {});
}

const ALL_BRANCHES = ['Downtown Library', 'Pickleweed Library', 'Northgate Library', 'Library'];

function novemberPayload() {
  return {
    year: 2026,
    month: 11,
    events: [
      // Every Friday except Thanksgiving Friday (closed)
      ev('Downtown Storytime', '2026-11-06T10:30:00', '2026-11-06T11:00:00', ['Library'],
        { location: 'Downtown Library, 1100 E Street, San Rafael, CA' }),
      ev('Downtown Storytime', '2026-11-13T10:30:00', '2026-11-13T11:00:00', ['Library'],
        { location: 'Downtown Library, 1100 E Street, San Rafael, CA' }),
      ev('Downtown Storytime', '2026-11-20T10:30:00', '2026-11-20T11:00:00', ['Library'],
        { location: 'Downtown Library, 1100 E Street, San Rafael, CA' }),
      // Same title, same branch, two different time slots
      ev('Drop-in Tech Help', '2026-11-03T14:00:00', '2026-11-03T18:00:00', ['Northgate Library', 'Library']),
      ev('Drop-in Tech Help', '2026-11-10T14:00:00', '2026-11-10T18:00:00', ['Northgate Library', 'Library']),
      ev('Drop-in Tech Help', '2026-11-17T14:00:00', '2026-11-17T18:00:00', ['Northgate Library', 'Library']),
      ev('Drop-in Tech Help', '2026-11-24T14:00:00', '2026-11-24T18:00:00', ['Northgate Library', 'Library']),
      ev('Drop-in Tech Help', '2026-11-07T13:00:00', '2026-11-07T16:00:00', ['Northgate Library', 'Library']),
      ev('Drop-in Tech Help', '2026-11-14T13:00:00', '2026-11-14T16:00:00', ['Northgate Library', 'Library']),
      ev('Drop-in Tech Help', '2026-11-21T13:00:00', '2026-11-21T16:00:00', ['Northgate Library', 'Library']),
      ev('Drop-in Tech Help', '2026-11-28T13:00:00', '2026-11-28T16:00:00', ['Northgate Library', 'Library']),
      // Same title at a different branch must NOT merge with Northgate
      ev('Drop-in Tech Help', '2026-11-05T10:00:00', '2026-11-05T12:00:00', ['Pickleweed Library', 'Library']),
      ev('Drop-in Tech Help', '2026-11-12T10:00:00', '2026-11-12T12:00:00', ['Pickleweed Library', 'Library']),
      // Partial series
      ev('ESL Conversation Club', '2026-11-07T15:00:00', '2026-11-07T16:00:00', ['Online Programs', 'Library']),
      ev('ESL Conversation Club', '2026-11-21T15:00:00', '2026-11-21T16:00:00', ['Online Programs', 'Library']),
      // One-offs
      ev('First Wednesday Art Talk', '2026-11-04T13:00:00', '2026-11-04T14:00:00', ['City Hall Council Chambers', 'Library']),
      ev('Under the Stars', '2026-11-14T17:00:00', '2026-11-14T18:30:00', ['En español', 'Library'],
        { location: 'Jean and John Starkweather Shoreline Park, San Rafael' }),
      // Closures
      ev('CLOSED – Veteran’s Day / CERRADO', '2026-11-11T00:00:00', '2026-11-12T00:00:00', ALL_BRANCHES, { allDay: true }),
      ev('CLOSED – Thanksgiving Holiday / CERRADO', '2026-11-26T00:00:00', '2026-11-28T00:00:00', ALL_BRANCHES, { allDay: true }),
      // Outside the month (calendar grid shows overflow days)
      ev('Downtown Storytime', '2026-12-04T10:30:00', '2026-12-04T11:00:00', ['Downtown Library', 'Library']),
    ],
  };
}

function find(items, name, branch) {
  return items.filter((i) => i.name === name && i.branch === branch);
}

describe('FlyerUtils.parseEventsPayload', () => {
  it('accepts bookmarklet JSON', () => {
    const text = JSON.stringify({
      source: 'sr-library-events', version: 1, year: 2026, month: 11,
      events: [ev('A', '2026-11-03T14:00:00', null, [])],
    });
    const res = FlyerUtils.parseEventsPayload(text);
    expect(res.ok).toBe(true);
    expect(res.payload.month).toBe(11);
    expect(res.payload.events).toHaveLength(1);
  });

  it('rejects random text and other JSON with a friendly error', () => {
    expect(FlyerUtils.parseEventsPayload('hello').ok).toBe(false);
    expect(FlyerUtils.parseEventsPayload('{"pages":[]}').ok).toBe(false);
    expect(FlyerUtils.parseEventsPayload('hello').error).toMatch(/bookmarklet/);
  });

  it('rejects payloads from a newer bookmarklet version', () => {
    const res = FlyerUtils.parseEventsPayload(JSON.stringify({
      source: 'sr-library-events', version: 99, year: 2026, month: 11, events: [],
    }));
    expect(res.ok).toBe(false);
  });

  it('drops events without a usable start', () => {
    const res = FlyerUtils.parseEventsPayload(JSON.stringify({
      source: 'sr-library-events', version: 1, year: 2026, month: 11,
      events: [{ title: 'x' }, ev('ok', '2026-11-01T10:00:00', null, [])],
    }));
    expect(res.payload.events).toHaveLength(1);
  });
});

describe('FlyerUtils.resolveEventBranches', () => {
  it('maps city categories to flyer branches', () => {
    expect(FlyerUtils.resolveEventBranches({ categories: ['Pickleweed Library', 'Library'] })).toEqual(['Al Boro CC']);
    expect(FlyerUtils.resolveEventBranches({ categories: ['Online Programs', 'Library'] })).toEqual(['Online']);
    expect(FlyerUtils.resolveEventBranches({ categories: ['City Hall Council Chambers'] })).toEqual(['City Hall']);
  });

  it('returns every branch for multi-branch events', () => {
    expect(FlyerUtils.resolveEventBranches({ categories: ALL_BRANCHES })).toEqual(['Downtown', 'Al Boro CC', 'Northgate']);
  });

  it('falls back to location when no branch category', () => {
    expect(FlyerUtils.resolveEventBranches({ categories: ['Library'], location: 'Downtown San Rafael Public Library, 1100 E Street' }))
      .toEqual(['Downtown']);
    expect(FlyerUtils.resolveEventBranches({ categories: [], location: 'Albert J. Boro Community Center, 50 Canal Street' }))
      .toEqual(['Al Boro CC']);
  });

  it('returns [] for off-site events', () => {
    expect(FlyerUtils.resolveEventBranches({ categories: ['Friends of the Library', 'Library'], location: 'First Presbyterian Church, 1510 Fifth Avenue' }))
      .toEqual([]);
  });
});

describe('FlyerUtils.formatEventTime / formatEventDate', () => {
  it('formats ranges like existing flyers', () => {
    expect(FlyerUtils.formatEventTime('2026-11-04T16:00:00', '2026-11-04T17:00:00', false)).toBe('4:00pm–5:00pm');
    expect(FlyerUtils.formatEventTime('2026-11-04T10:00:00', '2026-11-04T15:00:00', false)).toBe('10:00am–3:00pm');
    expect(FlyerUtils.formatEventTime('2026-11-04T12:15:00', null, false)).toBe('12:15pm');
    expect(FlyerUtils.formatEventTime('2026-11-04T00:00:00', '2026-11-05T00:00:00', true)).toBe('');
  });

  it('formats dates with weekday, independent of time zone', () => {
    expect(FlyerUtils.formatEventDate(FlyerUtils.parseLocalDateTime('2026-11-04T23:30:00'))).toBe('Wednesday, November 4');
    expect(FlyerUtils.formatEventDate(FlyerUtils.parseLocalDateTime('2026-03-01'))).toBe('Sunday, March 1');
  });

  it('formats multi-day all-day spans with an exclusive end', () => {
    const s = FlyerUtils.parseLocalDateTime('2026-11-26T00:00:00');
    const e = FlyerUtils.parseLocalDateTime('2026-11-28T00:00:00');
    expect(FlyerUtils.formatEventDateSpan(s, e, true)).toBe('Thursday–Friday, November 26–27');
    const e1 = FlyerUtils.parseLocalDateTime('2026-11-27T00:00:00');
    expect(FlyerUtils.formatEventDateSpan(s, e1, true)).toBe('Thursday, November 26');
  });
});

describe('FlyerUtils.buildImportItems', () => {
  it('keeps only events in the payload month', () => {
    const items = FlyerUtils.buildImportItems(novemberPayload(), { combineSeries: false });
    expect(items.some((i) => i.dateText.indexOf('December') !== -1)).toBe(false);
  });

  it('merges a weekly series and treats closure days as covered', () => {
    const items = FlyerUtils.buildImportItems(novemberPayload());
    const storytime = find(items, 'Downtown Storytime', 'Downtown');
    expect(storytime).toHaveLength(1);
    expect(storytime[0].dateText).toBe('Fridays');
    expect(storytime[0].timeText).toBe('10:30am–11:00am');
    expect(storytime[0].count).toBe(3);
  });

  it('only merges within the same branch and the same time', () => {
    const items = FlyerUtils.buildImportItems(novemberPayload());
    const northgate = find(items, 'Drop-in Tech Help', 'Northgate');
    expect(northgate.map((i) => i.dateText + ' ' + i.timeText).sort()).toEqual([
      'Saturdays 1:00pm–4:00pm',
      'Tuesdays 2:00pm–6:00pm',
    ]);
    const boro = find(items, 'Drop-in Tech Help', 'Al Boro CC');
    expect(boro).toHaveLength(1);
    // Nov 19 has no session and Nov 26 is closed, so this is not "every Thursday"
    expect(boro[0].dateText).toBe('Thursdays, November 5 & 12');
  });

  it('lists dates for a partial series', () => {
    const items = FlyerUtils.buildImportItems(novemberPayload());
    expect(find(items, 'ESL Conversation Club', 'Online')[0].dateText).toBe('Saturdays, November 7 & 21');
  });

  it('creates one closure row per branch and never merges closures', () => {
    const items = FlyerUtils.buildImportItems(novemberPayload());
    const closures = items.filter((i) => i.isClosure);
    expect(closures).toHaveLength(6);
    const thanksgiving = closures.filter((i) => i.name.indexOf('Thanksgiving') !== -1);
    expect(thanksgiving.map((i) => i.branch).sort()).toEqual(['Al Boro CC', 'Downtown', 'Northgate']);
    expect(thanksgiving[0].dateText).toBe('Thursday–Friday, November 26–27');
    expect(thanksgiving[0].timeText).toBe('');
  });

  it('leaves off-site events without a branch', () => {
    const items = FlyerUtils.buildImportItems(novemberPayload());
    const stars = items.filter((i) => i.name === 'Under the Stars');
    expect(stars).toHaveLength(1);
    expect(stars[0].branch).toBe(null);
    expect(stars[0].location).toMatch(/Shoreline Park/);
  });

  it('with combining off, every occurrence is its own row', () => {
    const items = FlyerUtils.buildImportItems(novemberPayload(), { combineSeries: false });
    expect(find(items, 'Downtown Storytime', 'Downtown')).toHaveLength(3);
    expect(find(items, 'Downtown Storytime', 'Downtown')[0].dateText).toBe('Friday, November 6');
  });

  it('sorts rows chronologically', () => {
    const items = FlyerUtils.buildImportItems(novemberPayload());
    const keys = items.map((i) => i.sortKey);
    expect(keys).toEqual(keys.slice().sort());
  });
});

describe('EventsBookmarklet.buildHref', () => {
  it('produces a javascript: URL carrying the settings', () => {
    const href = EventsBookmarklet.buildHref();
    expect(href.startsWith('javascript:')).toBe(true);
    const code = decodeURIComponent(href.slice('javascript:'.length));
    expect(code).toContain(CONFIG.EVENT_IMPORT.icalUrl);
    expect(code).toContain('"source":"sr-library-events"');
    // Must parse as a standalone script
    expect(() => new Function(code)).not.toThrow();
  });
});

describe('FlyerUtils.isPlaceholderProgram', () => {
  it('recognizes the sample row new branches and kid pages start with', () => {
    const branch = FlyerUtils.createBlankBranch('Downtown');
    expect(FlyerUtils.isPlaceholderProgram(branch.programs[0])).toBe(true);
    const kidPage = FlyerUtils.createDefaultKidPage();
    expect(FlyerUtils.isPlaceholderProgram(kidPage.cards[0])).toBe(true);
  });

  it('keeps anything staff have touched', () => {
    const base = () => FlyerUtils.createBlankBranch('Downtown').programs[0];
    expect(FlyerUtils.isPlaceholderProgram(Object.assign(base(), { name: 'Storytime' }))).toBe(false);
    expect(FlyerUtils.isPlaceholderProgram(Object.assign(base(), { timeText: '10:00am' }))).toBe(false);
    expect(FlyerUtils.isPlaceholderProgram(Object.assign(base(), { isClosure: true }))).toBe(false);
    expect(FlyerUtils.isPlaceholderProgram(Object.assign(base(), { colorOverride: '#ff0000' }))).toBe(false);
    expect(FlyerUtils.isPlaceholderProgram(Object.assign(base(), { freeTextOverride: 'Hello' }))).toBe(false);
    const card = FlyerUtils.createDefaultKidPage().cards[0];
    expect(FlyerUtils.isPlaceholderProgram(Object.assign(card, { imageId: 'img-1' }))).toBe(false);
    expect(FlyerUtils.isPlaceholderProgram(FlyerUtils.createBlankProgram())).toBe(false);
  });
});

describe('FlyerUtils.programMatchKey', () => {
  it('ignores case and extra spaces', () => {
    expect(FlyerUtils.programMatchKey('Lego  Saturdays ', 'saturdays', '10:00am–3:00pm'))
      .toBe(FlyerUtils.programMatchKey('lego saturdays', 'Saturdays', '10:00AM–3:00PM'));
  });

  it('differs when date or time differ', () => {
    const a = FlyerUtils.programMatchKey('Drop-in Tech Help', 'Tuesdays', '2:00pm–6:00pm');
    expect(FlyerUtils.programMatchKey('Drop-in Tech Help', 'Saturdays', '2:00pm–6:00pm')).not.toBe(a);
    expect(FlyerUtils.programMatchKey('Drop-in Tech Help', 'Tuesdays', '1:00pm–4:00pm')).not.toBe(a);
  });
});
