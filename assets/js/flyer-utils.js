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
      asterisk: d.asterisk || false,
      registrationRequired: d.registrationRequired || false,
      ageGroup: d.ageGroup || null,
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
      name: name || 'NEW BRANCH',
      address: address || '',
      color: color || '#666666',
      visible: true,
      note: null,
      noteStyle: null,
      programs: [createBlankProgram({
        name: 'Program Name',
        subtitle: 'Age Group · Details',
        dateText: 'Day, Month #',
        timeText: '00:00 AM',
      })],
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
    if (!Array.isArray(data.branches)) {
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
    const parts = [];
    if (program.subtitle) {
      parts.push(program.subtitle);
    }
    if (program.ageGroup) {
      parts.push(program.ageGroup);
    }
    if (program.registrationRequired) {
      parts.push('Registration required.');
    }
    return parts.join(' ');
  }

  /**
   * Duplicate a page (deep clone of flyer state for multi-page).
   */
  function duplicatePage(page) {
    const clone = deepClone(page);
    // Regenerate all IDs
    clone.branches.forEach(function (branch) {
      branch.id = generateId();
      branch.programs.forEach(function (program) {
        program.id = generateId();
      });
    });
    return clone;
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

  return {
    generateId: generateId,
    createBlankProgram: createBlankProgram,
    createBlankBranch: createBlankBranch,
    createDefaultFlyer: createDefaultFlyer,
    deepClone: deepClone,
    serializeState: serializeState,
    deserializeState: deserializeState,
    validateFlyerData: validateFlyerData,
    getContentArea: getContentArea,
    buildSubtitleLine: buildSubtitleLine,
    duplicatePage: duplicatePage,
    getCurrentMonthYear: getCurrentMonthYear,
  };
})();
