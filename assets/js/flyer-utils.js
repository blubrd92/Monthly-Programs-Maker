/* eslint-disable no-unused-vars */

/**
 * FlyerUtils — Pure/utility functions for data manipulation.
 * No DOM access. Depends on CONFIG.
 */
const FlyerUtils = (function () {
  'use strict';

  /**
   * Generate a unique ID (UUID v4-like).
   */
  function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Create a blank program entry with default values.
   */
  function createBlankProgram(defaults) {
    const d = defaults || {};
    return {
      id: generateId(),
      name: d.name || '',
      subtitle: d.subtitle || '',
      dateText: d.dateText || '',
      timeText: d.timeText || '',
      nameBold: d.nameBold !== undefined ? d.nameBold : true,
      subtitleItalic: d.subtitleItalic || false,
      isClosure: d.isClosure || false,
      freeTextOverride: d.freeTextOverride || null,
    };
  }

  /**
   * Create a blank branch with default values.
   * @param {string} [name] - Branch name
   * @param {string} [address] - Branch address
   * @param {string} [color] - Branch color hex
   */
  function createBlankBranch(name, address, color) {
    return {
      id: generateId(),
      name: name || 'New Branch',
      address: address || '',
      color: color || '#666666',
      visible: true,
      note: null,
      noteStyle: null,
      programs: [createBlankProgram(CONFIG.PLACEHOLDER_PROGRAM)],
    };
  }

  /**
   * Create a default flyer state with the standard branches.
   */
  function createDefaultFlyer() {
    const branches = CONFIG.BRANCH_DEFAULTS.map(function (def) {
      return createBlankBranch(def.name, def.address, def.color);
    });

    return {
      schema: CONFIG.SCHEMA_VERSION,
      savedAt: null,
      meta: deepClone(CONFIG.DEFAULT_META),
      header: deepClone(CONFIG.DEFAULT_HEADER),
      branches: branches,
      footer: deepClone(CONFIG.DEFAULT_FOOTER),
      styles: deepClone(CONFIG.DEFAULT_STYLES),
    };
  }

  /**
   * Deep clone a JSON-serializable object.
   */
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Serialize flyer state to a JSON string.
   */
  function serializeState(state) {
    const clone = deepClone(state);
    clone.savedAt = new Date().toISOString();
    return JSON.stringify(clone, null, 2);
  }

  /**
   * Deserialize a JSON string to flyer state.
   * Returns null if invalid.
   */
  function deserializeState(json) {
    try {
      const data = JSON.parse(json);
      if (validateFlyerData(data)) {
        return data;
      }
      return null;
    } catch (_e) {
      return null;
    }
  }

  /**
   * Validate that a parsed object has the expected flyer structure.
   */
  function validateFlyerData(data) {
    if (!data || typeof data !== 'object') {
      return false;
    }
    if (data.schema !== CONFIG.SCHEMA_VERSION) {
      return false;
    }
    if (!data.meta || typeof data.meta !== 'object') {
      return false;
    }
    if (!data.header || typeof data.header !== 'object') {
      return false;
    }
    // Kid mode pages have cards[] instead of branches[]
    if (!Array.isArray(data.branches) && !Array.isArray(data.cards)) {
      return false;
    }
    if (!data.footer || typeof data.footer !== 'object') {
      return false;
    }
    if (!data.styles || typeof data.styles !== 'object') {
      return false;
    }
    return true;
  }

  /**
   * Calculate the content area dimensions in inches.
   * @param {string} pageSize - 'letter' or 'legal'
   */
  function getContentArea(pageSize) {
    const page = CONFIG.PAGE[pageSize] || CONFIG.PAGE.letter;
    const m = CONFIG.MARGINS;
    return {
      width: page.width - m.left - m.right,
      height: page.height - m.top - m.bottom,
    };
  }

  /**
   * Build subtitle line text from program fields.
   */
  function buildSubtitleLine(program) {
    return program.subtitle || '';
  }

  /**
   * Duplicate a page (deep clone of flyer state for multi-page).
   */
  function duplicatePage(page) {
    const clone = deepClone(page);
    // Regenerate all IDs
    if (clone.branches) {
      clone.branches.forEach(function (branch) {
        branch.id = generateId();
        branch.programs.forEach(function (program) {
          program.id = generateId();
        });
      });
    }
    if (clone.cards) {
      clone.cards.forEach(function (card) {
        card.id = generateId();
      });
    }
    return clone;
  }

  /**
   * Create a blank Kid Mode program card with default values.
   */
  function createBlankCard(defaults) {
    const d = defaults || {};
    const branch = CONFIG.BRANCH_DEFAULTS[0] || {};
    return {
      id: generateId(),
      name: d.name || '',
      subtitle: d.subtitle || '',
      dateText: d.dateText || '',
      timeText: d.timeText || '',
      branchId: d.branchId || branch.name || 'Downtown',
      branchName: d.branchName || branch.name || 'Downtown',
      branchAddress: d.branchAddress || branch.address || '',
      branchColor: d.branchColor || branch.color || '#0474bf',
      isClosure: d.isClosure || false,
      freeTextOverride: d.freeTextOverride || null,
      freeTextFontSize: d.freeTextFontSize || null,
      freeTextAlign: d.freeTextAlign || null,
      freeTextBold: d.freeTextBold || false,
      freeTextItalic: d.freeTextItalic || false,
      colorOverride: d.colorOverride || null,
      imageId: d.imageId || null,
      note: d.note || '',
      nameImageId: d.nameImageId || null,
      locations: d.locations || [],
    };
  }

  /**
   * Create a default Kid Mode page.
   */
  function createDefaultKidPage() {
    const kidDefaults = CONFIG.KID_MODE_DEFAULTS;
    const kidTitle = CONFIG.HEADER_TITLE_BY_LANGUAGE['kid-english'];
    const header = deepClone(CONFIG.DEFAULT_HEADER);
    if (kidTitle) {
      header.titleText = kidTitle.text;
    }
    return {
      header: header,
      cards: [
        createBlankCard(CONFIG.PLACEHOLDER_PROGRAM),
      ],
      footer: deepClone(CONFIG.DEFAULT_FOOTER),
      styles: deepClone(kidDefaults.styles),
    };
  }

  /**
   * Get the current month name and year for defaults.
   */
  function getCurrentMonthYear() {
    const now = new Date();
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return {
      month: months[now.getMonth()],
      year: now.getFullYear(),
    };
  }

  // ── City Calendar Event Import ─────────────────────────────────

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const WEEKDAY_NAMES = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
  ];

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /**
   * Parse a calendar wall-clock string ("2026-11-03T14:00:00" or
   * "2026-11-03") without involving the browser's time zone.
   * @returns {object|null} { year, month (1-12), day, hour, minute, hasTime, weekday (0=Sun), dayKey }
   */
  function parseLocalDateTime(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(str || ''));
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    return {
      year: year,
      month: month,
      day: day,
      hour: m[4] ? Number(m[4]) : 0,
      minute: m[5] ? Number(m[5]) : 0,
      hasTime: Boolean(m[4]),
      weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
      dayKey: m[1] + '-' + m[2] + '-' + m[3],
    };
  }

  function addDays(dt, n) {
    const t = new Date(Date.UTC(dt.year, dt.month - 1, dt.day + n));
    return parseLocalDateTime(t.toISOString().slice(0, 10));
  }

  /**
   * Validate and parse the JSON the bookmarklet copies.
   * @returns {{ok: boolean, payload?: object, error?: string}}
   */
  function parseEventsPayload(text) {
    const cfg = CONFIG.EVENT_IMPORT;
    let data;
    try {
      data = JSON.parse(String(text || '').trim());
    } catch {
      return { ok: false, error: 'That doesn\'t look like copied events. Click the bookmarklet on the city calendar page, then Copy.' };
    }
    if (!data || data.source !== cfg.payloadSource || !Array.isArray(data.events)) {
      return { ok: false, error: 'That doesn\'t look like copied events. Click the bookmarklet on the city calendar page, then Copy.' };
    }
    if (typeof data.version === 'number' && data.version > cfg.payloadVersion) {
      return { ok: false, error: 'These events came from a newer bookmarklet than this tool understands. Reload the tool and try again.' };
    }
    const month = Number(data.month);
    const year = Number(data.year);
    if (!(month >= 1 && month <= 12) || !(year > 1900)) {
      return { ok: false, error: 'The copied events are missing their month. Try the bookmarklet again.' };
    }
    const events = data.events.filter(function (e) {
      return e && typeof e.title === 'string' && parseLocalDateTime(e.start);
    });
    return { ok: true, payload: { year: year, month: month, events: events } };
  }

  /**
   * Which flyer branches an event belongs to. Branch categories win;
   * the location text is the fallback. Returns [] when unknown.
   */
  function resolveEventBranches(event, importConfig) {
    const cfg = importConfig || CONFIG.EVENT_IMPORT;
    const out = [];
    (event.categories || []).forEach(function (c) {
      const b = cfg.categoryBranches[String(c).trim()];
      if (b && out.indexOf(b) === -1) out.push(b);
    });
    if (out.length) return out;
    const loc = String(event.location || '').toLowerCase();
    for (let i = 0; i < cfg.locationBranches.length; i++) {
      if (loc.indexOf(cfg.locationBranches[i].match) !== -1) {
        return [cfg.locationBranches[i].branch];
      }
    }
    return [];
  }

  function isClosureEvent(event, importConfig) {
    const cfg = importConfig || CONFIG.EVENT_IMPORT;
    return new RegExp(cfg.closureTitlePattern, 'i').test(String(event.title || ''));
  }

  function formatClockTime(dt) {
    const h12 = dt.hour % 12 || 12;
    return h12 + ':' + pad2(dt.minute) + (dt.hour < 12 ? 'am' : 'pm');
  }

  /**
   * "4:00pm–5:00pm" (or just "4:00pm" without an end). All-day → ''.
   */
  function formatEventTime(start, end, allDay, importConfig) {
    const cfg = importConfig || CONFIG.EVENT_IMPORT;
    const s = parseLocalDateTime(start);
    if (!s || allDay) return '';
    const e = parseLocalDateTime(end);
    if (e && e.hasTime && (e.hour !== s.hour || e.minute !== s.minute || e.dayKey !== s.dayKey)) {
      return formatClockTime(s) + cfg.timeRangeSeparator + formatClockTime(e);
    }
    return formatClockTime(s);
  }

  /** "Wednesday, November 4" */
  function formatEventDate(dt) {
    return WEEKDAY_NAMES[dt.weekday] + ', ' + MONTH_NAMES[dt.month - 1] + ' ' + dt.day;
  }

  /**
   * Date text for one event. Multi-day all-day events (end is exclusive)
   * become "Thursday–Friday, November 26–27".
   */
  function formatEventDateSpan(start, end, allDay) {
    if (!allDay || !end) return formatEventDate(start);
    const last = addDays(end, -1);
    if (last.dayKey <= start.dayKey) return formatEventDate(start);
    if (last.month === start.month && last.year === start.year) {
      return WEEKDAY_NAMES[start.weekday] + '–' + WEEKDAY_NAMES[last.weekday] + ', ' +
        MONTH_NAMES[start.month - 1] + ' ' + start.day + '–' + last.day;
    }
    return formatEventDate(start) + ' – ' + formatEventDate(last);
  }

  /** ["a"] → "a", ["a","b"] → "a & b", ["a","b","c"] → "a, b & c" */
  function joinWithAnd(list) {
    if (list.length <= 1) return list.join('');
    return list.slice(0, -1).join(', ') + ' & ' + list[list.length - 1];
  }

  /** "November 18 & 25", or "October 28 & November 4" across months */
  function formatDayList(dts) {
    const parts = [];
    let prevMonth = null;
    dts.forEach(function (dt) {
      if (dt.month !== prevMonth) {
        parts.push(MONTH_NAMES[dt.month - 1] + ' ' + dt.day);
        prevMonth = dt.month;
      } else {
        parts.push(String(dt.day));
      }
    });
    return joinWithAnd(parts);
  }

  function listMonthWeekdays(year, month, weekday) {
    const keys = [];
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() === weekday) {
        keys.push(year + '-' + pad2(month) + '-' + pad2(d));
      }
    }
    return keys;
  }

  /**
   * Date text for a merged series. A weekday counts as "every" when each
   * of that weekday in the month either has the program or is a closure
   * day at that branch: "Saturdays", "Wednesdays & Fridays".
   * Otherwise lists dates: "Saturdays, November 7 & 21".
   */
  function formatSeriesDates(dts, closed, year, month) {
    const have = {};
    dts.forEach(function (dt) { have[dt.dayKey] = true; });
    const weekdays = [];
    dts.forEach(function (dt) {
      if (weekdays.indexOf(dt.weekday) === -1) weekdays.push(dt.weekday);
    });
    weekdays.sort();
    const everyWeek = weekdays.every(function (wd) {
      return listMonthWeekdays(year, month, wd).every(function (k) {
        return have[k] || closed[k];
      });
    });
    if (everyWeek) {
      return joinWithAnd(weekdays.map(function (wd) { return WEEKDAY_NAMES[wd] + 's'; }));
    }
    if (weekdays.length === 1) {
      return WEEKDAY_NAMES[weekdays[0]] + 's, ' + formatDayList(dts);
    }
    return formatDayList(dts);
  }

  function normalizeTitle(title) {
    return String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * True when a closure's branches include every required branch
   * (Downtown, Northgate, Al Boro CC by default).
   */
  function isAllBranchesClosure(branches, importConfig) {
    const cfg = importConfig || CONFIG.EVENT_IMPORT;
    return cfg.allBranchesClosure.requiredBranches.every(function (b) {
      return branches.indexOf(b) !== -1;
    });
  }

  /**
   * Shorten a calendar location for a subtitle: drop city/state/zip/
   * country and keep the first two parts, e.g.
   * "First Presbyterian Church of San Rafael, 1510 Fifth Avenue".
   */
  function shortLocation(location, importConfig) {
    const cfg = importConfig || CONFIG.EVENT_IMPORT;
    const noise = new RegExp(cfg.locationNoisePattern, 'i');
    return String(location || '').split(',').map(function (p) {
      return p.replace(/\s+/g, ' ').trim();
    }).filter(function (p) {
      return p && !noise.test(p);
    }).slice(0, 2).join(', ');
  }

  /**
   * Read the month (and year, if present) from the flyer's header text,
   * in English or Spanish: "November 2026", "NOVIEMBRE 2026", "Nov".
   * Returns null for placeholder text like "Month Year".
   * @returns {{month: number, year: number|null}|null}
   */
  function parseHeaderMonth(text) {
    const t = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const words = t.match(/[a-z]+/g) || [];
    const es = CONFIG.EVENT_IMPORT.spanishMonthNames;
    let month = null;
    for (let w = 0; w < words.length && !month; w++) {
      for (let i = 0; i < 12; i++) {
        const en = MONTH_NAMES[i].toLowerCase();
        const abbrev = words[w].length >= 3 && (en.indexOf(words[w]) === 0 || es[i].indexOf(words[w]) === 0);
        if (words[w] === en || words[w] === es[i] || abbrev || (i === 8 && words[w] === 'setiembre')) {
          month = i + 1;
          break;
        }
      }
    }
    if (!month) return null;
    const y = /\b(\d{4})\b/.exec(t);
    return { month: month, year: y ? Number(y[1]) : null };
  }

  /**
   * Turn a parsed payload into import rows, one per (program, branch).
   * With combineSeries, repeats of the same title at the same branch and
   * the same time merge into one row. Closures never merge and are
   * duplicated for each branch they close.
   * @param {object} payload - from parseEventsPayload
   * @param {object} [options] - { combineSeries: true, config }
   * @returns {Array<object>} rows: { key, name, branch (string|null), location,
   *   dateText, timeText, isClosure, count, url, sortKey }
   */
  function buildImportItems(payload, options) {
    const opts = options || {};
    const cfg = opts.config || CONFIG.EVENT_IMPORT;
    const combine = opts.combineSeries !== false;
    const year = payload.year;
    const month = payload.month;
    const monthStart = year + '-' + pad2(month) + '-01';
    const monthEnd = month === 12 ? (year + 1) + '-01-01' : year + '-' + pad2(month + 1) + '-01';

    const entries = [];
    const closedDays = {};
    payload.events.forEach(function (ev) {
      const start = parseLocalDateTime(ev.start);
      if (!start) return;
      const end = parseLocalDateTime(ev.end);
      const allDay = Boolean(ev.allDay);
      // Keep events that start in the month, or all-day spans that reach into it
      const lastKey = allDay && end ? addDays(end, -1).dayKey : start.dayKey;
      if (!(start.dayKey < monthEnd && lastKey >= monthStart)) return;

      const closure = isClosureEvent(ev, cfg);
      const branches = resolveEventBranches(ev, cfg);

      // Closure days per branch, so a series skipping a holiday still reads "Fridays"
      if (closure) {
        branches.forEach(function (b) {
          const map = closedDays[b] || (closedDays[b] = {});
          let d = start;
          const last = allDay && end ? addDays(end, -1) : start;
          while (d.dayKey <= last.dayKey) {
            map[d.dayKey] = true;
            d = addDays(d, 1);
          }
        });
      }

      let targets;
      let subtitle = '';
      if (closure && isAllBranchesClosure(branches, cfg)) {
        // One row at the top of the flyer instead of one per branch
        targets = [cfg.allBranchesClosure.token];
      } else if (branches.length) {
        targets = branches;
      } else if (closure) {
        // A closure with no branch tag reads as library-wide
        targets = [cfg.allBranchesClosure.token];
      } else {
        targets = [cfg.offsiteBranch.name];
        subtitle = shortLocation(ev.location, cfg);
      }
      targets.forEach(function (branch) {
        entries.push({
          ev: ev,
          start: start,
          end: end,
          allDay: allDay,
          branch: branch,
          subtitle: subtitle,
          isClosure: closure,
          timeText: formatEventTime(ev.start, ev.end, allDay, cfg),
        });
      });
    });

    const groups = [];
    const byKey = {};
    entries.forEach(function (e, idx) {
      let key;
      if (combine && !e.isClosure && !e.allDay) {
        // Offsite events only merge when they're at the same place too
        const where = e.branch === cfg.offsiteBranch.name ? e.branch + '@' + normalizeTitle(e.ev.location) : e.branch;
        key = normalizeTitle(e.ev.title) + '|' + where + '|' + e.timeText;
      } else {
        key = '#' + idx;
      }
      if (!byKey[key]) {
        byKey[key] = [];
        groups.push({ key: key, list: byKey[key] });
      }
      byKey[key].push(e);
    });

    const items = groups.map(function (g) {
      g.list.sort(function (a, b) {
        return a.start.dayKey < b.start.dayKey ? -1 : a.start.dayKey > b.start.dayKey ? 1 : 0;
      });
      const first = g.list[0];
      // Drop accidental same-day duplicates inside a series
      const dts = [];
      g.list.forEach(function (e) {
        if (!dts.length || dts[dts.length - 1].dayKey !== e.start.dayKey) dts.push(e.start);
      });
      let dateText;
      if (dts.length > 1) {
        dateText = formatSeriesDates(dts, (first.branch && closedDays[first.branch]) || {}, year, month);
      } else {
        dateText = formatEventDateSpan(first.start, first.end, first.allDay);
      }
      return {
        key: g.key + '|' + (first.branch || ''),
        name: String(first.ev.title || '').trim(),
        branch: first.branch,
        subtitle: first.subtitle || '',
        location: String(first.ev.location || ''),
        dateText: dateText,
        timeText: first.isClosure && first.allDay ? '' : first.timeText,
        isClosure: first.isClosure,
        count: dts.length,
        url: first.ev.url || '',
        sortKey: first.start.dayKey + 'T' + pad2(first.start.hour) + pad2(first.start.minute),
      };
    });

    items.sort(function (a, b) {
      return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
    });
    return items;
  }

  /**
   * True when a program or kid card is still the untouched sample row
   * (same text as CONFIG.PLACEHOLDER_PROGRAM, nothing else customized).
   * Branch choice on a card is ignored: placeholder text is useless
   * on a flyer wherever it sits.
   */
  function isPlaceholderProgram(p) {
    const ph = CONFIG.PLACEHOLDER_PROGRAM;
    if (!p) return false;
    return p.name === ph.name &&
      (p.subtitle || '') === ph.subtitle &&
      p.dateText === ph.dateText &&
      p.timeText === ph.timeText &&
      !p.dateNote &&
      !p.freeTextOverride &&
      !p.isClosure &&
      !p.colorOverride &&
      !p.imageId &&
      !p.nameImageId &&
      !p.note &&
      !(p.locations && p.locations.length);
  }

  /**
   * Comparison key for spotting events already on the flyer:
   * name + date + time, ignoring case and extra spaces.
   */
  function programMatchKey(name, dateText, timeText) {
    return [name, dateText, timeText].map(function (s) {
      return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }).join('|');
  }

  return {
    generateId: generateId,
    createBlankProgram: createBlankProgram,
    createBlankBranch: createBlankBranch,
    createBlankCard: createBlankCard,
    createDefaultFlyer: createDefaultFlyer,
    createDefaultKidPage: createDefaultKidPage,
    deepClone: deepClone,
    serializeState: serializeState,
    deserializeState: deserializeState,
    validateFlyerData: validateFlyerData,
    getContentArea: getContentArea,
    buildSubtitleLine: buildSubtitleLine,
    duplicatePage: duplicatePage,
    getCurrentMonthYear: getCurrentMonthYear,
    parseLocalDateTime: parseLocalDateTime,
    parseEventsPayload: parseEventsPayload,
    resolveEventBranches: resolveEventBranches,
    isClosureEvent: isClosureEvent,
    formatEventTime: formatEventTime,
    formatEventDate: formatEventDate,
    formatEventDateSpan: formatEventDateSpan,
    buildImportItems: buildImportItems,
    isAllBranchesClosure: isAllBranchesClosure,
    shortLocation: shortLocation,
    parseHeaderMonth: parseHeaderMonth,
    isPlaceholderProgram: isPlaceholderProgram,
    programMatchKey: programMatchKey,
    MONTH_NAMES: MONTH_NAMES,
  };
})();
