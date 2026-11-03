/* eslint-disable no-unused-vars */

/**
 * EventsBookmarklet: builds the "SR Events → Flyer" bookmarklet.
 *
 * `run` is serialized into a javascript: URL and executes on the city's
 * library events page (sanrafael.gov), NOT inside this app. It must stay
 * self-contained: no CONFIG, no FlyerUtils, no outside variables. Its
 * settings arrive as the single `opts` argument baked into the URL.
 *
 * What it does on the city page:
 *   1. Reads which month the calendar is showing.
 *   2. Asks the calendar's own endpoint (WP FullCalendar) for that month,
 *      honoring the page's category filter.
 *   3. Fetches the Events Manager iCal feed to learn each event's branch
 *      categories and location, joined by event id.
 *   4. Shows a small panel with a Copy button. The copied JSON is what
 *      the app's Import Events dialog reads.
 *
 * Loaded after config.js. Depends on CONFIG only in buildHref().
 */
const EventsBookmarklet = (function () {
  'use strict';

  function run(opts) {
    const PANEL_ID = 'sr-events-flyer-panel';
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const pad = function (n) { return (n < 10 ? '0' : '') + n; };

    // ── Panel UI ──
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'dialog');
    panel.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;width:320px;' +
      'background:#fff;color:#1f2933;border:2px solid #0474bf;border-radius:10px;' +
      'box-shadow:0 8px 28px rgba(0,0,0,.25);padding:14px 16px;' +
      'font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:left;';
    const head = document.createElement('div');
    head.style.cssText = 'font-weight:700;margin-bottom:6px;color:#0474bf;';
    head.textContent = opts.label;
    const msg = document.createElement('div');
    msg.style.cssText = 'white-space:pre-line;';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;';
    panel.appendChild(head);
    panel.appendChild(msg);
    panel.appendChild(actions);
    document.body.appendChild(panel);

    function setStatus(text) {
      msg.textContent = text;
    }
    function button(text, primary, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.style.cssText = 'font:inherit;font-weight:600;cursor:pointer;border-radius:6px;padding:6px 14px;' +
        (primary ? 'background:#0474bf;color:#fff;border:1px solid #0474bf;'
          : 'background:#fff;color:#1f2933;border:1px solid #9aa5b1;');
      b.addEventListener('click', onClick);
      return b;
    }
    function setActions(list) {
      actions.innerHTML = '';
      list.forEach(function (b) { actions.appendChild(b); });
    }
    const closeBtn = function () {
      return button('Close', false, function () { panel.remove(); });
    };

    if (!/(^|\.)sanrafael\.gov$/i.test(window.location.hostname)) {
      setStatus('Open the library events page first, then click this bookmark again.');
      setActions([
        button('Open events page', true, function () { window.location.href = opts.calendarPageUrl; }),
        closeBtn(),
      ]);
      return;
    }

    setStatus('Reading the calendar…');
    setActions([closeBtn()]);

    // ── 1. Which month is on screen? ──
    let year = null;
    let month = null;
    try {
      const view = window.jQuery('.wpfc-calendar').first().fullCalendar('getView');
      const s = view.intervalStart || view.start;
      if (s && typeof s.year === 'function') {
        year = s.year();
        month = s.month() + 1;
      }
    } catch (_e) {
      // Fall back to the visible title below
    }
    if (!year) {
      const titleEl = document.querySelector(
        '.wpfc-calendar .fc-toolbar h2, .wpfc-calendar .fc-center h2, .fc-toolbar h2, .fc-header-title h2'
      );
      const title = titleEl ? titleEl.textContent : '';
      const ym = /\b(\d{4})\b/.exec(title);
      for (let i = 0; i < 12 && ym; i++) {
        if (new RegExp('\\b' + MONTHS[i].slice(0, 3), 'i').test(title)) {
          month = i + 1;
          year = Number(ym[1]);
          break;
        }
      }
    }
    if (!year) {
      setStatus('Couldn\'t find the calendar on this page. Open the library events page, switch the calendar to the month you want, and try again.');
      setActions([
        button('Open events page', true, function () { window.location.href = opts.calendarPageUrl; }),
        closeBtn(),
      ]);
      return;
    }
    const monthLabel = MONTHS[month - 1] + ' ' + year;
    setStatus('Collecting events for ' + monthLabel + '…');

    // ── 2. Ask the calendar's own endpoint for that month ──
    const wpfc = window.WPFC || {};
    let category = opts.defaultCategoryId;
    if (wpfc.data && wpfc.data['event-categories'] !== undefined) {
      category = wpfc.data['event-categories'];
    }
    let ajax = wpfc.ajaxurl || (window.location.origin + '/wp-admin/admin-ajax.php');
    if (!/[?&]action=/.test(ajax)) ajax += (ajax.indexOf('?') === -1 ? '?' : '&') + 'action=WP_FullCalendar';
    const first = year + '-' + pad(month) + '-01';
    const after = (month === 12 ? (year + 1) + '-01' : year + '-' + pad(month + 1)) + '-01';
    const eventsUrl = ajax + '&type=event&event-categories=' + encodeURIComponent(category) +
      '&start=' + first + '&end=' + after;

    // ── 3. iCal feed: branch categories + location, keyed by event id ──
    function unescapeIcs(s) {
      return s.replace(/\\(.)/g, function (_m, c) { return c === 'n' || c === 'N' ? '\n' : c; });
    }
    function parseIcs(text) {
      const byId = {};
      const unfolded = String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
      unfolded.split('BEGIN:VEVENT').slice(1).forEach(function (block) {
        const uid = /^UID:(\d+)@/m.exec(block);
        if (!uid) return;
        const cat = /^CATEGORIES(?:;[^:\n]*)?:(.*)$/m.exec(block);
        const loc = /^LOCATION(?:;[^:\n]*)?:(.*)$/m.exec(block);
        byId[uid[1]] = {
          categories: cat ? cat[1].split(',').map(function (c) { return unescapeIcs(c).trim(); }).filter(Boolean) : [],
          location: loc ? unescapeIcs(loc[1]).replace(/\s+/g, ' ').trim() : '',
        };
      });
      return byId;
    }
    function decodeHtml(s) {
      const t = document.createElement('textarea');
      t.innerHTML = String(s || '');
      return t.value;
    }

    // Always fetch fresh: the server tells browsers to cache the feed for 30 days
    Promise.all([
      fetch(eventsUrl, { cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('calendar returned ' + r.status);
        return r.json();
      }),
      fetch(opts.icalUrl, { cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
        return r.ok ? r.text() : '';
      }).catch(function () { return ''; }),
    ]).then(function (results) {
      const info = parseIcs(results[1]);
      const events = (Array.isArray(results[0]) ? results[0] : []).filter(function (e) {
        if (!e || typeof e.start !== 'string') return false;
        const startDay = e.start.slice(0, 10);
        const endDay = e.allDay && e.end ? String(e.end).slice(0, 10) : null;
        // In this month: starts in it, or an all-day span reaching into it
        return startDay < after && (endDay ? endDay > first : startDay >= first);
      }).map(function (e) {
        const extra = info[String(e.event_id)] || { categories: [], location: '' };
        return {
          id: e.event_id,
          title: decodeHtml(e.title),
          start: e.start,
          end: e.end || null,
          allDay: Boolean(e.allDay),
          url: e.url || '',
          categories: extra.categories,
          location: extra.location,
        };
      }).sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });

      if (!events.length) {
        setStatus('No events found for ' + monthLabel + '. Use the calendar arrows to pick a month, then click the bookmark again.');
        setActions([closeBtn()]);
        return;
      }

      const payload = {
        source: opts.source,
        version: opts.version,
        year: year,
        month: month,
        category: category,
        fetchedAt: new Date().toISOString(),
        events: events,
      };
      const text = JSON.stringify(payload);
      setStatus('Found ' + events.length + ' events for ' + monthLabel + '.\n' +
        'Click Copy, then in the Flyer Maker click "Import Events" and paste.');

      function copied() {
        setStatus('Copied ' + events.length + ' events for ' + monthLabel + '.\n' +
          'Now go to the Flyer Maker, click "Import Events", and paste.');
        setActions([closeBtn()]);
      }
      function manualCopy() {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'width:100%;height:70px;margin-top:10px;font:12px monospace;';
        panel.appendChild(ta);
        ta.focus();
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (_e) { ok = false; }
        if (ok) {
          ta.remove();
          copied();
        } else {
          setStatus('Press Ctrl+C (⌘C on a Mac) to copy the selected text, then paste it in the Flyer Maker.');
        }
      }
      setActions([
        button('Copy events', true, function () {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(copied, manualCopy);
          } else {
            manualCopy();
          }
        }),
        closeBtn(),
      ]);
    }).catch(function (err) {
      setStatus('Couldn\'t load events for ' + monthLabel + ' (' + err.message + '). Reload the page and try again.');
      setActions([closeBtn()]);
    });
  }

  /**
   * The javascript: URL staff drag to their bookmarks bar.
   */
  function buildHref() {
    const c = CONFIG.EVENT_IMPORT;
    const opts = {
      label: c.bookmarkletLabel,
      calendarPageUrl: c.calendarPageUrl,
      icalUrl: c.icalUrl,
      defaultCategoryId: c.defaultCategoryId,
      source: c.payloadSource,
      version: c.payloadVersion,
    };
    return 'javascript:' + encodeURIComponent('(' + run.toString() + ')(' + JSON.stringify(opts) + ');void 0;');
  }

  return {
    run: run,
    buildHref: buildHref,
  };
})();
