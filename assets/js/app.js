
/**
 * FlyerApp — Core application logic: rendering, UI, state, PDF export.
 * Depends on CONFIG and FlyerUtils globals.
 */
const FlyerApp = (function () {
  'use strict';

  // ── Private State ──────────────────────────────────────────────
  let pages = [];
  let activePage = 0;
  let zoomLevel = 1;
  let isDirty = false;
  let editingProgramId = null;
  const collapsedBranches = new Set();
  let autosaveTimer = null;

  // Shared state (not per-page)
  let meta = FlyerUtils.deepClone(CONFIG.DEFAULT_META);
  let fontRoles = FlyerUtils.deepClone(CONFIG.FONT_ROLES);

  // Sortable instances (cleaned up on re-render)
  let branchSortableInstance = null;
  let programSortableInstances = [];

  // ── Helper: Debounce ───────────────────────────────────────────
  function debounce(fn, delay) {
    let timer = null;
    return function () {
      const context = this;
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(context, args);
      }, delay);
    };
  }

  // ── Helper: pt to px (screen) ──────────────────────────────────
  function ptToPx(pt) {
    return pt * (CONFIG.SCREEN_DPI / 72);
  }

  // ── Helper: Show Notification ──────────────────────────────────
  function showNotification(message, type) {
    type = type || 'info';
    const container = document.getElementById('notification-container');
    if (!container) return;

    const notif = document.createElement('div');
    notif.className = 'notification ' + type;
    notif.innerHTML = '<i class="fas fa-' +
      (type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle') +
      '"></i><span>' + message + '</span>';

    container.appendChild(notif);

    setTimeout(function () {
      notif.classList.add('fade-out');
      setTimeout(function () {
        if (notif.parentNode) {
          notif.parentNode.removeChild(notif);
        }
      }, 300);
    }, CONFIG.NOTIFICATION_DURATION);
  }

  // ── Helper: Create DOM Element ─────────────────────────────────
  /**
   * el(tag, attrs, ...children) — concise DOM element builder.
   * @param {string} tag - Element tag name
   * @param {Object|null} attrs - Attribute key/value pairs. Special keys:
   *   'class' -> className, 'style' (object) -> inline style props,
   *   'on' (object) -> event listeners, 'html' -> innerHTML
   * @param {...(Node|string)} children - Child nodes or text strings
   * @returns {HTMLElement}
   */
  function el(tag, attrs) {
    const node = document.createElement(tag);

    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        const val = attrs[key];
        if (key === 'class') {
          node.className = val;
        } else if (key === 'style' && typeof val === 'object') {
          Object.keys(val).forEach(function (prop) {
            node.style[prop] = val[prop];
          });
        } else if (key === 'on' && typeof val === 'object') {
          Object.keys(val).forEach(function (evt) {
            node.addEventListener(evt, val[evt]);
          });
        } else if (key === 'html') {
          node.innerHTML = val;
        } else if (key === 'text') {
          node.textContent = val;
        } else {
          node.setAttribute(key, val);
        }
      });
    }

    // Remaining arguments are children
    for (let i = 2; i < arguments.length; i++) {
      const child = arguments[i];
      if (child === null) continue;
      if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        node.appendChild(child);
      }
    }

    return node;
  }

  // ── Get Active Page State ──────────────────────────────────────
  function getActivePage() {
    return pages[activePage] || null;
  }

  // ── Page Dimensions (px at 96 DPI) ─────────────────────────────
  function getPageDimensions() {
    const pageDef = CONFIG.PAGE[meta.pageSize] || CONFIG.PAGE.letter;
    return {
      width: Math.round(pageDef.width * CONFIG.SCREEN_DPI),
      height: Math.round(pageDef.height * CONFIG.SCREEN_DPI),
    };
  }

  function getMarginPx() {
    return Math.round(CONFIG.MARGINS.top * CONFIG.SCREEN_DPI);
  }

  function getContentWidthPx() {
    const dims = getPageDimensions();
    const margin = getMarginPx();
    return dims.width - margin * 2;
  }

  // ══════════════════════════════════════════════════════════════
  //  RENDERING ENGINE
  // ══════════════════════════════════════════════════════════════

  // ── Render: Flyer Header ───────────────────────────────────────
  function renderFlyerHeader(header, styles) {
    const titleSize = ptToPx(styles.headerTitleFontSize || CONFIG.DEFAULT_STYLES.headerTitleFontSize);
    const monthSize = ptToPx(styles.headerMonthFontSize || CONFIG.DEFAULT_STYLES.headerMonthFontSize);

    const titleEl = el('div', {
      'class': 'flyer-header-title',
      text: header.titleText || '',
      style: {
        color: header.titleColor || CONFIG.COLORS.headerTitle,
        fontFamily: fontRoles.headerTitle,
        fontSize: titleSize + 'px',
        lineHeight: '1.1',
      },
    });

    const monthEl = el('div', {
      'class': 'flyer-header-month',
      text: header.monthText || '',
      style: {
        color: header.monthColor || CONFIG.COLORS.headerMonth,
        fontFamily: fontRoles.headerMonth,
        fontSize: monthSize + 'px',
        lineHeight: '1.1',
      },
    });

    return el('div', { 'class': 'flyer-header' }, titleEl, monthEl);
  }

  // ── Render: Single Program ─────────────────────────────────────
  function renderProgram(program, branchColor, styles) {
    const nameSize = ptToPx(styles.programNameFontSize);
    const dateSize = ptToPx(styles.programDateFontSize);
    const timeSize = ptToPx(styles.programTimeFontSize);
    const subtitleSize = ptToPx(styles.programSubtitleFontSize);
    const spacing = ptToPx(styles.programSpacing);

    // Free-text override: render as a single text block instead of grid
    if (program.freeTextOverride) {
      const freeDiv = el('div', {
        'class': 'flyer-program-freetext',
        text: program.freeTextOverride,
        style: {
          color: branchColor,
          fontFamily: fontRoles.programName,
          fontSize: nameSize + 'px',
          marginBottom: spacing + 'px',
        },
      });
      return freeDiv;
    }

    // Closure row: branch-color background, white text
    const isClosure = program.isClosure;
    const textColor = isClosure ? CONFIG.COLORS.closureText : branchColor;
    const bgColor = isClosure ? branchColor : 'transparent';

    // Build program name text
    let nameText = program.name || '';
    if (program.asterisk) {
      nameText += '*';
    }

    const nameEl = el('div', {
      'class': 'flyer-program-name',
      text: nameText,
      style: {
        color: textColor,
        fontFamily: fontRoles.programName,
        fontSize: nameSize + 'px',
        fontWeight: styles.programNameBold ? '700' : '400',
      },
    });

    const dateEl = el('div', {
      'class': 'flyer-program-date',
      text: program.dateText || '',
      style: {
        color: textColor,
        fontFamily: fontRoles.programDate,
        fontSize: dateSize + 'px',
        fontWeight: styles.programDateBold ? '700' : '400',
      },
    });

    const timeEl = el('div', {
      'class': 'flyer-program-time',
      text: program.timeText || '',
      style: {
        color: textColor,
        fontFamily: fontRoles.programTime,
        fontSize: timeSize + 'px',
        fontWeight: styles.programTimeBold ? '700' : '400',
      },
    });

    const programEl = el('div', {
      'class': 'flyer-program' + (isClosure ? ' closure' : ''),
      style: {
        backgroundColor: bgColor,
        marginBottom: spacing + 'px',
      },
    }, nameEl, dateEl, timeEl);

    // Subtitle line
    const subtitleText = FlyerUtils.buildSubtitleLine(program);
    if (subtitleText) {
      const subtitleEl = el('div', {
        'class': 'flyer-program-subtitle',
        text: subtitleText,
        style: {
          color: textColor,
          fontFamily: fontRoles.programSubtitle,
          fontSize: subtitleSize + 'px',
          fontStyle: program.subtitleItalic ? 'italic' : 'normal',
        },
      });
      programEl.appendChild(subtitleEl);
    }

    return programEl;
  }

  // ── Render: Branch ─────────────────────────────────────────────
  function renderBranch(branch, styles) {
    if (!branch.visible) return null;

    const color = branch.color || '#666666';
    const branchSpacing = ptToPx(styles.branchSpacing);
    const nameSize = ptToPx(styles.branchNameFontSize);
    const addressSize = ptToPx(styles.branchAddressFontSize);
    const stripWidth = 22; // px, wide enough for vertical branch name

    // Container — enclosed box with colored border
    const branchEl = el('div', {
      'class': 'flyer-branch',
      style: {
        marginBottom: branchSpacing + 'px',
        borderColor: color,
      },
    });

    // Left sidebar strip with vertical branch name
    const leftStrip = el('div', {
      'class': 'flyer-branch-sidebar-left',
      style: {
        backgroundColor: color,
        width: stripWidth + 'px',
      },
    });

    const nameEl = el('div', {
      'class': 'flyer-branch-name',
      text: branch.name || '',
      style: {
        fontFamily: fontRoles.branchName,
        fontSize: nameSize + 'px',
        lineHeight: '1',
      },
    });
    leftStrip.appendChild(nameEl);
    branchEl.appendChild(leftStrip);

    // Content area (programs)
    const contentEl = el('div', { 'class': 'flyer-branch-content' });

    // Branch note (if any)
    if (branch.note) {
      const noteEl = el('div', {
        'class': 'flyer-branch-note',
        text: branch.note,
        style: {
          color: color,
          borderLeftColor: color,
        },
      });
      contentEl.appendChild(noteEl);
    }

    // Programs
    if (branch.programs && branch.programs.length > 0) {
      branch.programs.forEach(function (program) {
        const progEl = renderProgram(program, color, styles);
        if (progEl) {
          contentEl.appendChild(progEl);
        }
      });
    }

    branchEl.appendChild(contentEl);

    // Right sidebar strip with vertical address
    if (branch.address) {
      const rightStrip = el('div', {
        'class': 'flyer-branch-sidebar-right',
        style: {
          backgroundColor: color,
          width: stripWidth + 'px',
        },
      });

      const addressEl = el('div', {
        'class': 'flyer-branch-address',
        text: branch.address,
        style: {
          fontFamily: fontRoles.branchAddress,
          fontSize: addressSize + 'px',
        },
      });
      rightStrip.appendChild(addressEl);
      branchEl.appendChild(rightStrip);
    }

    return branchEl;
  }

  // ── Render: Footer ─────────────────────────────────────────────
  function renderFooter(footer) {
    const footerEl = el('div', { 'class': 'flyer-footer' });
    const margin = getMarginPx();

    // Asterisk note (positioned above footer image)
    if (footer.asteriskNote) {
      const noteEl = el('div', {
        'class': 'flyer-footer-asterisk',
        text: footer.asteriskNote,
        style: {
          fontFamily: fontRoles.programSubtitle,
          paddingLeft: margin + 'px',
          paddingRight: margin + 'px',
        },
      });
      footerEl.appendChild(noteEl);
    }

    // Footer image
    let imgSrc = null;
    if (footer.source === 'custom' && footer.customImageData) {
      imgSrc = footer.customImageData;
    } else if (CONFIG.FOOTER.defaultImages[footer.source]) {
      imgSrc = CONFIG.FOOTER.defaultImages[footer.source];
    }

    if (imgSrc) {
      const imgEl = el('img', {
        'src': imgSrc,
        'alt': 'Footer',
        style: {
          width: '100%',
          display: 'block',
        },
      });
      footerEl.appendChild(imgEl);
    }

    return footerEl;
  }

  // ── Check Overflow ─────────────────────────────────────────────
  function checkOverflow() {
    const preview = document.getElementById('flyer-preview');
    const warning = document.getElementById('overflow-warning');
    if (!preview || !warning) return;

    const dims = getPageDimensions();
    const isOverflow = preview.scrollHeight > dims.height;

    if (isOverflow) {
      preview.classList.add('overflow');
      warning.classList.remove('hidden');
    } else {
      preview.classList.remove('overflow');
      warning.classList.add('hidden');
    }
  }

  // ── Render: Main Preview ───────────────────────────────────────
  function renderPreview() {
    const page = getActivePage();
    if (!page) return;

    const preview = document.getElementById('flyer-preview');
    if (!preview) return;

    const dims = getPageDimensions();
    const margin = getMarginPx();

    // Set flyer dimensions
    preview.style.width = dims.width + 'px';
    preview.style.height = dims.height + 'px';
    preview.style.position = 'relative';
    preview.style.overflow = 'hidden';

    // Clear existing content
    preview.innerHTML = '';

    // Content wrapper (within margins)
    const contentWrapper = el('div', {
      style: {
        position: 'absolute',
        top: margin + 'px',
        left: margin + 'px',
        right: margin + 'px',
        bottom: margin + 'px',
      },
    });

    // Header
    const headerEl = renderFlyerHeader(page.header, page.styles);
    contentWrapper.appendChild(headerEl);

    // Branches
    if (page.branches && page.branches.length > 0) {
      page.branches.forEach(function (branch) {
        const branchEl = renderBranch(branch, page.styles);
        if (branchEl) {
          contentWrapper.appendChild(branchEl);
        }
      });
    }

    preview.appendChild(contentWrapper);

    // Footer (absolute positioned at bottom of flyer)
    const footerEl = renderFooter(page.footer);
    preview.appendChild(footerEl);

    // Apply zoom
    const container = document.getElementById('preview-container');
    if (container) {
      container.style.transform = 'scale(' + zoomLevel + ')';
    }

    // Check overflow after DOM settles
    requestAnimationFrame(function () {
      checkOverflow();
    });
  }

  // ── Render into arbitrary container (for PDF export) ─────────
  function renderPreviewInto(container, page) {
    const dims = getPageDimensions();
    const margin = getMarginPx();

    container.style.width = dims.width + 'px';
    container.style.height = dims.height + 'px';
    container.style.position = 'relative';
    container.style.overflow = 'hidden';
    container.innerHTML = '';

    const contentWrapper = el('div', {
      style: {
        position: 'absolute',
        top: margin + 'px',
        left: margin + 'px',
        right: margin + 'px',
        bottom: margin + 'px',
      },
    });

    const headerEl = renderFlyerHeader(page.header, page.styles);
    contentWrapper.appendChild(headerEl);

    if (page.branches && page.branches.length > 0) {
      page.branches.forEach(function (branch) {
        const branchEl = renderBranch(branch, page.styles);
        if (branchEl) {
          contentWrapper.appendChild(branchEl);
        }
      });
    }

    container.appendChild(contentWrapper);

    const footerEl = renderFooter(page.footer);
    container.appendChild(footerEl);
  }

  // Debounced version for use in input handlers
  const debouncedRenderPreview = debounce(renderPreview, CONFIG.DEBOUNCE.preview);

  // ══════════════════════════════════════════════════════════════
  //  SIDEBAR: PROGRAMS TAB
  // ══════════════════════════════════════════════════════════════

  // ── Render: Program Edit Form ──────────────────────────────────
  function renderProgramEditForm(program, branchId) {
    const form = el('div', { 'class': 'program-edit-form', 'data-program-id': program.id });

    const isFreeText = !!program.freeTextOverride;

    // Toggle: structured vs free-text
    const freeTextToggle = el('div', { 'class': 'form-group' },
      el('label', { 'class': 'checkbox-label' },
        el('input', {
          'type': 'checkbox',
          'on': {
            'change': function (e) {
              const structuredFields = form.querySelector('.structured-fields');
              const freeTextField = form.querySelector('.freetext-field');
              if (e.target.checked) {
                structuredFields.style.display = 'none';
                freeTextField.style.display = 'block';
              } else {
                structuredFields.style.display = 'block';
                freeTextField.style.display = 'none';
              }
            },
          },
        }),
        'Free-text override'
      )
    );
    // Set initial checked state
    const freeTextCheckbox = freeTextToggle.querySelector('input[type="checkbox"]');
    freeTextCheckbox.checked = isFreeText;
    form.appendChild(freeTextToggle);

    // Free-text textarea
    const freeTextField = el('div', {
      'class': 'freetext-field',
      style: { display: isFreeText ? 'block' : 'none' },
    },
      el('div', { 'class': 'form-group' },
        el('label', { text: 'Free Text' }),
        el('textarea', {
          'class': 'input-freetext',
          'rows': '3',
          text: program.freeTextOverride || '',
        })
      )
    );
    form.appendChild(freeTextField);

    // Structured fields
    const structuredFields = el('div', {
      'class': 'structured-fields',
      style: { display: isFreeText ? 'none' : 'block' },
    });

    // Name
    const nameGroup = el('div', { 'class': 'form-group' },
      el('label', { text: 'Program Name' }),
      el('input', {
        'type': 'text',
        'class': 'input-name',
        'value': program.name || '',
      })
    );
    structuredFields.appendChild(nameGroup);

    // Subtitle
    const subtitleGroup = el('div', { 'class': 'form-group' },
      el('label', { text: 'Subtitle' }),
      el('input', {
        'type': 'text',
        'class': 'input-subtitle',
        'value': program.subtitle || '',
      })
    );
    structuredFields.appendChild(subtitleGroup);

    // Date + Time row
    const dateTimeRow = el('div', { 'class': 'form-row' },
      el('div', { 'class': 'form-group' },
        el('label', { text: 'Date' }),
        el('input', {
          'type': 'text',
          'class': 'input-date',
          'value': program.dateText || '',
        })
      ),
      el('div', { 'class': 'form-group' },
        el('label', { text: 'Time' }),
        el('input', {
          'type': 'text',
          'class': 'input-time',
          'value': program.timeText || '',
        })
      )
    );
    structuredFields.appendChild(dateTimeRow);

    // Age Group
    const ageGroup = el('div', { 'class': 'form-group' },
      el('label', { text: 'Age Group' }),
      el('input', {
        'type': 'text',
        'class': 'input-age-group',
        'value': program.ageGroup || '',
        'placeholder': 'e.g., Ages 5-12, All Ages',
      })
    );
    structuredFields.appendChild(ageGroup);

    // Checkboxes: Registration, Asterisk, Closure
    const checkboxGroup = el('div', { 'class': 'form-group' },
      el('label', { text: 'Options' }),
      el('div', { 'class': 'checkbox-group' },
        el('label', { 'class': 'checkbox-label' },
          el('input', { 'type': 'checkbox', 'class': 'input-registration' }),
          'Registration required'
        ),
        el('label', { 'class': 'checkbox-label' },
          el('input', { 'type': 'checkbox', 'class': 'input-asterisk' }),
          'Asterisk (*)'
        ),
        el('label', { 'class': 'checkbox-label' },
          el('input', { 'type': 'checkbox', 'class': 'input-closure' }),
          'Closure (colored row)'
        )
      )
    );

    // Set checkbox states
    const regCheckbox = checkboxGroup.querySelector('.input-registration');
    const astCheckbox = checkboxGroup.querySelector('.input-asterisk');
    const closCheckbox = checkboxGroup.querySelector('.input-closure');
    regCheckbox.checked = !!program.registrationRequired;
    astCheckbox.checked = !!program.asterisk;
    closCheckbox.checked = !!program.isClosure;

    structuredFields.appendChild(checkboxGroup);

    form.appendChild(structuredFields);

    // Action buttons: Save / Cancel
    const actions = el('div', { 'class': 'form-actions' },
      el('button', {
        'class': 'btn btn-sm btn-outline',
        html: '<i class="fas fa-times"></i> Cancel',
        'on': {
          'click': function () {
            editingProgramId = null;
            renderBranchList();
          },
        },
      }),
      el('button', {
        'class': 'btn btn-sm btn-success',
        html: '<i class="fas fa-check"></i> Save',
        'on': {
          'click': function () {
            saveProgramForm(form, program.id, branchId);
          },
        },
      })
    );
    form.appendChild(actions);

    return form;
  }

  // ── Save Program Form Data ─────────────────────────────────────
  function saveProgramForm(form, programId, branchId) {
    const page = getActivePage();
    if (!page) return;

    let branch = null;
    for (let i = 0; i < page.branches.length; i++) {
      if (page.branches[i].id === branchId) {
        branch = page.branches[i];
        break;
      }
    }
    if (!branch) return;

    let program = null;
    for (let j = 0; j < branch.programs.length; j++) {
      if (branch.programs[j].id === programId) {
        program = branch.programs[j];
        break;
      }
    }
    if (!program) return;

    const freeTextChecked = form.querySelector('.freetext-field').style.display !== 'none';

    if (freeTextChecked) {
      program.freeTextOverride = form.querySelector('.input-freetext').value || null;
    } else {
      program.freeTextOverride = null;
      program.name = form.querySelector('.input-name').value;
      program.subtitle = form.querySelector('.input-subtitle').value;
      program.dateText = form.querySelector('.input-date').value;
      program.timeText = form.querySelector('.input-time').value;
      program.ageGroup = form.querySelector('.input-age-group').value || null;
      program.registrationRequired = form.querySelector('.input-registration').checked;
      program.asterisk = form.querySelector('.input-asterisk').checked;
      program.isClosure = form.querySelector('.input-closure').checked;
    }

    editingProgramId = null;
    isDirty = true;
    renderBranchList();
    debouncedRenderPreview();
    scheduleAutosave();
  }

  // ── Schedule Autosave ──────────────────────────────────────────
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () {
      autosave();
    }, CONFIG.DEBOUNCE.autosave);
  }

  // ── Autosave to LocalStorage ───────────────────────────────────
  function autosave() {
    try {
      const state = buildFullState();
      const json = FlyerUtils.serializeState(state);
      localStorage.setItem(CONFIG.STORAGE_KEY, json);
    } catch (_e) {
      // Silently fail if localStorage is unavailable
    }
  }

  // ── Build Full State Object ────────────────────────────────────
  function buildFullState() {
    const page = getActivePage();
    return {
      schema: CONFIG.SCHEMA_VERSION,
      savedAt: null,
      meta: FlyerUtils.deepClone(meta),
      fontRoles: FlyerUtils.deepClone(fontRoles),
      header: page ? FlyerUtils.deepClone(page.header) : FlyerUtils.deepClone(CONFIG.DEFAULT_HEADER),
      branches: page ? FlyerUtils.deepClone(page.branches) : [],
      footer: page ? FlyerUtils.deepClone(page.footer) : FlyerUtils.deepClone(CONFIG.DEFAULT_FOOTER),
      styles: page ? FlyerUtils.deepClone(page.styles) : FlyerUtils.deepClone(CONFIG.DEFAULT_STYLES),
    };
  }

  // ── Render: Branch List (Sidebar Programs Tab) ─────────────────
  function renderBranchList() {
    const container = document.getElementById('branch-list');
    if (!container) return;

    const page = getActivePage();
    if (!page) {
      container.innerHTML = '<p style="color:#999;text-align:center;padding:20px;">No page loaded.</p>';
      return;
    }

    // Clean up old sortable instances
    destroySortableInstances();

    container.innerHTML = '';

    page.branches.forEach(function (branch) {
      const section = renderBranchSection(branch);
      container.appendChild(section);
    });

    // Initialize sortable on the branch list
    initBranchSortable(container);
  }

  // ── Render: Single Branch Accordion Section ────────────────────
  function renderBranchSection(branch) {
    const isCollapsed = collapsedBranches.has(branch.id);
    const color = branch.color || '#666666';

    const section = el('div', {
      'class': 'branch-section' + (isCollapsed ? ' collapsed' : ''),
      'data-branch-id': branch.id,
    });

    // Branch header row
    const header = el('div', { 'class': 'branch-header' });

    // Drag handle
    const dragHandle = el('span', {
      'class': 'branch-drag-handle',
      html: '<i class="fas fa-grip-vertical"></i>',
    });
    header.appendChild(dragHandle);

    // Branch name (colored)
    const nameDisplay = el('span', {
      'class': 'branch-name-display',
      text: branch.name || 'Untitled',
      style: { color: color },
    });
    header.appendChild(nameDisplay);

    // Action buttons
    const actions = el('div', { 'class': 'branch-actions' });

    // Add program button
    const addBtn = el('button', {
      'class': 'btn btn-sm btn-outline',
      html: '<i class="fas fa-plus"></i>',
      'title': 'Add program',
      'on': {
        'click': function (e) {
          e.stopPropagation();
          addProgramToBranch(branch.id);
        },
      },
    });
    actions.appendChild(addBtn);

    // Edit branch button
    const editBtn = el('button', {
      'class': 'btn btn-sm btn-outline',
      html: '<i class="fas fa-pen"></i>',
      'title': 'Edit branch',
      'on': {
        'click': function (e) {
          e.stopPropagation();
          editBranch(branch.id);
        },
      },
    });
    actions.appendChild(editBtn);

    // Delete branch button
    const deleteBtn = el('button', {
      'class': 'btn btn-sm btn-outline btn-delete',
      html: '<i class="fas fa-trash"></i>',
      'title': 'Delete branch',
      'on': {
        'click': function (e) {
          e.stopPropagation();
          deleteBranch(branch.id);
        },
      },
    });
    actions.appendChild(deleteBtn);

    header.appendChild(actions);

    // Toggle arrow
    const toggleArrow = el('span', {
      'class': 'branch-toggle',
      html: '<i class="fas fa-chevron-down"></i>',
    });
    header.appendChild(toggleArrow);

    // Click header to toggle collapse
    header.addEventListener('click', function (e) {
      if (e.target.closest('.branch-actions')) return;
      toggleBranchCollapse(branch.id);
    });

    section.appendChild(header);

    // Branch body (programs list)
    const body = el('div', { 'class': 'branch-body' });

    // Program cards
    const programsContainer = el('div', {
      'class': 'program-list',
      'data-branch-id': branch.id,
    });

    if (branch.programs && branch.programs.length > 0) {
      branch.programs.forEach(function (program) {
        if (editingProgramId === program.id) {
          // Show inline edit form
          const formEl = renderProgramEditForm(program, branch.id);
          programsContainer.appendChild(formEl);
        } else {
          // Show program card
          const card = renderProgramCard(program, branch.id);
          programsContainer.appendChild(card);
        }
      });
    }

    body.appendChild(programsContainer);
    section.appendChild(body);

    // Initialize sortable on program list
    initProgramSortable(programsContainer, branch.id);

    return section;
  }

  // ── Render: Program Card ───────────────────────────────────────
  function renderProgramCard(program, branchId) {
    const card = el('div', {
      'class': 'program-card',
      'data-program-id': program.id,
    });

    // Drag handle
    const dragHandle = el('span', {
      'class': 'program-drag-handle',
      html: '<i class="fas fa-grip-vertical"></i>',
    });
    card.appendChild(dragHandle);

    // Program info
    const info = el('div', { 'class': 'program-info' });

    let displayName = program.freeTextOverride
      ? program.freeTextOverride.substring(0, 40) + (program.freeTextOverride.length > 40 ? '...' : '')
      : (program.name || '(untitled)');

    if (program.isClosure) {
      displayName = '[CLOSURE] ' + displayName;
    }
    if (program.asterisk) {
      displayName += '*';
    }

    const infoName = el('div', {
      'class': 'program-info-name',
      text: displayName,
    });
    info.appendChild(infoName);

    // Date/Time detail
    const detailParts = [];
    if (program.dateText) detailParts.push(program.dateText);
    if (program.timeText) detailParts.push(program.timeText);
    if (detailParts.length > 0) {
      const infoDetail = el('div', {
        'class': 'program-info-detail',
        text: detailParts.join(' | '),
      });
      info.appendChild(infoDetail);
    }

    card.appendChild(info);

    // Card actions
    const cardActions = el('div', { 'class': 'program-card-actions' });

    const editBtn = el('button', {
      'title': 'Edit program',
      html: '<i class="fas fa-pen"></i>',
      'on': {
        'click': function () {
          editingProgramId = program.id;
          renderBranchList();
        },
      },
    });
    cardActions.appendChild(editBtn);

    const deleteBtn = el('button', {
      'class': 'btn-delete',
      'title': 'Delete program',
      html: '<i class="fas fa-trash"></i>',
      'on': {
        'click': function () {
          deleteProgram(program.id, branchId);
        },
      },
    });
    cardActions.appendChild(deleteBtn);

    card.appendChild(cardActions);

    return card;
  }

  // ── Branch Actions ─────────────────────────────────────────────
  function toggleBranchCollapse(branchId) {
    if (collapsedBranches.has(branchId)) {
      collapsedBranches.delete(branchId);
    } else {
      collapsedBranches.add(branchId);
    }
    renderBranchList();
  }

  function addProgramToBranch(branchId) {
    const page = getActivePage();
    if (!page) return;

    for (let i = 0; i < page.branches.length; i++) {
      if (page.branches[i].id === branchId) {
        const newProgram = FlyerUtils.createBlankProgram();
        page.branches[i].programs.push(newProgram);
        editingProgramId = newProgram.id;
        isDirty = true;
        // Expand the branch if collapsed
        collapsedBranches.delete(branchId);
        renderBranchList();
        debouncedRenderPreview();
        scheduleAutosave();
        return;
      }
    }
  }

  function deleteProgram(programId, branchId) {
    const page = getActivePage();
    if (!page) return;

    for (let i = 0; i < page.branches.length; i++) {
      if (page.branches[i].id === branchId) {
        page.branches[i].programs = page.branches[i].programs.filter(function (p) {
          return p.id !== programId;
        });
        if (editingProgramId === programId) {
          editingProgramId = null;
        }
        isDirty = true;
        renderBranchList();
        debouncedRenderPreview();
        scheduleAutosave();
        return;
      }
    }
  }

  function deleteBranch(branchId) {
    const page = getActivePage();
    if (!page) return;

    if (!confirm('Delete this branch and all its programs?')) return;

    page.branches = page.branches.filter(function (b) {
      return b.id !== branchId;
    });
    collapsedBranches.delete(branchId);
    isDirty = true;
    renderBranchList();
    debouncedRenderPreview();
    scheduleAutosave();
    showNotification('Branch deleted.', 'info');
  }

  function editBranch(branchId) {
    const page = getActivePage();
    if (!page) return;

    let branch = null;
    for (let i = 0; i < page.branches.length; i++) {
      if (page.branches[i].id === branchId) {
        branch = page.branches[i];
        break;
      }
    }
    if (!branch) return;

    const newName = prompt('Branch name:', branch.name);
    if (newName === null) return;
    branch.name = newName;

    const newAddress = prompt('Branch address:', branch.address);
    if (newAddress === null) return;
    branch.address = newAddress;

    const newColor = prompt('Branch color (hex):', branch.color);
    if (newColor !== null && /^#[0-9A-Fa-f]{6}$/.test(newColor)) {
      branch.color = newColor;
    }

    isDirty = true;
    renderBranchList();
    debouncedRenderPreview();
    scheduleAutosave();
  }

  // ══════════════════════════════════════════════════════════════
  //  SORTABLE.JS INTEGRATION
  // ══════════════════════════════════════════════════════════════

  function destroySortableInstances() {
    if (branchSortableInstance) {
      branchSortableInstance.destroy();
      branchSortableInstance = null;
    }
    programSortableInstances.forEach(function (inst) {
      inst.destroy();
    });
    programSortableInstances = [];
  }

  function initBranchSortable(container) {
    if (typeof Sortable === 'undefined') return;

    branchSortableInstance = Sortable.create(container, {
      handle: '.branch-drag-handle',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: function (evt) {
        const page = getActivePage();
        if (!page) return;

        const oldIndex = evt.oldIndex;
        const newIndex = evt.newIndex;
        if (oldIndex === newIndex) return;

        // Reorder branches array
        const moved = page.branches.splice(oldIndex, 1)[0];
        page.branches.splice(newIndex, 0, moved);

        isDirty = true;
        debouncedRenderPreview();
        scheduleAutosave();
      },
    });
  }

  function initProgramSortable(container, _branchId) {
    if (typeof Sortable === 'undefined') return;

    const instance = Sortable.create(container, {
      handle: '.program-drag-handle',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      group: 'programs',
      onEnd: function (evt) {
        const page = getActivePage();
        if (!page) return;

        const fromBranchId = evt.from.getAttribute('data-branch-id');
        const toBranchId = evt.to.getAttribute('data-branch-id');

        let fromBranch = null;
        let toBranch = null;
        for (let i = 0; i < page.branches.length; i++) {
          if (page.branches[i].id === fromBranchId) fromBranch = page.branches[i];
          if (page.branches[i].id === toBranchId) toBranch = page.branches[i];
        }
        if (!fromBranch || !toBranch) return;

        const oldIndex = evt.oldIndex;
        const newIndex = evt.newIndex;

        // Move program between branches (or within same branch)
        const moved = fromBranch.programs.splice(oldIndex, 1)[0];
        toBranch.programs.splice(newIndex, 0, moved);

        isDirty = true;
        renderBranchList();
        debouncedRenderPreview();
        scheduleAutosave();
      },
    });

    programSortableInstances.push(instance);
  }

  function initSortable() {
    const branchListEl = document.getElementById('branch-list');
    if (branchListEl) {
      initBranchSortable(branchListEl);
    }
  }

  // ═══════════════════════════════════════════════════
  // SETTINGS TAB BINDING
  // ═══════════════════════════════════════════════════

  function bindSettings() {
    // ── Page Size Toggle ──────────────────────────────
    const pageSizeBtns = document.querySelectorAll('[data-page-size]');
    pageSizeBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        pageSizeBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        meta.pageSize = btn.getAttribute('data-page-size');
        markDirty();
        debouncedRenderPreview();
      });
    });

    // ── Month / Year ──────────────────────────────────
    const metaMonthInput = document.getElementById('meta-month');
    const metaYearInput = document.getElementById('meta-year');

    metaMonthInput.addEventListener('input', function () {
      meta.month = metaMonthInput.value;
      markDirty();
      debouncedRenderPreview();
    });

    metaYearInput.addEventListener('input', function () {
      meta.year = parseInt(metaYearInput.value, 10) || meta.year;
      markDirty();
      debouncedRenderPreview();
    });

    // ── Header Text / Color / Size ────────────────────
    const headerTitleText = document.getElementById('header-title-text');
    const headerMonthText = document.getElementById('header-month-text');
    const headerTitleColor = document.getElementById('header-title-color');
    const headerMonthColor = document.getElementById('header-month-color');
    const headerTitleSize = document.getElementById('header-title-size');
    const headerMonthSize = document.getElementById('header-month-size');

    headerTitleText.addEventListener('input', function () {
      getCurrentPage().header.titleText = headerTitleText.value;
      markDirty();
      debouncedRenderPreview();
    });

    headerMonthText.addEventListener('input', function () {
      getCurrentPage().header.monthText = headerMonthText.value;
      markDirty();
      debouncedRenderPreview();
    });

    headerTitleColor.addEventListener('input', function () {
      getCurrentPage().header.titleColor = headerTitleColor.value;
      markDirty();
      debouncedRenderPreview();
    });

    headerMonthColor.addEventListener('input', function () {
      getCurrentPage().header.monthColor = headerMonthColor.value;
      markDirty();
      debouncedRenderPreview();
    });

    headerTitleSize.addEventListener('input', function () {
      getCurrentPage().styles.headerTitleFontSize = parseInt(headerTitleSize.value, 10) || 28;
      markDirty();
      debouncedRenderPreview();
    });

    headerMonthSize.addEventListener('input', function () {
      getCurrentPage().styles.headerMonthFontSize = parseInt(headerMonthSize.value, 10) || 28;
      markDirty();
      debouncedRenderPreview();
    });

    // ── Font Family Dropdowns ─────────────────────────
    populateFontDropdowns();

    const fontCondensed = document.getElementById('font-condensed');
    const fontDisplay = document.getElementById('font-display');

    fontCondensed.addEventListener('change', function () {
      const val = fontCondensed.value;
      fontRoles.headerTitle = val;
      fontRoles.headerMonth = val;
      fontRoles.programName = val;
      fontRoles.programDate = val;
      fontRoles.programTime = val;
      fontRoles.programSubtitle = val;
      fontRoles.branchAddress = val;
      markDirty();
      debouncedRenderPreview();
    });

    fontDisplay.addEventListener('change', function () {
      fontRoles.branchName = fontDisplay.value;
      markDirty();
      debouncedRenderPreview();
    });

    // ── Typography Size Inputs ────────────────────────
    const styleMap = {
      'style-program-name-size': 'programNameFontSize',
      'style-program-date-size': 'programDateFontSize',
      'style-program-time-size': 'programTimeFontSize',
      'style-program-subtitle-size': 'programSubtitleFontSize',
      'style-branch-name-size': 'branchNameFontSize',
      'style-branch-address-size': 'branchAddressFontSize',
      'style-program-spacing': 'programSpacing',
      'style-branch-spacing': 'branchSpacing',
    };

    Object.keys(styleMap).forEach(function (inputId) {
      const el = document.getElementById(inputId);
      if (el) {
        el.addEventListener('input', function () {
          getCurrentPage().styles[styleMap[inputId]] = parseInt(el.value, 10) || 0;
          markDirty();
          debouncedRenderPreview();
        });
      }
    });

    // ── Bold Checkboxes ───────────────────────────────
    const boldMap = {
      'style-program-name-bold': 'programNameBold',
      'style-program-date-bold': 'programDateBold',
      'style-program-time-bold': 'programTimeBold',
    };

    Object.keys(boldMap).forEach(function (inputId) {
      const el = document.getElementById(inputId);
      if (el) {
        el.addEventListener('change', function () {
          getCurrentPage().styles[boldMap[inputId]] = el.checked;
          markDirty();
          debouncedRenderPreview();
        });
      }
    });

    // ── Footer Source Toggle ──────────────────────────
    const footerSourceBtns = document.querySelectorAll('[data-footer-source]');
    footerSourceBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        footerSourceBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        const source = btn.getAttribute('data-footer-source');
        getCurrentPage().footer.source = source;
        if (source === 'custom') {
          document.getElementById('footer-upload').click();
        }
        markDirty();
        debouncedRenderPreview();
      });
    });

    // ── Footer Custom Upload ─────────────────────────
    const footerUpload = document.getElementById('footer-upload');
    footerUpload.addEventListener('change', function () {
      const file = footerUpload.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function (e) {
        getCurrentPage().footer.customImageData = e.target.result;
        getCurrentPage().footer.source = 'custom';
        markDirty();
        debouncedRenderPreview();
      };
      reader.readAsDataURL(file);
      // Reset input so same file can be re-selected
      footerUpload.value = '';
    });

    // ── Asterisk Note ────────────────────────────────
    const asteriskNote = document.getElementById('footer-asterisk-note');
    asteriskNote.addEventListener('input', function () {
      getCurrentPage().footer.asteriskNote = asteriskNote.value;
      markDirty();
      debouncedRenderPreview();
    });

    // ── Settings Section Collapse Toggles ─────────────
    const settingsHeadings = document.querySelectorAll('.settings-heading');
    settingsHeadings.forEach(function (heading) {
      heading.addEventListener('click', function () {
        const section = heading.closest('.settings-section');
        if (section) {
          section.classList.toggle('collapsed');
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════
  // FONT DROPDOWN POPULATION
  // ═══════════════════════════════════════════════════

  function populateFontDropdowns() {
    const fontCondensed = document.getElementById('font-condensed');
    const fontDisplay = document.getElementById('font-display');

    // Clear existing options
    fontCondensed.innerHTML = '';
    fontDisplay.innerHTML = '';

    CONFIG.FONT_OPTIONS.condensed.forEach(function (opt) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.value === fontRoles.headerTitle) {
        option.selected = true;
      }
      fontCondensed.appendChild(option);
    });

    CONFIG.FONT_OPTIONS.display.forEach(function (opt) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.value === fontRoles.branchName) {
        option.selected = true;
      }
      fontDisplay.appendChild(option);
    });
  }

  // ═══════════════════════════════════════════════════
  // PAGE MANAGEMENT
  // ═══════════════════════════════════════════════════

  function renderPageList() {
    const pageList = document.getElementById('page-list');
    pageList.innerHTML = '';

    pages.forEach(function (page, index) {
      const item = document.createElement('div');
      item.className = 'page-item' + (index === activePage ? ' active' : '');

      const nameSpan = document.createElement('span');
      nameSpan.className = 'page-item-name';
      nameSpan.textContent = 'Page ' + (index + 1);
      nameSpan.addEventListener('click', function () {
        switchToPage(index);
      });

      const actions = document.createElement('div');
      actions.className = 'page-item-actions';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-icon btn-sm';
      deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
      deleteBtn.title = 'Delete page';
      deleteBtn.disabled = (pages.length <= 1);
      if (pages.length <= 1) {
        deleteBtn.style.opacity = '0.3';
        deleteBtn.style.cursor = 'not-allowed';
      }
      deleteBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (pages.length <= 1) return;
        if (!confirm('Delete Page ' + (index + 1) + '? This cannot be undone.')) return;
        pages.splice(index, 1);
        if (activePage >= pages.length) {
          activePage = pages.length - 1;
        }
        markDirty();
        syncSettingsFromPage();
        renderPageList();
        renderBranchList();
        renderPreview();
      });

      actions.appendChild(deleteBtn);
      item.appendChild(nameSpan);
      item.appendChild(actions);
      pageList.appendChild(item);
    });

    // Duplicate page button
    const duplicateBtn = document.getElementById('btn-duplicate-page');
    duplicateBtn.onclick = function () {
      const currentPage = getCurrentPage();
      const newPage = FlyerUtils.duplicatePage(currentPage);
      pages.push(newPage);
      switchToPage(pages.length - 1);
      markDirty();
    };
  }

  function switchToPage(index) {
    activePage = index;
    syncSettingsFromPage();
    renderPageList();
    renderBranchList();
    renderPreview();
  }

  function getCurrentPage() {
    return pages[activePage];
  }

  /**
   * Sync sidebar settings inputs from the current active page state.
   */
  function syncSettingsFromPage() {
    const page = getCurrentPage();

    // Header inputs
    document.getElementById('header-title-text').value = page.header.titleText;
    document.getElementById('header-month-text').value = page.header.monthText;
    document.getElementById('header-title-color').value = page.header.titleColor;
    document.getElementById('header-month-color').value = page.header.monthColor;
    document.getElementById('header-title-size').value = page.styles.headerTitleFontSize;
    document.getElementById('header-month-size').value = page.styles.headerMonthFontSize;

    // Typography size inputs
    document.getElementById('style-program-name-size').value = page.styles.programNameFontSize;
    document.getElementById('style-program-date-size').value = page.styles.programDateFontSize;
    document.getElementById('style-program-time-size').value = page.styles.programTimeFontSize;
    document.getElementById('style-program-subtitle-size').value = page.styles.programSubtitleFontSize;
    document.getElementById('style-branch-name-size').value = page.styles.branchNameFontSize;
    document.getElementById('style-branch-address-size').value = page.styles.branchAddressFontSize;
    document.getElementById('style-program-spacing').value = page.styles.programSpacing;
    document.getElementById('style-branch-spacing').value = page.styles.branchSpacing;

    // Bold checkboxes
    document.getElementById('style-program-name-bold').checked = page.styles.programNameBold;
    document.getElementById('style-program-date-bold').checked = page.styles.programDateBold;
    document.getElementById('style-program-time-bold').checked = page.styles.programTimeBold;

    // Footer
    const footerSourceBtns = document.querySelectorAll('[data-footer-source]');
    footerSourceBtns.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-footer-source') === page.footer.source);
    });
    document.getElementById('footer-asterisk-note').value = page.footer.asteriskNote || '';

    // Page size
    const pageSizeBtns = document.querySelectorAll('[data-page-size]');
    pageSizeBtns.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-page-size') === meta.pageSize);
    });

    // Month / Year
    document.getElementById('meta-month').value = meta.month;
    document.getElementById('meta-year').value = meta.year;

    // Font dropdowns
    const fontCondensed = document.getElementById('font-condensed');
    const fontDisplay = document.getElementById('font-display');
    if (fontCondensed) fontCondensed.value = fontRoles.headerTitle;
    if (fontDisplay) fontDisplay.value = fontRoles.branchName;
  }

  // ═══════════════════════════════════════════════════
  // SAVE / LOAD SYSTEM
  // ═══════════════════════════════════════════════════

  function serializeAll() {
    return JSON.stringify({
      schema: CONFIG.SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      meta: FlyerUtils.deepClone(meta),
      fontRoles: FlyerUtils.deepClone(fontRoles),
      pages: pages.map(function (page) {
        return {
          header: FlyerUtils.deepClone(page.header),
          branches: FlyerUtils.deepClone(page.branches),
          footer: FlyerUtils.deepClone(page.footer),
          styles: FlyerUtils.deepClone(page.styles),
        };
      }),
    }, null, 2);
  }

  function saveFile() {
    const json = serializeAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (meta.listName || 'flyer') + '.flyer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    isDirty = false;
    showNotification('File saved successfully.', 'success');
  }

  function loadFile() {
    document.getElementById('file-input').click();
  }

  function handleFileLoad(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = JSON.parse(e.target.result);
        // Support both multi-page format and single-page legacy format
        if (data.pages && Array.isArray(data.pages)) {
          // Multi-page format: validate each page's structure
          const valid = data.pages.every(function (page) {
            return FlyerUtils.validateFlyerData({
              schema: data.schema,
              meta: data.meta,
              header: page.header,
              branches: page.branches,
              footer: page.footer,
              styles: page.styles,
            });
          });
          if (!valid) {
            showNotification('Invalid flyer file format.', 'error');
            return;
          }
          applyState(data);
        } else if (FlyerUtils.validateFlyerData(data)) {
          // Legacy single-page format
          applyState({
            schema: data.schema,
            meta: data.meta,
            fontRoles: data.fontRoles || null,
            pages: [{
              header: data.header,
              branches: data.branches,
              footer: data.footer,
              styles: data.styles,
            }],
          });
        } else {
          showNotification('Invalid flyer file format.', 'error');
        }
      } catch (_err) {
        showNotification('Failed to read file. Is it valid JSON?', 'error');
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-loaded
    event.target.value = '';
  }

  function applyState(data) {
    // Restore meta
    if (data.meta) {
      meta.month = data.meta.month || CONFIG.DEFAULT_META.month;
      meta.year = data.meta.year || CONFIG.DEFAULT_META.year;
      meta.pageSize = data.meta.pageSize || CONFIG.DEFAULT_META.pageSize;
      meta.listName = data.meta.listName || CONFIG.DEFAULT_META.listName;
    }

    // Restore font roles
    if (data.fontRoles) {
      fontRoles = FlyerUtils.deepClone(data.fontRoles);
    } else {
      fontRoles = FlyerUtils.deepClone(CONFIG.FONT_ROLES);
    }

    // Restore pages
    if (data.pages && data.pages.length > 0) {
      pages = data.pages.map(function (p) {
        return {
          header: FlyerUtils.deepClone(p.header || CONFIG.DEFAULT_HEADER),
          branches: FlyerUtils.deepClone(p.branches || []),
          footer: FlyerUtils.deepClone(p.footer || CONFIG.DEFAULT_FOOTER),
          styles: FlyerUtils.deepClone(p.styles || CONFIG.DEFAULT_STYLES),
        };
      });
    }

    activePage = 0;
    isDirty = false;

    // Update all settings inputs to reflect loaded state
    populateFontDropdowns();
    syncSettingsFromPage();
    renderPageList();
    renderBranchList();
    renderPreview();

    showNotification('File loaded successfully.', 'success');
  }

  function checkDraft() {
    try {
      const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
      if (!saved) return;
      const data = JSON.parse(saved);
      if (!data || !data.schema) return;
      if (confirm('A draft was found from ' + (data.savedAt || 'a previous session') + '. Restore it?')) {
        applyState(data);
      } else {
        localStorage.removeItem(CONFIG.STORAGE_KEY);
      }
    } catch (_e) {
      localStorage.removeItem(CONFIG.STORAGE_KEY);
    }
  }

  function markDirty() {
    isDirty = true;
    scheduleAutosave();
  }

  function resetToDefaults() {
    if (!confirm('Reset everything to defaults? All unsaved changes will be lost.')) return;
    const defaultFlyer = FlyerUtils.createDefaultFlyer();
    pages = [{
      header: defaultFlyer.header,
      branches: defaultFlyer.branches,
      footer: defaultFlyer.footer,
      styles: defaultFlyer.styles,
    }];
    activePage = 0;
    meta = FlyerUtils.deepClone(CONFIG.DEFAULT_META);
    fontRoles = FlyerUtils.deepClone(CONFIG.FONT_ROLES);
    isDirty = false;
    localStorage.removeItem(CONFIG.STORAGE_KEY);

    populateFontDropdowns();
    syncSettingsFromPage();
    renderPageList();
    renderBranchList();
    renderPreview();

    showNotification('Reset to defaults.', 'info');
  }

  // ═══════════════════════════════════════════════════
  // PDF EXPORT
  // ═══════════════════════════════════════════════════

  function exportPDF() {
    showNotification('Exporting PDF...', 'info');

    document.fonts.ready.then(function () {
      const pageDims = CONFIG.PAGE[meta.pageSize] || CONFIG.PAGE.letter;
      const pageWidth = pageDims.width;
      const pageHeight = pageDims.height;

      /* jshint -W031 */
      const pdf = new jspdf.jsPDF({
        unit: 'in',
        format: [pageWidth, pageHeight],
        orientation: 'portrait',
      });

      const scaleRatio = CONFIG.PDF.dpi / CONFIG.SCREEN_DPI;
      const previewWidthPx = pageWidth * CONFIG.SCREEN_DPI;
      const previewHeightPx = pageHeight * CONFIG.SCREEN_DPI;

      const pagePromises = [];

      pages.forEach(function (page, index) {
        pagePromises.push(function () {
          return new Promise(function (resolve) {
            // Create temporary off-screen container
            const tempDiv = document.createElement('div');
            tempDiv.style.position = 'absolute';
            tempDiv.style.left = '-9999px';
            tempDiv.style.top = '-9999px';
            tempDiv.style.width = previewWidthPx + 'px';
            tempDiv.style.height = previewHeightPx + 'px';
            tempDiv.style.overflow = 'hidden';
            tempDiv.style.background = '#fff';
            document.body.appendChild(tempDiv);

            // Render the flyer content into the temp div
            renderPreviewInto(tempDiv, page);

            // Allow a moment for rendering to settle
            setTimeout(function () {
              html2canvas(tempDiv, {
                scale: scaleRatio,
                useCORS: true,
                logging: false,
                width: previewWidthPx,
                height: previewHeightPx,
                windowWidth: previewWidthPx,
                windowHeight: previewHeightPx,
              }).then(function (canvas) {
                if (index > 0) {
                  pdf.addPage([pageWidth, pageHeight], 'portrait');
                }
                const imgData = canvas.toDataURL('image/jpeg', CONFIG.PDF.jpegQuality);
                pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight);

                // Clean up temp div
                document.body.removeChild(tempDiv);
                resolve();
              });
            }, 100);
          });
        });
      });

      // Execute page renders sequentially
      let chain = Promise.resolve();
      pagePromises.forEach(function (fn) {
        chain = chain.then(fn);
      });

      chain.then(function () {
        const filename = (meta.listName || 'flyer') + '.pdf';
        pdf.save(filename);
        showNotification('PDF exported successfully!', 'success');
      }).catch(function (err) {
        showNotification('PDF export failed: ' + err.message, 'error');
      });
    });
  }

  // ═══════════════════════════════════════════════════
  // ZOOM CONTROLS
  // ═══════════════════════════════════════════════════

  function initZoom() {
    zoomLevel = 1.0;

    document.getElementById('btn-zoom-in').addEventListener('click', function () {
      zoomLevel = Math.min(zoomLevel + 0.1, 3.0);
      applyZoom();
    });

    document.getElementById('btn-zoom-out').addEventListener('click', function () {
      zoomLevel = Math.max(zoomLevel - 0.1, 0.2);
      applyZoom();
    });

    document.getElementById('btn-zoom-reset').addEventListener('click', function () {
      zoomLevel = 1.0;
      applyZoom();
    });

    document.getElementById('btn-zoom-fit').addEventListener('click', function () {
      const wrapper = document.getElementById('preview-wrapper');
      const wrapperRect = wrapper.getBoundingClientRect();
      const pageDims = CONFIG.PAGE[meta.pageSize] || CONFIG.PAGE.letter;
      const previewWidth = pageDims.width * CONFIG.SCREEN_DPI;
      const previewHeight = pageDims.height * CONFIG.SCREEN_DPI;

      const padding = 40;
      const scaleX = (wrapperRect.width - padding) / previewWidth;
      const scaleY = (wrapperRect.height - padding) / previewHeight;
      zoomLevel = Math.min(scaleX, scaleY, 3.0);
      zoomLevel = Math.max(zoomLevel, 0.2);
      applyZoom();
    });

    // Ctrl+wheel zoom
    const previewWrapper = document.getElementById('preview-wrapper');
    previewWrapper.addEventListener('wheel', function (e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        zoomLevel = Math.max(0.2, Math.min(3.0, zoomLevel + delta));
        applyZoom();
      }
    }, { passive: false });
  }

  function applyZoom() {
    const container = document.getElementById('preview-container');
    container.style.transform = 'scale(' + zoomLevel + ')';
    const zoomText = document.getElementById('zoom-level');
    zoomText.textContent = Math.round(zoomLevel * 100) + '%';
  }

  // ═══════════════════════════════════════════════════
  // SIDEBAR TOGGLE
  // ═══════════════════════════════════════════════════

  function bindSidebarToggle() {
    document.getElementById('sidebar-toggle').addEventListener('click', function () {
      document.getElementById('sidebar').classList.toggle('collapsed');
    });
  }

  // ═══════════════════════════════════════════════════
  // TAB SWITCHING
  // ═══════════════════════════════════════════════════

  function bindTabSwitching() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const targetTab = btn.getAttribute('data-tab');

        // Toggle active on buttons
        tabBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');

        // Toggle active on tab content divs
        document.querySelectorAll('.tab-content').forEach(function (content) {
          content.classList.remove('active');
        });
        const targetContent = document.getElementById('tab-' + targetTab);
        if (targetContent) {
          targetContent.classList.add('active');
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════
  // BEFOREUNLOAD HANDLER
  // ═══════════════════════════════════════════════════

  function bindBeforeUnload() {
    window.addEventListener('beforeunload', function (e) {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  // ═══════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════

  function init() {
    // Initialize state from defaults
    const defaultFlyer = FlyerUtils.createDefaultFlyer();

    pages = [{
      header: defaultFlyer.header,
      branches: defaultFlyer.branches,
      footer: defaultFlyer.footer,
      styles: defaultFlyer.styles,
    }];
    activePage = 0;

    meta = FlyerUtils.deepClone(CONFIG.DEFAULT_META);
    fontRoles = FlyerUtils.deepClone(CONFIG.FONT_ROLES);
    isDirty = false;
    zoomLevel = 1.0;

    // Bind all settings controls
    bindSettings();

    // Initialize zoom
    initZoom();

    // Header bar buttons
    document.getElementById('btn-save').addEventListener('click', function () {
      saveFile();
    });
    document.getElementById('btn-load').addEventListener('click', function () {
      loadFile();
    });
    document.getElementById('file-input').addEventListener('change', function (e) {
      handleFileLoad(e);
    });
    document.getElementById('btn-reset').addEventListener('click', function () {
      resetToDefaults();
    });
    document.getElementById('btn-export-pdf').addEventListener('click', function () {
      exportPDF();
    });

    // Sidebar toggle and tab switching
    bindSidebarToggle();
    bindTabSwitching();

    // Add Branch button
    document.getElementById('btn-add-branch').addEventListener('click', function () {
      const newBranch = FlyerUtils.createBlankBranch();
      getCurrentPage().branches.push(newBranch);
      markDirty();
      renderBranchList();
      debouncedRenderPreview();
    });

    // Beforeunload warning
    bindBeforeUnload();

    // Check for saved draft in localStorage
    checkDraft();

    // Initial renders
    renderPreview();
    renderBranchList();
    renderPageList();
    populateFontDropdowns();
  }

  // ═══════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════

  return {
    init: init,
  };

})();

// ═══════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function () {
  FlyerApp.init();
});
