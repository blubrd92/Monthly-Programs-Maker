
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
  let editingBranchDetailsId = null;
  const collapsedBranches = new Set();
  let autosaveTimer = null;
  let lastColorOverride = '#000000';

  // In-memory cache for images loaded from IndexedDB (id → dataUrl)
  const imageCache = {};

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

  /**
   * Auto-size vertical text in branch strips to fill available height.
   * For writing-mode: vertical-rl:
   *   scrollWidth = visual height of text (inline direction)
   *   height (CSS) = constrains inline size, causing line wrapping
   * Strategy: grow to fill single line, then try wrapping, then shrink.
   */
  function autoSizeVerticalText(root) {
    const maxFontSize = 18;
    const minFontSize = 6;

    const elements = root.querySelectorAll('[data-auto-size]');
    elements.forEach(function (textEl) {
      const strip = textEl.parentElement;
      if (!strip) return;

      // Use getBoundingClientRect for reliable physical dimensions
      // regardless of writing-mode quirks with scrollWidth/scrollHeight.
      // Divide by zoomLevel since getBoundingClientRect includes CSS transforms.
      const stripRect = strip.getBoundingClientRect();
      const stripPhysW = stripRect.width / zoomLevel;
      const stripPhysH = stripRect.height / zoomLevel;
      if (stripPhysH <= 0 || stripPhysW <= 0) return;

      const padding = 2;
      const usableH = stripPhysH - padding;
      if (usableH <= 0) return;

      textEl.style.lineHeight = '1.05';

      // Check if text contains manual line breaks — if so, skip single-line strategy
      const hasLineBreaks = textEl.textContent.indexOf('\n') !== -1;

      // Helper: check if text physically fits inside the strip
      function textFits() {
        const r = textEl.getBoundingClientRect();
        return r.height / zoomLevel <= usableH + 0.5 && r.width / zoomLevel <= stripPhysW + 0.5;
      }

      // Helper: check if text width (lines) fits in strip width
      function widthFits() {
        const r = textEl.getBoundingClientRect();
        return r.width / zoomLevel <= stripPhysW + 0.5;
      }

      // Strategy A: single line — only if no manual line breaks
      let singleSize = minFontSize;
      if (!hasLineBreaks) {
        textEl.style.whiteSpace = 'nowrap';
        textEl.style.height = '';
        textEl.style.wordBreak = '';
        textEl.style.fontSize = minFontSize + 'px';

        if (textFits()) {
          while (singleSize < maxFontSize) {
            textEl.style.fontSize = (singleSize + 1) + 'px';
            if (!textFits()) break;
            singleSize += 1;
          }
        }
      }

      // Strategy B: wrapped — constrain height to force line wrapping,
      // then grow font while lines still fit in strip width.
      // Use pre-wrap to preserve manual \n line breaks.
      textEl.style.whiteSpace = 'pre-wrap';
      textEl.style.height = usableH + 'px';
      textEl.style.wordBreak = 'break-word';
      textEl.style.fontSize = minFontSize + 'px';

      let wrapSize = minFontSize;
      if (widthFits()) {
        while (wrapSize < maxFontSize) {
          textEl.style.fontSize = (wrapSize + 1) + 'px';
          if (!widthFits()) break;
          wrapSize += 1;
        }
      }

      // Pick whichever strategy gives the larger font
      if (!hasLineBreaks && singleSize >= wrapSize) {
        textEl.style.whiteSpace = 'nowrap';
        textEl.style.height = '';
        textEl.style.wordBreak = '';
        textEl.style.fontSize = singleSize + 'px';
      } else {
        textEl.style.whiteSpace = 'pre-wrap';
        textEl.style.height = usableH + 'px';
        textEl.style.wordBreak = 'break-word';
        textEl.style.fontSize = wrapSize + 'px';
      }
    });
  }

  /**
   * Replace vertical text elements with canvas images for PDF export.
   * html2canvas doesn't support writing-mode: vertical-rl, so we
   * pre-render vertical text onto canvas elements that look identical.
   */
  function rasterizeVerticalText(root, scale) {
    const elements = root.querySelectorAll('[data-auto-size]');
    elements.forEach(function (textEl) {
      const strip = textEl.parentElement;
      if (!strip) return;

      const stripW = strip.offsetWidth;
      const stripH = strip.offsetHeight;
      if (stripW <= 0 || stripH <= 0) return;

      // Read computed styles from the text element
      const cs = window.getComputedStyle(textEl);
      const fontSize = parseFloat(cs.fontSize);
      const fontFamily = cs.fontFamily;
      const fontWeight = cs.fontWeight;
      const color = cs.color;
      const textTransform = cs.textTransform;
      let textContent = textEl.textContent || '';
      if (textTransform === 'uppercase') textContent = textContent.toUpperCase();
      else if (textTransform === 'lowercase') textContent = textContent.toLowerCase();
      const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.05;
      const isWrapped = cs.whiteSpace !== 'nowrap';

      // Create a canvas the size of the strip
      const canvas = document.createElement('canvas');
      canvas.width = stripW * scale;
      canvas.height = stripH * scale;
      canvas.style.width = stripW + 'px';
      canvas.style.height = stripH + 'px';
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';

      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.fillStyle = color;
      ctx.font = fontWeight + ' ' + fontSize + 'px ' + fontFamily;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      // Split text into lines (manual breaks or wrapped)
      let lines;
      if (isWrapped && textContent.indexOf('\n') !== -1) {
        lines = textContent.split('\n');
      } else if (isWrapped) {
        // Approximate word wrapping for vertical text
        // Each "line" in vertical mode stacks horizontally
        const words = textContent.split(/\s+/);
        lines = [];
        let current = words[0] || '';
        for (let i = 1; i < words.length; i++) {
          const test = current + ' ' + words[i];
          if (ctx.measureText(test).width > stripH - 8) {
            lines.push(current);
            current = words[i];
          } else {
            current = test;
          }
        }
        if (current) lines.push(current);
      } else {
        lines = [textContent];
      }

      // Draw lines vertically (rotated 90° CCW, reading bottom to top)
      const totalWidth = lines.length * lineHeight;
      const startX = (stripW - totalWidth) / 2 + lineHeight / 2;

      lines.forEach(function (line, i) {
        const x = startX + i * lineHeight;
        const y = stripH / 2;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(line, 0, 0);
        ctx.restore();
      });

      // Hide original text, show canvas
      textEl.style.visibility = 'hidden';
      strip.appendChild(canvas);
    });
  }

  // ── Render: Flyer Header ───────────────────────────────────────
  function renderFlyerHeader(header, styles) {
    const titleSize = ptToPx(styles.headerTitleFontSize || CONFIG.DEFAULT_STYLES.headerTitleFontSize);
    const monthSize = ptToPx(styles.headerMonthFontSize || CONFIG.DEFAULT_STYLES.headerMonthFontSize);

    // Kid mode: centered, stacked lines, month appended to title
    if (meta.mode === 'kid') {
      const titleText = header.titleText || '';
      const monthText = header.monthText || '';
      const lines = titleText.split('\n');
      // Append month to the last line
      if (monthText) {
        lines[lines.length - 1] = lines[lines.length - 1] + ' ' + monthText;
      }

      const headerDiv = el('div', {
        'class': 'flyer-header flyer-header-kid',
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0',
        },
      });

      lines.forEach(function (line, i) {
        // Last line contains month text — render it with mixed colors
        if (monthText && i === lines.length - 1) {
          const titlePart = lines[lines.length - 1].replace(' ' + monthText, '');
          const lineEl = el('div', {
            style: {
              fontFamily: fontRoles.headerTitle,
              fontSize: titleSize + 'px',
              fontWeight: '700',
              textTransform: 'uppercase',
              lineHeight: '1.1',
            },
          });
          lineEl.appendChild(el('span', {
            text: titlePart + ' ',
            style: { color: header.titleColor || CONFIG.COLORS.headerTitle },
          }));
          lineEl.appendChild(el('span', {
            text: monthText,
            style: { color: header.monthColor || CONFIG.COLORS.headerMonth },
          }));
          headerDiv.appendChild(lineEl);
        } else {
          headerDiv.appendChild(el('div', {
            text: line,
            style: {
              color: header.titleColor || CONFIG.COLORS.headerTitle,
              fontFamily: fontRoles.headerTitle,
              fontSize: titleSize + 'px',
              fontWeight: '700',
              textTransform: 'uppercase',
              lineHeight: '1.1',
            },
          }));
        }
      });

      return headerDiv;
    }

    // Standard mode: side-by-side title + month
    // Check if title contains a "de la" pattern for stacked rendering
    const delaMatch = (header.titleText || '').match(/^(.+?)\s+(de)\s+(la)\s+(.+)$/i);

    let titleEl;
    if (delaMatch) {
      const stackSize = titleSize * 0.45;
      const titleHtml =
        '<span>' + delaMatch[1] + '</span> ' +
        '<span style="display:inline-flex;flex-direction:column;vertical-align:middle;align-items:center;line-height:0.9;gap:0;font-size:' + stackSize + 'px;margin:0 1px;position:relative;top:-4px">' +
          '<span>' + delaMatch[2] + '</span>' +
          '<span>' + delaMatch[3] + '</span>' +
        '</span> ' +
        '<span>' + delaMatch[4] + '</span>';
      titleEl = el('div', {
        'class': 'flyer-header-title',
        html: titleHtml,
        style: {
          color: header.titleColor || CONFIG.COLORS.headerTitle,
          fontFamily: fontRoles.headerTitle,
          fontSize: titleSize + 'px',
          lineHeight: '1',
        },
      });
    } else {
      titleEl = el('div', {
        'class': 'flyer-header-title',
        text: header.titleText || '',
        style: {
          color: header.titleColor || CONFIG.COLORS.headerTitle,
          fontFamily: fontRoles.headerTitle,
          fontSize: titleSize + 'px',
          lineHeight: '1',
        },
      });
    }

    const monthEl = el('div', {
      'class': 'flyer-header-month',
      text: header.monthText || '',
      style: {
        color: header.monthColor || CONFIG.COLORS.headerMonth,
        fontFamily: fontRoles.headerMonth,
        fontSize: monthSize + 'px',
        lineHeight: '1',
      },
    });

    return el('div', { 'class': 'flyer-header' }, titleEl, monthEl);
  }

  // ── Render: Single Program ─────────────────────────────────────
  function renderProgram(program, branchColor, styles) {
    const effectiveColor = program.colorOverride || branchColor;
    const nameSize = ptToPx(styles.programNameFontSize);
    const dateSize = ptToPx(styles.programDateFontSize);
    const timeSize = ptToPx(styles.programTimeFontSize);
    const subtitleSize = ptToPx(styles.programSubtitleFontSize);

    // Free-text override: render as a single text block
    if (program.freeTextOverride) {
      const ftSize = ptToPx(program.freeTextFontSize || 12);
      const ftClosure = program.isClosure;
      const ftColor = ftClosure ? CONFIG.COLORS.closureText : effectiveColor;
      const ftBg = ftClosure ? effectiveColor : 'transparent';
      const classes = 'flyer-program flyer-program-freetext' + (ftClosure ? ' closure' : '');
      const freeDiv = el('div', {
        'class': classes,
        text: program.freeTextOverride,
        style: {
          color: ftColor,
          backgroundColor: ftBg,
          fontFamily: fontRoles.programName,
          fontSize: ftSize + 'px',
          textAlign: program.freeTextAlign || 'left',
          fontWeight: program.freeTextBold ? '700' : '400',
          fontStyle: program.freeTextItalic ? 'italic' : 'normal',
          padding: '1px 8px',
        },
      });
      return freeDiv;
    }

    // Closure row: branch-color background, white text
    const isClosure = program.isClosure;
    const textColor = isClosure ? CONFIG.COLORS.closureText : effectiveColor;
    const bgColor = isClosure ? effectiveColor : 'transparent';

    const nameText = program.name || '';

    // Name + subtitle combined cell
    const nameCell = el('div', {
      'class': 'flyer-program-name',
      style: {
        color: textColor,
      },
    });

    const subtitleText = FlyerUtils.buildSubtitleLine(program);
    const inlineSubtitle = !!program.subtitleInline;

    if (inlineSubtitle && subtitleText) {
      // Append subtitle inline after program name
      const nameSpan = el('span', {
        text: nameText,
        style: {
          fontFamily: fontRoles.programName,
          fontSize: nameSize + 'px',
          fontWeight: styles.programNameBold ? '700' : '400',
        },
      });
      const separator = el('span', {
        text: ' ',
      });
      const subtitleSpan = el('span', {
        text: subtitleText,
        style: {
          fontFamily: fontRoles.programSubtitle,
          fontSize: subtitleSize + 'px',
          fontWeight: '400',
          fontStyle: program.subtitleItalic ? 'italic' : 'normal',
        },
      });
      nameCell.appendChild(nameSpan);
      nameCell.appendChild(separator);
      nameCell.appendChild(subtitleSpan);
    } else {
      const nameLine = el('div', {
        text: nameText,
        style: {
          fontFamily: fontRoles.programName,
          fontSize: nameSize + 'px',
          fontWeight: styles.programNameBold ? '700' : '400',
        },
      });
      nameCell.appendChild(nameLine);

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
        nameCell.appendChild(subtitleEl);
      }
    }

    const dateEl = el('div', {
      'class': 'flyer-program-date',
      style: {
        color: textColor,
        fontFamily: fontRoles.programDate,
        fontSize: dateSize + 'px',
        fontWeight: styles.programDateBold ? '700' : '400',
      },
    });

    const dateLines = (program.dateText || '').split('\n');
    const dateNoteLines = (program.dateNote || '').split('\n');

    dateLines.forEach(function (line, i) {
      if (i > 0) dateEl.appendChild(document.createElement('br'));
      const dateSpan = document.createTextNode(line);
      dateEl.appendChild(dateSpan);
      const note = dateNoteLines[i];
      if (note) {
        dateEl.appendChild(document.createTextNode(' '));
        const noteSpan = el('span', {
          text: note,
          style: {
            fontFamily: fontRoles.programSubtitle,
            fontSize: dateSize + 'px',
            fontWeight: '400',
          },
        });
        dateEl.appendChild(noteSpan);
      }
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

    // Column widths from styles (name gets 1fr, date fills remainder, time is fixed %)
    const colTime = (styles.columnTimeWidth || 20) + '%';
    const colDate = (100 - (styles.columnNameWidth || 48) - (styles.columnTimeWidth || 20)) + '%';
    const programEl = el('div', {
      'class': 'flyer-program' + (isClosure ? ' closure' : ''),
      style: {
        backgroundColor: bgColor,
        color: effectiveColor,
        gridTemplateColumns: '1fr ' + colDate + ' ' + colTime,
      },
    }, nameCell, dateEl, timeEl);

    return programEl;
  }

  // ── Render: Branch ─────────────────────────────────────────────
  function renderBranch(branch, styles) {
    if (!branch.visible) return null;

    const color = branch.color || '#666666';
    const nameSize = ptToPx(styles.branchNameFontSize);
    const addressSize = ptToPx(styles.branchAddressFontSize);
    const stripWidth = 30; // px, fixed width for vertical name/address strips
    const filled = !!styles.stripFilled;
    const stripBg = filled ? color : '#ffffff';
    const stripTextColor = filled ? '#ffffff' : color;

    // Container — enclosed box with colored border
    const isSingleClosure = branch.programs && branch.programs.length === 1 && branch.programs[0].isClosure;
    const showBorders = styles.branchBorders !== false || isSingleClosure;
    const branchEl = el('div', {
      'class': 'flyer-branch',
      style: {
        backgroundColor: filled ? color : 'transparent',
        backgroundClip: 'padding-box',
        borderColor: 'transparent',
        borderTopWidth: '0',
        borderBottomWidth: '0',
      },
    });

    // Left sidebar strip with vertical branch name
    const leftStrip = el('div', {
      'class': 'flyer-branch-sidebar-left',
      style: {
        backgroundColor: stripBg,
        width: stripWidth + 'px',
        borderRight: filled ? 'none' : '2px solid ' + color,
      },
    });

    const nameEl = el('div', {
      'class': 'flyer-branch-name',
      'data-auto-size': 'true',
      text: branch.name || '',
      style: {
        fontFamily: fontRoles.branchName,
        fontSize: nameSize + 'px',
        lineHeight: '1',
        color: stripTextColor,
      },
    });
    leftStrip.appendChild(nameEl);
    branchEl.appendChild(leftStrip);

    // Content area (programs)
    const contentBorderColor = showBorders ? color : (filled ? '#ffffff' : 'transparent');
    const contentEl = el('div', {
      'class': 'flyer-branch-content',
      style: {
        borderTop: '2px solid ' + contentBorderColor,
        borderBottom: '2px solid ' + contentBorderColor,
        backgroundColor: '#ffffff',
      },
    });

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

    // Right sidebar strip with vertical address (always shown)
    const rightStrip = el('div', {
      'class': 'flyer-branch-sidebar-right',
      style: {
        backgroundColor: stripBg,
        width: stripWidth + 'px',
        borderLeft: filled ? 'none' : '2px solid ' + color,
      },
    });

    if (branch.address) {
      const addressEl = el('div', {
        'class': 'flyer-branch-address',
        'data-auto-size': 'true',
        text: branch.address,
        style: {
          fontFamily: fontRoles.branchAddress,
          fontSize: addressSize + 'px',
          lineHeight: '1',
          color: stripTextColor,
        },
      });
      rightStrip.appendChild(addressEl);
    }
    branchEl.appendChild(rightStrip);

    return branchEl;
  }

  // ── Render: Footer ─────────────────────────────────────────────
  function renderFooter(footer) {
    const footerEl = el('div', { 'class': 'flyer-footer' });

    // Asterisk note (positioned above footer image)
    if (footer.asteriskNote) {
      const astSize = ptToPx(footer.asteriskFontSize || 12);
      const noteEl = el('div', {
        'class': 'flyer-footer-asterisk',
        text: footer.asteriskNote,
        style: {
          fontFamily: fontRoles.programSubtitle,
          fontSize: astSize + 'px',
          textAlign: 'left',
          paddingLeft: '30px',
          fontWeight: footer.asteriskBold ? '700' : '400',
          fontStyle: footer.asteriskItalic ? 'italic' : 'normal',
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

  // ══════════════════════════════════════════════════════════════
  //  KID MODE RENDERING
  // ══════════════════════════════════════════════════════════════

  function renderKidCard(card, styles, page) {
    const effectiveColor = card.colorOverride || card.branchColor || '#0474bf';
    const nameSize = ptToPx(styles.programNameFontSize);
    const dateSize = ptToPx(styles.programDateFontSize);
    const timeSize = ptToPx(styles.programTimeFontSize);
    const subtitleSize = ptToPx(styles.programSubtitleFontSize);
    const noteSize = ptToPx(styles.programNoteFontSize || 10);
    const borderWidth = (styles.cardBorderWidth || 3) + 'px';
    const borderRadius = (styles.cardBorderRadius || 40) + 'px';
    const imageWidth = (styles.cardImageWidth || 180) + 'px';
    const isSpanish = page && page.footer && page.footer.source === 'default-spanish';

    // Free-text override
    if (card.freeTextOverride) {
      const ftSize = ptToPx(card.freeTextFontSize || 12);
      const ftClosure = card.isClosure;
      const ftColor = ftClosure ? CONFIG.COLORS.closureText : effectiveColor;
      const ftBg = ftClosure ? effectiveColor : '#ffffff';
      return el('div', {
        'class': 'flyer-kid-card' + (ftClosure ? ' closure' : ''),
        text: card.freeTextOverride,
        style: {
          border: borderWidth + ' solid ' + effectiveColor,
          borderRadius: borderRadius,
          color: ftColor,
          backgroundColor: ftBg,
          fontFamily: fontRoles.programName,
          fontSize: ftSize + 'px',
          textAlign: card.freeTextAlign || 'left',
          fontWeight: card.freeTextBold ? '700' : '400',
          fontStyle: card.freeTextItalic ? 'italic' : 'normal',
          padding: '4px 8px',
        },
      });
    }

    const isClosure = card.isClosure;
    const textColor = isClosure ? CONFIG.COLORS.closureText : effectiveColor;
    const branchTextColor = isClosure ? CONFIG.COLORS.closureText : (card.branchColor || '#0474bf');
    const bgColor = isClosure ? effectiveColor : '#ffffff';

    // Image zone (left side)
    const imageDataUrl = card.imageId ? imageCache[card.imageId] : null;
    let imageZone;
    if (imageDataUrl) {
      imageZone = el('div', {
        'class': 'flyer-kid-card-image',
        style: { width: imageWidth },
      }, el('img', { src: imageDataUrl, alt: '' }));
    } else {
      imageZone = el('div', {
        'class': 'flyer-kid-card-image empty',
        style: {
          width: imageWidth,
          color: effectiveColor,
          borderRight: '1px dashed ' + effectiveColor,
        },
      }, el('i', { 'class': 'fas fa-image', style: { fontSize: '16px' } }));
    }

    // Center: name (or name image) + subtitle
    const centerZone = el('div', { 'class': 'flyer-kid-card-center' });

    const nameImageDataUrl = card.nameImageId ? imageCache[card.nameImageId] : null;
    if (nameImageDataUrl) {
      centerZone.style.paddingTop = '0';
      centerZone.style.paddingBottom = '0';
      centerZone.appendChild(el('img', {
        'class': 'flyer-kid-card-name-image',
        src: nameImageDataUrl,
        alt: card.name || '',
      }));
    } else {
      centerZone.appendChild(el('div', {
        'class': 'flyer-kid-card-name',
        text: card.name || '',
        style: {
          fontFamily: fontRoles.programName,
          fontSize: nameSize + 'px',
          fontWeight: styles.programNameBold ? '700' : '400',
          color: textColor,
        },
      }));
    }

    if (card.subtitle) {
      centerZone.appendChild(el('div', {
        'class': 'flyer-kid-card-subtitle',
        text: card.subtitle,
        style: {
          fontFamily: fontRoles.programSubtitle,
          fontSize: subtitleSize + 'px',
          color: textColor,
          whiteSpace: 'pre-line',
        },
      }));
    }

    if (card.note) {
      centerZone.appendChild(el('div', {
        'class': 'flyer-kid-card-note',
        text: card.note,
        style: {
          fontFamily: fontRoles.programSubtitle,
          fontSize: noteSize + 'px',
          color: textColor,
          whiteSpace: 'pre-line',
        },
      }));
    }

    // Right zone: single location or multi-location
    let rightZone;
    const hasMultiLocation = card.locations && card.locations.length > 0;

    if (hasMultiLocation) {
      // Wrapper: flex column for shared fields on top + columns below
      rightZone = el('div', {
        'class': 'flyer-kid-card-locations-wrapper',
        style: { width: imageWidth, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', flexShrink: '0', boxSizing: 'border-box', padding: '1px 6px 1px 0' },
      });

      // Check for shared date/time across all locations
      const allDays = [card.dateText || ''].concat(card.locations.map(function (l) { return l.dayText || ''; }));
      const allTimes = [card.timeText || ''].concat(card.locations.map(function (l) { return l.timeText || ''; }));
      const sharedDay = allDays.every(function (d) { return d === allDays[0]; }) && allDays[0] ? allDays[0] : null;
      const sharedTime = allTimes.every(function (t) { return t === allTimes[0]; }) && allTimes[0] ? allTimes[0] : null;

      // Scale font sizes to fit available space
      const totalCols = 1 + card.locations.length;
      const scaleFactor = Math.max(0.5, 1 / (1 + 0.35 * (totalCols - 1)));
      const mlDateSize = Math.round(dateSize * scaleFactor);
      const mlTimeSize = Math.round(timeSize * scaleFactor);
      const mlBranchSize = Math.round(dateSize * 0.9 * scaleFactor);

      // Render shared fields above columns (full width, centered)
      const sharedDayEl = sharedDay ? el('div', {
        text: sharedDay,
        style: {
          fontFamily: fontRoles.programDate,
          fontSize: dateSize + 'px',
          fontWeight: styles.programDateBold ? '700' : '400',
          color: textColor,
          textAlign: 'center',
          lineHeight: '1.1',
          margin: '0',
        },
      }) : null;
      const sharedTimeEl = sharedTime ? el('div', {
        text: sharedTime,
        style: {
          fontFamily: fontRoles.programTime,
          fontSize: timeSize + 'px',
          fontWeight: styles.programTimeBold ? '700' : '400',
          color: textColor,
          textAlign: 'center',
          lineHeight: '1.1',
          margin: '0',
        },
      }) : null;

      if (isSpanish) {
        if (sharedTimeEl) rightZone.appendChild(sharedTimeEl);
        if (sharedDayEl) rightZone.appendChild(sharedDayEl);
      } else {
        if (sharedDayEl) rightZone.appendChild(sharedDayEl);
        if (sharedTimeEl) rightZone.appendChild(sharedTimeEl);
      }

      // Columns row
      const colsRow = el('div', { 'class': 'flyer-kid-card-locations' });

      // Helper to build a location column (skip shared fields)
      // dateTimeColor: color for date/time text; locBranchColor: color for branch name/address
      function buildLocCol(dayText, locTimeText, branchName, branchAddress, dateTimeColor, locBranchColor) {
        const col = el('div', { 'class': 'location-col' });
        const colDayEl = (dayText && !sharedDay) ? el('div', {
          text: dayText,
          style: {
            fontFamily: fontRoles.programDate,
            fontSize: mlDateSize + 'px',
            fontWeight: styles.programDateBold ? '700' : '400',
            color: dateTimeColor,
          },
        }) : null;
        const colTimeEl = (locTimeText && !sharedTime) ? el('div', {
          text: locTimeText,
          style: {
            fontFamily: fontRoles.programTime,
            fontSize: mlTimeSize + 'px',
            fontWeight: styles.programTimeBold ? '700' : '400',
            color: dateTimeColor,
          },
        }) : null;
        if (isSpanish) {
          if (colTimeEl) col.appendChild(colTimeEl);
          if (colDayEl) col.appendChild(colDayEl);
        } else {
          if (colDayEl) col.appendChild(colDayEl);
          if (colTimeEl) col.appendChild(colTimeEl);
        }
        if (branchName) {
          col.appendChild(el('div', {
            'class': 'flyer-kid-card-branch',
            text: branchName,
            style: {
              fontFamily: fontRoles.programDate,
              fontSize: mlBranchSize + 'px',
              color: locBranchColor,
            },
          }));
        }
        if (branchAddress) {
          col.appendChild(el('div', {
            'class': 'flyer-kid-card-address',
            text: branchAddress,
            style: {
              fontFamily: fontRoles.programDate,
              fontSize: mlBranchSize + 'px',
              color: locBranchColor,
            },
          }));
        }
        return col;
      }

      // First column: card's main location
      // In-column date/time uses branch's own color; only hoisted shared fields use color override
      colsRow.appendChild(buildLocCol(
        card.dateText, card.timeText, card.branchName, card.branchAddress, branchTextColor, branchTextColor
      ));

      // Additional columns from locations[]
      card.locations.forEach(function (loc) {
        const locBranchColor = isClosure ? CONFIG.COLORS.closureText : (loc.branchColor || '#0474bf');
        colsRow.appendChild(buildLocCol(
          loc.dayText, loc.timeText, loc.branchName, loc.branchAddress, locBranchColor, locBranchColor
        ));
      });

      rightZone.appendChild(colsRow);
    } else {
      rightZone = el('div', { 'class': 'flyer-kid-card-location', style: { width: imageWidth } });

      const dateEl = card.dateText ? el('div', {
        'class': 'flyer-kid-card-date',
        text: card.dateText,
        style: {
          fontFamily: fontRoles.programDate,
          fontSize: dateSize + 'px',
          fontWeight: styles.programDateBold ? '700' : '400',
          color: textColor,
        },
      }) : null;

      const timeEl = card.timeText ? el('div', {
        'class': 'flyer-kid-card-time',
        text: card.timeText,
        style: {
          fontFamily: fontRoles.programTime,
          fontSize: timeSize + 'px',
          fontWeight: styles.programTimeBold ? '700' : '400',
          color: textColor,
        },
      }) : null;

      if (isSpanish) {
        if (timeEl) rightZone.appendChild(timeEl);
        if (dateEl) rightZone.appendChild(dateEl);
      } else {
        if (dateEl) rightZone.appendChild(dateEl);
        if (timeEl) rightZone.appendChild(timeEl);
      }

      if (card.branchName) {
        rightZone.appendChild(el('div', {
          'class': 'flyer-kid-card-branch',
          text: card.branchName,
          style: {
            fontFamily: fontRoles.programDate,
            fontSize: (dateSize * 0.9) + 'px',
            color: branchTextColor,
          },
        }));
      }

      if (card.branchAddress) {
        rightZone.appendChild(el('div', {
          'class': 'flyer-kid-card-address',
          text: card.branchAddress,
          style: {
            fontFamily: fontRoles.programDate,
            fontSize: (dateSize * 0.9) + 'px',
            color: branchTextColor,
          },
        }));
      }
    }

    const cardEl = el('div', {
      'class': 'flyer-kid-card' + (isClosure ? ' closure' : ''),
      style: {
        border: borderWidth + ' solid ' + effectiveColor,
        borderRadius: borderRadius,
        backgroundColor: bgColor,
      },
    }, imageZone, centerZone, rightZone);

    return cardEl;
  }

  /**
   * Load all images referenced by current kid-mode cards into the in-memory cache.
   * Returns a Promise that resolves when all images are cached.
   */
  function loadImageCache() {
    const page = getActivePage();
    if (!page || !page.cards) return Promise.resolve();

    const idsToLoad = [];
    page.cards.forEach(function (card) {
      if (card.imageId && !imageCache[card.imageId]) idsToLoad.push(card.imageId);
      if (card.nameImageId && !imageCache[card.nameImageId]) idsToLoad.push(card.nameImageId);
    });

    if (idsToLoad.length === 0) return Promise.resolve();

    return Promise.all(idsToLoad.map(function (id) {
      return ImageStore.getImage(id).then(function (dataUrl) {
        if (dataUrl) imageCache[id] = dataUrl;
      });
    }));
  }

  function renderKidPreview() {
    const page = getActivePage();
    if (!page) return;

    const preview = document.getElementById('flyer-preview');
    if (!preview) return;

    const dims = getPageDimensions();
    const margin = getMarginPx();

    preview.style.width = dims.width + 'px';
    preview.style.height = dims.height + 'px';
    preview.style.position = 'relative';
    preview.style.overflow = 'hidden';
    preview.innerHTML = '';

    const contentWrapper = el('div', {
      style: {
        position: 'absolute',
        top: margin + 'px',
        left: margin + 'px',
        right: margin + 'px',
        bottom: margin + 'px',
        display: 'flex',
        flexDirection: 'column',
      },
    });

    // Header (reuse same header renderer)
    const headerEl = renderFlyerHeader(page.header, page.styles);
    contentWrapper.appendChild(headerEl);

    // Cards container — flex-grow to fill available space
    const gap = (page.styles.cardGap || 4) + 'px';
    const cardsContainer = el('div', {
      'data-branches-container': 'true',
      style: {
        flex: '1',
        minHeight: '0',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: gap,
      },
    });

    if (page.cards && page.cards.length > 0) {
      page.cards.forEach(function (card) {
        const cardEl = renderKidCard(card, page.styles, page);
        if (cardEl) {
          cardsContainer.appendChild(cardEl);
        }
      });
    }

    contentWrapper.appendChild(cardsContainer);

    // Footer (reuse same footer renderer)
    const footerEl = renderFooter(page.footer);
    contentWrapper.appendChild(footerEl);

    preview.appendChild(contentWrapper);

    // Apply zoom
    const container = document.getElementById('preview-container');
    if (container) {
      container.style.transform = 'scale(' + zoomLevel + ')';
    }

    // Check overflow after layout settles
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        checkOverflow();
      });
    });
  }

  function renderKidPreviewInto(container, page) {
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
        display: 'flex',
        flexDirection: 'column',
      },
    });

    const headerEl = renderFlyerHeader(page.header, page.styles);
    contentWrapper.appendChild(headerEl);

    const gap = (page.styles.cardGap || 4) + 'px';
    const cardsContainer = el('div', {
      style: {
        flex: '1',
        minHeight: '0',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: gap,
      },
    });

    if (page.cards && page.cards.length > 0) {
      page.cards.forEach(function (card) {
        const cardEl = renderKidCard(card, page.styles, page);
        if (cardEl) {
          cardsContainer.appendChild(cardEl);
        }
      });
    }

    contentWrapper.appendChild(cardsContainer);

    const footerEl = renderFooter(page.footer);
    contentWrapper.appendChild(footerEl);

    container.appendChild(contentWrapper);
  }

  // ── Check Overflow ─────────────────────────────────────────────
  function checkOverflow() {
    const preview = document.getElementById('flyer-preview');
    const warning = document.getElementById('overflow-warning');
    if (!preview || !warning) return;

    // Check if branches are severely overlapping (enough to obscure program text)
    const overlapThreshold = 20; // px — roughly one line of program text
    const branchesContainer = preview.querySelector('[data-branches-container]');
    let isOverflow = false;
    if (branchesContainer) {
      let totalChildHeight = 0;
      const children = branchesContainer.children;
      for (let i = 0; i < children.length; i++) {
        totalChildHeight += children[i].scrollHeight;
      }
      isOverflow = totalChildHeight > branchesContainer.clientHeight + overlapThreshold;
    } else {
      isOverflow = preview.scrollHeight > getPageDimensions().height;
    }

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
    if (meta.mode === 'kid') {
      loadImageCache().then(function () {
        renderKidPreview();
      });
      return;
    }

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

    // Content wrapper (within margins) — flex column to distribute space
    const contentWrapper = el('div', {
      style: {
        position: 'absolute',
        top: margin + 'px',
        left: margin + 'px',
        right: margin + 'px',
        bottom: margin + 'px',
        display: 'flex',
        flexDirection: 'column',
      },
    });

    // Header
    const headerEl = renderFlyerHeader(page.header, page.styles);
    contentWrapper.appendChild(headerEl);

    // Branches container — flex-grow to fill available space, distribute gaps evenly
    const branchesContainer = el('div', {
      'data-branches-container': 'true',
      style: {
        flex: '1',
        minHeight: '0',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      },
    });

    if (page.branches && page.branches.length > 0) {
      page.branches.forEach(function (branch) {
        const branchEl = renderBranch(branch, page.styles);
        if (branchEl) {
          branchesContainer.appendChild(branchEl);
        }
      });
    }

    contentWrapper.appendChild(branchesContainer);

    // Footer
    const footerEl = renderFooter(page.footer);
    contentWrapper.appendChild(footerEl);

    preview.appendChild(contentWrapper);

    // Apply zoom
    const container = document.getElementById('preview-container');
    if (container) {
      container.style.transform = 'scale(' + zoomLevel + ')';
    }

    // Auto-size vertical text and check overflow after layout is fully resolved.
    // Double rAF ensures the browser has completed at least one layout pass
    // (absolute-positioned strips need the parent's height from content first).
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        autoSizeVerticalText(preview);
        checkOverflow();
      });
    });
  }

  // ── Render into arbitrary container (for PDF export) ─────────
  function renderPreviewInto(container, page) {
    if (meta.mode === 'kid') {
      renderKidPreviewInto(container, page);
      return;
    }

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
        display: 'flex',
        flexDirection: 'column',
      },
    });

    const headerEl = renderFlyerHeader(page.header, page.styles);
    contentWrapper.appendChild(headerEl);

    const branchesContainer = el('div', {
      style: {
        flex: '1',
        minHeight: '0',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      },
    });

    if (page.branches && page.branches.length > 0) {
      page.branches.forEach(function (branch) {
        const branchEl = renderBranch(branch, page.styles);
        if (branchEl) {
          branchesContainer.appendChild(branchEl);
        }
      });
    }

    contentWrapper.appendChild(branchesContainer);

    const footerEl = renderFooter(page.footer);
    contentWrapper.appendChild(footerEl);

    container.appendChild(contentWrapper);
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

    // Free-text fields
    const freeTextField = el('div', {
      'class': 'freetext-field',
      style: { display: isFreeText ? 'block' : 'none' },
    });

    const ftTextGroup = el('div', { 'class': 'form-group' },
      el('label', { text: 'Free Text' }),
      el('textarea', {
        'class': 'input-freetext',
        'rows': '3',
        text: program.freeTextOverride || '',
      })
    );
    freeTextField.appendChild(ftTextGroup);

    const ftOptionsRow = el('div', { 'class': 'form-row' });

    const ftSizeGroup = el('div', { 'class': 'form-group' });
    ftSizeGroup.appendChild(el('label', { text: 'Font Size (pt)' }));
    const ftSizeInput = el('input', {
      type: 'number',
      'class': 'input-freetext-size',
      value: String(program.freeTextFontSize || 12),
      min: '6',
      max: '36',
    });
    ftSizeGroup.appendChild(ftSizeInput);
    ftOptionsRow.appendChild(ftSizeGroup);

    const ftAlignGroup = el('div', { 'class': 'form-group' });
    ftAlignGroup.appendChild(el('label', { text: 'Alignment' }));
    const ftAlignSelect = el('select', { 'class': 'input-freetext-align' });
    ['left', 'center', 'right'].forEach(function (val) {
      const opt = el('option', { value: val, text: val.charAt(0).toUpperCase() + val.slice(1) });
      if (val === (program.freeTextAlign || 'left')) opt.selected = true;
      ftAlignSelect.appendChild(opt);
    });
    ftAlignGroup.appendChild(ftAlignSelect);
    ftOptionsRow.appendChild(ftAlignGroup);

    freeTextField.appendChild(ftOptionsRow);

    // Bold / Italic / Closure toggles for free text
    const ftStyleGroup = el('div', { 'class': 'form-group' },
      el('label', { text: 'Style' }),
      el('div', { 'class': 'checkbox-group' },
        el('label', { 'class': 'checkbox-label' },
          el('input', { 'type': 'checkbox', 'class': 'input-freetext-bold' }),
          'Bold'
        ),
        el('label', { 'class': 'checkbox-label' },
          el('input', { 'type': 'checkbox', 'class': 'input-freetext-italic' }),
          'Italic'
        ),
        el('label', { 'class': 'checkbox-label' },
          el('input', { 'type': 'checkbox', 'class': 'input-freetext-closure' }),
          'Closure (colored row)'
        )
      )
    );
    const ftBoldCheckbox = ftStyleGroup.querySelector('.input-freetext-bold');
    const ftItalicCheckbox = ftStyleGroup.querySelector('.input-freetext-italic');
    const ftClosureCheckbox = ftStyleGroup.querySelector('.input-freetext-closure');
    ftBoldCheckbox.checked = !!program.freeTextBold;
    ftItalicCheckbox.checked = !!program.freeTextItalic;
    ftClosureCheckbox.checked = !!program.isClosure;

    // Color override for free text
    const ftColorOverrideCheck = el('input', { 'type': 'checkbox', 'class': 'input-freetext-color-override' });
    ftColorOverrideCheck.checked = !!program.colorOverride;
    const ftColorOverridePicker = el('input', {
      'type': 'color',
      'class': 'input-freetext-color-override-value',
      'value': program.colorOverride || lastColorOverride,
      style: {
        width: '50px',
        height: '20px',
        padding: '0',
        border: '1px solid #ddd',
        borderRadius: '3px',
        cursor: 'pointer',
        marginLeft: '6px',
        display: program.colorOverride ? 'inline-block' : 'none',
        verticalAlign: 'middle',
      },
    });
    ftColorOverrideCheck.addEventListener('change', function () {
      ftColorOverridePicker.style.display = ftColorOverrideCheck.checked ? 'inline-block' : 'none';
    });
    const ftColorOverrideLabel = el('label', { 'class': 'checkbox-label' },
      ftColorOverrideCheck,
      'Color override'
    );
    ftColorOverrideLabel.appendChild(ftColorOverridePicker);
    ftStyleGroup.querySelector('.checkbox-group').appendChild(ftColorOverrideLabel);

    freeTextField.appendChild(ftStyleGroup);

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
    const subtitleInlineCheck = el('input', {
      'type': 'checkbox',
      'class': 'input-subtitle-inline',
    });
    subtitleInlineCheck.checked = !!program.subtitleInline;
    const subtitleGroup = el('div', { 'class': 'form-group' },
      el('label', { text: 'Subtitle' }),
      el('input', {
        'type': 'text',
        'class': 'input-subtitle',
        'value': program.subtitle || '',
      }),
      el('div', { 'class': 'checkbox-group', style: { marginTop: '4px' } },
        el('label', { 'class': 'checkbox-label' },
          subtitleInlineCheck,
          'Append to program name'
        )
      )
    );
    structuredFields.appendChild(subtitleGroup);

    // Date + Time row
    const dateInput = el('textarea', {
      'class': 'input-date',
      'rows': '2',
      style: { resize: 'none' },
    });
    dateInput.value = program.dateText || '';

    const timeInput = el('textarea', {
      'class': 'input-time',
      'rows': '2',
      style: { resize: 'none' },
    });
    timeInput.value = program.timeText || '';

    const dateNoteInput = el('textarea', {
      'class': 'input-date-note',
      'rows': '2',
      'placeholder': 'e.g. (Repeats Weekly)',
      style: { resize: 'none' },
    });
    dateNoteInput.value = program.dateNote || '';

    const dateTimeRow = el('div', { 'class': 'form-row' },
      el('div', { 'class': 'form-group' },
        el('label', { text: 'Date' }),
        dateInput,
        el('label', { text: 'Date Note (appended)', style: { marginTop: '4px' } }),
        dateNoteInput
      ),
      el('div', { 'class': 'form-group' },
        el('label', { text: 'Time' }),
        timeInput
      )
    );
    structuredFields.appendChild(dateTimeRow);

    // Checkbox: Closure
    const checkboxGroup = el('div', { 'class': 'form-group' },
      el('label', { text: 'Options' }),
      el('div', { 'class': 'checkbox-group' },
        el('label', { 'class': 'checkbox-label' },
          el('input', { 'type': 'checkbox', 'class': 'input-closure' }),
          'Closure (colored row)'
        )
      )
    );

    const closCheckbox = checkboxGroup.querySelector('.input-closure');
    closCheckbox.checked = !!program.isClosure;

    // Color override checkbox + picker
    const colorOverrideCheck = el('input', { 'type': 'checkbox', 'class': 'input-color-override' });
    colorOverrideCheck.checked = !!program.colorOverride;
    const colorOverridePicker = el('input', {
      'type': 'color',
      'class': 'input-color-override-value',
      'value': program.colorOverride || lastColorOverride,
      style: {
        width: '50px',
        height: '20px',
        padding: '0',
        border: '1px solid #ddd',
        borderRadius: '3px',
        cursor: 'pointer',
        marginLeft: '6px',
        display: program.colorOverride ? 'inline-block' : 'none',
        verticalAlign: 'middle',
      },
    });
    colorOverrideCheck.addEventListener('change', function () {
      colorOverridePicker.style.display = colorOverrideCheck.checked ? 'inline-block' : 'none';
    });
    const colorOverrideLabel = el('label', { 'class': 'checkbox-label' },
      colorOverrideCheck,
      'Color override'
    );
    colorOverrideLabel.appendChild(colorOverridePicker);
    checkboxGroup.querySelector('.checkbox-group').appendChild(colorOverrideLabel);

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
      const ftSize = form.querySelector('.input-freetext-size');
      program.freeTextFontSize = ftSize && ftSize.value ? parseInt(ftSize.value, 10) : 12;
      const ftAlign = form.querySelector('.input-freetext-align');
      program.freeTextAlign = ftAlign ? ftAlign.value : 'left';
      program.freeTextBold = !!form.querySelector('.input-freetext-bold').checked;
      program.freeTextItalic = !!form.querySelector('.input-freetext-italic').checked;
      program.isClosure = !!form.querySelector('.input-freetext-closure').checked;
      const ftColorOverride = form.querySelector('.input-freetext-color-override');
      program.colorOverride = ftColorOverride && ftColorOverride.checked
        ? form.querySelector('.input-freetext-color-override-value').value
        : null;
    } else {
      program.freeTextOverride = null;
      program.name = form.querySelector('.input-name').value;
      program.subtitle = form.querySelector('.input-subtitle').value;
      program.subtitleInline = !!form.querySelector('.input-subtitle-inline').checked;
      program.dateText = form.querySelector('.input-date').value;
      program.dateNote = form.querySelector('.input-date-note').value;
      program.timeText = form.querySelector('.input-time').value;
      program.isClosure = form.querySelector('.input-closure').checked;
      const colorOverrideChecked = form.querySelector('.input-color-override').checked;
      program.colorOverride = colorOverrideChecked
        ? form.querySelector('.input-color-override-value').value
        : null;
    }

    if (program.colorOverride) {
      lastColorOverride = program.colorOverride;
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
      const json = serializeAll();
      localStorage.setItem(CONFIG.STORAGE_KEY, json);
    } catch (_e) {
      // Silently fail if localStorage is unavailable
    }
  }

  // ── Build Full State Object ────────────────────────────────────
  function buildFullState() {
    const page = getActivePage();
    const state = {
      schema: CONFIG.SCHEMA_VERSION,
      savedAt: null,
      meta: FlyerUtils.deepClone(meta),
      fontRoles: FlyerUtils.deepClone(fontRoles),
      header: page ? FlyerUtils.deepClone(page.header) : FlyerUtils.deepClone(CONFIG.DEFAULT_HEADER),
      footer: page ? FlyerUtils.deepClone(page.footer) : FlyerUtils.deepClone(CONFIG.DEFAULT_FOOTER),
      styles: page ? FlyerUtils.deepClone(page.styles) : FlyerUtils.deepClone(CONFIG.DEFAULT_STYLES),
    };
    if (meta.mode === 'kid') {
      state.cards = page ? FlyerUtils.deepClone(page.cards) : [];
    } else {
      state.branches = page ? FlyerUtils.deepClone(page.branches) : [];
    }
    return state;
  }

  // ── Render: Branch List (Sidebar Programs Tab) ─────────────────
  function renderBranchList() {
    if (meta.mode === 'kid') {
      renderCardList();
      return;
    }

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

    // Branch body
    const body = el('div', { 'class': 'branch-body' });

    // Branch detail fields (name, address, color) — toggleable compact/edit
    const branchDetails = el('div', { 'class': 'branch-details' });

    if (editingBranchDetailsId === branch.id) {
      // ── Edit mode ──
      const nameRow = el('div', { 'class': 'form-row' });
      const nameGroup = el('div', { 'class': 'form-group', style: { flex: '1' } });
      nameGroup.appendChild(el('label', { text: 'Name' }));
      const nameInput = el('input', {
        type: 'text',
        value: branch.name || '',
        'on': {
          'input': function () {
            branch.name = nameInput.value;
            nameDisplay.textContent = nameInput.value || 'Untitled';
            nameDisplay.style.color = branch.color || '#666666';
            markDirty();
            debouncedRenderPreview();
          },
        },
      });
      nameGroup.appendChild(nameInput);
      nameRow.appendChild(nameGroup);

      const colorGroup = el('div', { 'class': 'form-group', style: { width: '40px', flexShrink: '0' } });
      colorGroup.appendChild(el('label', { text: 'Color' }));
      const colorInput = el('input', {
        type: 'color',
        value: branch.color || '#666666',
        'on': {
          'input': function () {
            branch.color = colorInput.value;
            nameDisplay.style.color = colorInput.value;
            markDirty();
            debouncedRenderPreview();
          },
        },
      });
      colorGroup.appendChild(colorInput);
      nameRow.appendChild(colorGroup);
      branchDetails.appendChild(nameRow);

      // Default color swatches
      const swatchGroup = el('div', { 'class': 'form-group', style: { marginBottom: '0' } });
      swatchGroup.appendChild(el('label', { text: 'Default Colors' }));
      const defaultColors = [];
      CONFIG.BRANCH_DEFAULTS.forEach(function (b) {
        if (defaultColors.indexOf(b.color) === -1) defaultColors.push(b.color);
      });
      const swatchRow = el('div', { style: { display: 'flex', gap: '8px', margin: '0 0 8px' } });
      defaultColors.forEach(function (c) {
        const swatch = el('div', {
          style: {
            flex: '1', height: '20px', borderRadius: '3px', maxWidth: '60px',
            backgroundColor: c, cursor: 'pointer',
            border: branch.color === c ? '2px solid #333' : '2px solid transparent',
          },
          title: c,
          'on': {
            'click': function () {
              branch.color = c;
              colorInput.value = c;
              nameDisplay.style.color = c;
              markDirty();
              debouncedRenderPreview();
              renderBranchList();
            },
          },
        });
        swatchRow.appendChild(swatch);
      });
      swatchGroup.appendChild(swatchRow);
      branchDetails.appendChild(swatchGroup);

      const addressGroup = el('div', { 'class': 'form-group' });
      addressGroup.appendChild(el('label', { text: 'Address (use Enter for two lines)' }));
      const addressInput = el('textarea', {
        rows: '2',
        placeholder: 'e.g. 123 Main St · City, ST 12345',
        style: { resize: 'none' },
        'on': {
          'input': function () {
            branch.address = addressInput.value;
            markDirty();
            debouncedRenderPreview();
          },
        },
      });
      addressInput.value = branch.address || '';
      addressGroup.appendChild(addressInput);
      branchDetails.appendChild(addressGroup);

      // Done button
      const doneBtn = el('button', {
        'class': 'btn btn-sm btn-outline',
        html: '<i class="fas fa-check"></i> Done',
        'on': {
          'click': function () {
            editingBranchDetailsId = null;
            renderBranchList();
          },
        },
      });
      branchDetails.appendChild(doneBtn);
    } else {
      // ── Compact mode ──
      const summary = el('div', {
        'class': 'branch-details-summary',
        'on': {
          'click': function () {
            editingBranchDetailsId = branch.id;
            renderBranchList();
          },
        },
      });

      const colorSwatch = el('span', {
        'class': 'branch-color-swatch',
        style: { backgroundColor: color },
      });
      summary.appendChild(colorSwatch);

      const summaryText = el('span', {
        'class': 'branch-details-text',
        text: (branch.name || 'Untitled') + (branch.address ? ' · ' + branch.address.replace(/\n/g, ', ') : ''),
      });
      summary.appendChild(summaryText);

      const editIcon = el('span', {
        'class': 'branch-details-edit-icon',
        html: '<i class="fas fa-pen"></i>',
      });
      summary.appendChild(editIcon);

      branchDetails.appendChild(summary);
    }

    body.appendChild(branchDetails);

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

    // Add program button (below program list)
    const addProgramBtn = el('button', {
      'class': 'btn btn-sm btn-outline btn-full',
      html: '<i class="fas fa-plus"></i> Add Program',
      style: { marginTop: '6px' },
      'on': {
        'click': function () {
          addProgramToBranch(branch.id);
        },
      },
    });
    body.appendChild(addProgramBtn);

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


  // ══════════════════════════════════════════════════════════════
  //  KID MODE SIDEBAR
  // ══════════════════════════════════════════════════════════════

  let kidCardSortableInstance = null;
  let editingCardId = null;

  function renderCardList() {
    const container = document.getElementById('kid-card-list');
    if (!container) return;

    const page = getActivePage();
    if (!page || !page.cards) {
      container.innerHTML = '<p style="color:#999;text-align:center;padding:20px;">No page loaded.</p>';
      return;
    }

    // Clean up old sortable
    if (kidCardSortableInstance) {
      kidCardSortableInstance.destroy();
      kidCardSortableInstance = null;
    }

    container.innerHTML = '';

    page.cards.forEach(function (card) {
      if (editingCardId === card.id) {
        const formEl = renderCardEditForm(card);
        container.appendChild(formEl);
      } else {
        const item = renderKidSidebarCard(card);
        container.appendChild(item);
      }
    });

    // Initialize sortable
    if (typeof Sortable !== 'undefined') {
      kidCardSortableInstance = Sortable.create(container, {
        handle: '.program-drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        onEnd: function (evt) {
          const pg = getActivePage();
          if (!pg || !pg.cards) return;
          const oldIndex = evt.oldIndex;
          const newIndex = evt.newIndex;
          if (oldIndex === newIndex) return;
          const moved = pg.cards.splice(oldIndex, 1)[0];
          pg.cards.splice(newIndex, 0, moved);
          isDirty = true;
          debouncedRenderPreview();
          scheduleAutosave();
        },
      });
    }
  }

  function renderKidSidebarCard(card) {
    const color = card.colorOverride || card.branchColor || '#0474bf';
    let displayName = card.freeTextOverride
      ? card.freeTextOverride.substring(0, 40) + (card.freeTextOverride.length > 40 ? '...' : '')
      : (card.name || '(untitled)');
    if (card.isClosure) displayName = '[CLOSURE] ' + displayName;

    const detailParts = [];
    if (card.branchName) detailParts.push(card.branchName);
    if (card.dateText) detailParts.push(card.dateText);

    const item = el('div', {
      'class': 'kid-card-item',
      'data-card-id': card.id,
    });

    const dragHandle = el('span', {
      'class': 'program-drag-handle',
      html: '<i class="fas fa-grip-vertical"></i>',
    });
    item.appendChild(dragHandle);

    const dot = el('span', {
      'class': 'branch-color-dot',
      style: { backgroundColor: color },
    });
    item.appendChild(dot);

    const info = el('div', { 'class': 'kid-card-info' });
    info.appendChild(el('div', { 'class': 'kid-card-info-name', text: displayName }));
    if (detailParts.length > 0) {
      info.appendChild(el('div', { 'class': 'kid-card-info-detail', text: detailParts.join(' | ') }));
    }
    item.appendChild(info);

    const actions = el('div', { 'class': 'kid-card-actions' });
    actions.appendChild(el('button', {
      title: 'Edit card',
      html: '<i class="fas fa-pen"></i>',
      on: { click: function () { editingCardId = card.id; renderCardList(); } },
    }));
    actions.appendChild(el('button', {
      'class': 'btn-delete',
      title: 'Delete card',
      html: '<i class="fas fa-trash"></i>',
      on: { click: function () { deleteKidCard(card.id); } },
    }));
    item.appendChild(actions);

    return item;
  }

  function renderCardEditForm(card) {
    const form = el('div', { 'class': 'program-edit-form', 'data-card-id': card.id });

    const isFreeText = !!card.freeTextOverride;

    // Toggle: structured vs free-text
    const freeTextToggle = el('div', { 'class': 'form-group' },
      el('label', { 'class': 'checkbox-label' },
        el('input', {
          type: 'checkbox',
          on: {
            change: function (e) {
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
    freeTextToggle.querySelector('input[type="checkbox"]').checked = isFreeText;
    form.appendChild(freeTextToggle);

    // Free-text fields
    const freeTextField = el('div', {
      'class': 'freetext-field',
      style: { display: isFreeText ? 'block' : 'none' },
    });
    freeTextField.appendChild(el('div', { 'class': 'form-group' },
      el('label', { text: 'Free Text' }),
      el('textarea', { 'class': 'input-freetext', rows: '3', text: card.freeTextOverride || '' })
    ));
    const ftOptionsRow = el('div', { 'class': 'form-row' });
    const ftSizeGroup = el('div', { 'class': 'form-group' });
    ftSizeGroup.appendChild(el('label', { text: 'Font Size (pt)' }));
    ftSizeGroup.appendChild(el('input', {
      type: 'number', 'class': 'input-freetext-size',
      value: String(card.freeTextFontSize || 12), min: '6', max: '36',
    }));
    ftOptionsRow.appendChild(ftSizeGroup);
    const ftAlignGroup = el('div', { 'class': 'form-group' });
    ftAlignGroup.appendChild(el('label', { text: 'Alignment' }));
    const ftAlignSelect = el('select', { 'class': 'input-freetext-align' });
    ['left', 'center', 'right'].forEach(function (val) {
      const opt = el('option', { value: val, text: val.charAt(0).toUpperCase() + val.slice(1) });
      if (val === (card.freeTextAlign || 'left')) opt.selected = true;
      ftAlignSelect.appendChild(opt);
    });
    ftAlignGroup.appendChild(ftAlignSelect);
    ftOptionsRow.appendChild(ftAlignGroup);
    freeTextField.appendChild(ftOptionsRow);

    const ftStyleGroup = el('div', { 'class': 'form-group' },
      el('label', { text: 'Style' }),
      el('div', { 'class': 'checkbox-group' },
        el('label', { 'class': 'checkbox-label' },
          el('input', { type: 'checkbox', 'class': 'input-freetext-bold' }), 'Bold'),
        el('label', { 'class': 'checkbox-label' },
          el('input', { type: 'checkbox', 'class': 'input-freetext-italic' }), 'Italic'),
        el('label', { 'class': 'checkbox-label' },
          el('input', { type: 'checkbox', 'class': 'input-freetext-closure' }), 'Closure (colored row)')
      )
    );
    ftStyleGroup.querySelector('.input-freetext-bold').checked = !!card.freeTextBold;
    ftStyleGroup.querySelector('.input-freetext-italic').checked = !!card.freeTextItalic;
    ftStyleGroup.querySelector('.input-freetext-closure').checked = !!card.isClosure;

    // Color override for free text
    const ftColorOverrideCheck = el('input', { type: 'checkbox', 'class': 'input-freetext-color-override' });
    ftColorOverrideCheck.checked = !!card.colorOverride;
    const ftColorOverridePicker = el('input', {
      type: 'color', 'class': 'input-freetext-color-override-value',
      value: card.colorOverride || lastColorOverride,
      style: { width: '50px', height: '20px', padding: '0', border: '1px solid #ddd',
        borderRadius: '3px', cursor: 'pointer', marginLeft: '6px',
        display: card.colorOverride ? 'inline-block' : 'none', verticalAlign: 'middle' },
    });
    ftColorOverrideCheck.addEventListener('change', function () {
      ftColorOverridePicker.style.display = ftColorOverrideCheck.checked ? 'inline-block' : 'none';
    });
    const ftColorLabel = el('label', { 'class': 'checkbox-label' }, ftColorOverrideCheck, 'Color override');
    ftColorLabel.appendChild(ftColorOverridePicker);
    ftStyleGroup.querySelector('.checkbox-group').appendChild(ftColorLabel);
    freeTextField.appendChild(ftStyleGroup);
    form.appendChild(freeTextField);

    // Structured fields
    const structuredFields = el('div', {
      'class': 'structured-fields',
      style: { display: isFreeText ? 'none' : 'block' },
    });

    // Branch dropdown (exclude Online, add Custom option)
    const branchGroup = el('div', { 'class': 'form-group' });
    branchGroup.appendChild(el('label', { text: 'Branch / Location' }));
    const branchSelect = el('select', { 'class': 'input-branch-select' });
    const isCustomBranch = !CONFIG.BRANCH_DEFAULTS.some(function (b) {
      return b.name !== 'Online' && b.name !== 'City Hall' && b.name === card.branchName;
    });
    CONFIG.BRANCH_DEFAULTS.forEach(function (b) {
      if (b.name === 'Online' || b.name === 'City Hall') return; // skip in kid mode
      const opt = el('option', {
        value: b.name,
        text: b.name + (b.address ? ' — ' + b.address : ''),
        'data-address': b.address || '',
        'data-color': b.color,
      });
      if (!isCustomBranch && b.name === card.branchName) opt.selected = true;
      branchSelect.appendChild(opt);
    });
    const customOpt = el('option', { value: '__custom__', text: 'Custom...' });
    if (isCustomBranch) customOpt.selected = true;
    branchSelect.appendChild(customOpt);
    branchGroup.appendChild(branchSelect);

    // Custom branch fields (shown when "Custom..." is selected)
    const customBranchFields = el('div', {
      'class': 'custom-branch-fields',
      style: { display: isCustomBranch ? 'block' : 'none', marginTop: '6px' },
    });
    customBranchFields.appendChild(el('input', {
      type: 'text', 'class': 'input-custom-branch-name', placeholder: 'Location name',
      value: isCustomBranch ? (card.branchName || '') : '',
    }));
    customBranchFields.appendChild(el('input', {
      type: 'text', 'class': 'input-custom-branch-address', placeholder: 'Address',
      value: isCustomBranch ? (card.branchAddress || '') : '',
      style: { marginTop: '4px' },
    }));
    const customColorRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' } });
    customColorRow.appendChild(el('label', { text: 'Color:', style: { fontSize: '0.85em', margin: '0' } }));
    customColorRow.appendChild(el('input', {
      type: 'color', 'class': 'input-custom-branch-color',
      value: isCustomBranch ? (card.branchColor || '#666666') : '#666666',
      style: { width: '40px', height: '24px', padding: '0', border: '1px solid #ddd', borderRadius: '3px', cursor: 'pointer' },
    }));
    customBranchFields.appendChild(customColorRow);
    branchGroup.appendChild(customBranchFields);

    branchSelect.addEventListener('change', function () {
      customBranchFields.style.display = branchSelect.value === '__custom__' ? 'block' : 'none';
    });

    structuredFields.appendChild(branchGroup);

    // Card image upload
    const cardImageGroup = el('div', { 'class': 'form-group' });
    cardImageGroup.appendChild(el('label', { text: 'Card Image (left zone)' }));
    const cardImageUpload = el('div', { 'class': 'image-upload-group' });
    const cardImagePreview = el('div', { 'class': 'image-preview' });
    if (card.imageId && imageCache[card.imageId]) {
      cardImagePreview.appendChild(el('img', { src: imageCache[card.imageId], alt: '' }));
    } else {
      cardImagePreview.appendChild(el('i', { 'class': 'fas fa-image placeholder-icon' }));
    }
    cardImageUpload.appendChild(cardImagePreview);
    cardImageUpload.appendChild(el('button', {
      'class': 'btn btn-sm btn-outline',
      html: '<i class="fas fa-upload"></i> Upload',
      on: { click: function () { triggerImageUpload(card.id, 'image'); } },
    }));
    if (card.imageId) {
      cardImageUpload.appendChild(el('button', {
        'class': 'btn btn-sm btn-outline btn-delete',
        html: '<i class="fas fa-trash"></i>',
        on: { click: function () { removeCardImage(card.id, 'image'); } },
      }));
    }
    cardImageGroup.appendChild(cardImageUpload);
    cardImageGroup.appendChild(el('span', {
      'class': 'form-hint',
      text: 'Recommended: ~1125px wide at 600 DPI',
    }));
    structuredFields.appendChild(cardImageGroup);

    // Name
    structuredFields.appendChild(el('div', { 'class': 'form-group' },
      el('label', { text: 'Program Name' }),
      el('input', { type: 'text', 'class': 'input-name', value: card.name || '' })
    ));

    // Name image upload (replaces text name)
    const nameImageGroup = el('div', { 'class': 'form-group' });
    nameImageGroup.appendChild(el('label', { text: 'Name Image (replaces text name)' }));
    const nameImageUpload = el('div', { 'class': 'image-upload-group' });
    const nameImagePreview = el('div', { 'class': 'image-preview' });
    if (card.nameImageId && imageCache[card.nameImageId]) {
      nameImagePreview.appendChild(el('img', { src: imageCache[card.nameImageId], alt: '' }));
    } else {
      nameImagePreview.appendChild(el('i', { 'class': 'fas fa-heading placeholder-icon' }));
    }
    nameImageUpload.appendChild(nameImagePreview);
    nameImageUpload.appendChild(el('button', {
      'class': 'btn btn-sm btn-outline',
      html: '<i class="fas fa-upload"></i> Upload',
      on: { click: function () { triggerImageUpload(card.id, 'nameImage'); } },
    }));
    if (card.nameImageId) {
      nameImageUpload.appendChild(el('button', {
        'class': 'btn btn-sm btn-outline btn-delete',
        html: '<i class="fas fa-trash"></i>',
        on: { click: function () { removeCardImage(card.id, 'nameImage'); } },
      }));
    }
    nameImageGroup.appendChild(nameImageUpload);
    nameImageGroup.appendChild(el('span', {
      'class': 'form-hint',
      text: 'Recommended: ~2400px wide at 600 DPI',
    }));
    structuredFields.appendChild(nameImageGroup);

    // Subtitle (textarea for multi-line)
    const subtitleTextarea = el('textarea', {
      'class': 'input-subtitle',
      rows: '2',
      style: { resize: 'vertical' },
    });
    subtitleTextarea.value = card.subtitle || '';
    structuredFields.appendChild(el('div', { 'class': 'form-group' },
      el('label', { text: 'Subtitle' }),
      subtitleTextarea
    ));

    // Program Note
    const noteTextarea = el('textarea', {
      'class': 'input-note',
      rows: '2',
      style: { resize: 'vertical' },
    });
    noteTextarea.value = card.note || '';
    structuredFields.appendChild(el('div', { 'class': 'form-group' },
      el('label', { text: 'Program Note' }),
      noteTextarea
    ));

    // Date + Time
    const dateInput = el('textarea', { 'class': 'input-date', rows: '2', style: { resize: 'none' } });
    dateInput.value = card.dateText || '';
    const timeInput = el('textarea', { 'class': 'input-time', rows: '2', style: { resize: 'none' } });
    timeInput.value = card.timeText || '';
    structuredFields.appendChild(el('div', { 'class': 'form-row' },
      el('div', { 'class': 'form-group' }, el('label', { text: 'Date' }), dateInput),
      el('div', { 'class': 'form-group' }, el('label', { text: 'Time' }), timeInput)
    ));

    // Multi-location toggle
    const hasLocations = card.locations && card.locations.length > 0;
    const multiLocToggle = el('div', { 'class': 'form-group' },
      el('label', { 'class': 'checkbox-label' },
        el('input', { type: 'checkbox', 'class': 'input-multi-location' }),
        'Multiple locations'
      )
    );
    const multiLocCheck = multiLocToggle.querySelector('.input-multi-location');
    multiLocCheck.checked = hasLocations;
    structuredFields.appendChild(multiLocToggle);

    // Multi-location entries container
    const locationsContainer = el('div', {
      'class': 'locations-container',
      style: { display: hasLocations ? 'block' : 'none' },
    });

    function addLocationEntry(loc) {
      const entry = el('div', { 'class': 'location-entry' });
      const isLocCustom = loc && !CONFIG.BRANCH_DEFAULTS.some(function (b) {
        return b.name !== 'Online' && b.name !== 'City Hall' && b.name === loc.branchName;
      });

      // Row 1: branch select + remove button
      const branchRow = el('div', { 'class': 'location-entry-row' });
      const locSelect = el('select', { 'class': 'location-branch-select' });
      CONFIG.BRANCH_DEFAULTS.forEach(function (b) {
        if (b.name === 'Online' || b.name === 'City Hall') return; // skip in kid mode
        const opt = el('option', {
          value: b.name,
          text: b.name + (b.address ? ' — ' + b.address : ''),
          'data-address': b.address || '',
          'data-color': b.color,
        });
        if (!isLocCustom && loc && b.name === loc.branchName) opt.selected = true;
        locSelect.appendChild(opt);
      });
      const locCustomOpt = el('option', { value: '__custom__', text: 'Custom...' });
      if (isLocCustom) locCustomOpt.selected = true;
      locSelect.appendChild(locCustomOpt);
      branchRow.appendChild(locSelect);
      branchRow.appendChild(el('button', {
        'class': 'btn-remove-location',
        html: '<i class="fas fa-times"></i>',
        on: { click: function () { entry.remove(); } },
      }));
      entry.appendChild(branchRow);

      // Custom location fields
      const locCustomFields = el('div', {
        'class': 'location-custom-fields',
        style: { display: isLocCustom ? 'block' : 'none', marginTop: '6px' },
      });
      locCustomFields.appendChild(el('input', {
        type: 'text', 'class': 'location-custom-name', placeholder: 'Location name',
        value: isLocCustom ? (loc.branchName || '') : '',
      }));
      locCustomFields.appendChild(el('input', {
        type: 'text', 'class': 'location-custom-address', placeholder: 'Address',
        value: isLocCustom ? (loc.branchAddress || '') : '',
        style: { marginTop: '3px' },
      }));
      const locCustomColorRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px' } });
      locCustomColorRow.appendChild(el('label', { text: 'Color:', style: { fontSize: '0.85em', margin: '0' } }));
      locCustomColorRow.appendChild(el('input', {
        type: 'color', 'class': 'location-custom-color',
        value: isLocCustom ? (loc.branchColor || '#666666') : '#666666',
        style: { width: '36px', height: '22px', padding: '0', border: '1px solid #ddd', borderRadius: '3px', cursor: 'pointer' },
      }));
      locCustomFields.appendChild(locCustomColorRow);
      entry.appendChild(locCustomFields);

      locSelect.addEventListener('change', function () {
        locCustomFields.style.display = locSelect.value === '__custom__' ? 'block' : 'none';
      });

      // Row 2: day + time inputs
      const dateTimeRow = el('div', { 'class': 'location-entry-row', style: { marginTop: '6px' } });
      dateTimeRow.appendChild(el('input', {
        type: 'text',
        'class': 'location-day-input',
        placeholder: 'Date (e.g. Wednesdays)',
        value: (loc && loc.dayText) || '',
      }));
      dateTimeRow.appendChild(el('input', {
        type: 'text',
        'class': 'location-time-input',
        placeholder: 'Time (e.g. 3:00 PM)',
        value: (loc && loc.timeText) || '',
      }));
      entry.appendChild(dateTimeRow);

      locationsContainer.appendChild(entry);
    }

    if (hasLocations) {
      card.locations.forEach(function (loc) {
        addLocationEntry(loc);
      });
    }

    const addLocBtn = el('button', {
      'class': 'btn btn-sm btn-outline',
      html: '<i class="fas fa-plus"></i> Add Location',
      style: { marginTop: '4px' },
      on: { click: function () { addLocationEntry(null); } },
    });
    locationsContainer.appendChild(addLocBtn);
    structuredFields.appendChild(locationsContainer);

    multiLocCheck.addEventListener('change', function () {
      locationsContainer.style.display = multiLocCheck.checked ? 'block' : 'none';
      if (multiLocCheck.checked && locationsContainer.querySelectorAll('.location-entry').length === 0) {
        addLocationEntry(null);
      }
    });

    // Options: Closure + Color override
    const checkboxGroup = el('div', { 'class': 'form-group' },
      el('label', { text: 'Options' }),
      el('div', { 'class': 'checkbox-group' },
        el('label', { 'class': 'checkbox-label' },
          el('input', { type: 'checkbox', 'class': 'input-closure' }), 'Closure (colored row)')
      )
    );
    checkboxGroup.querySelector('.input-closure').checked = !!card.isClosure;

    const colorOverrideCheck = el('input', { type: 'checkbox', 'class': 'input-color-override' });
    colorOverrideCheck.checked = !!card.colorOverride;
    const colorOverridePicker = el('input', {
      type: 'color', 'class': 'input-color-override-value',
      value: card.colorOverride || lastColorOverride,
      style: { width: '50px', height: '20px', padding: '0', border: '1px solid #ddd',
        borderRadius: '3px', cursor: 'pointer', marginLeft: '6px',
        display: card.colorOverride ? 'inline-block' : 'none', verticalAlign: 'middle' },
    });
    colorOverrideCheck.addEventListener('change', function () {
      colorOverridePicker.style.display = colorOverrideCheck.checked ? 'inline-block' : 'none';
    });
    const colorLabel = el('label', { 'class': 'checkbox-label' }, colorOverrideCheck, 'Color override');
    colorLabel.appendChild(colorOverridePicker);
    checkboxGroup.querySelector('.checkbox-group').appendChild(colorLabel);
    structuredFields.appendChild(checkboxGroup);

    form.appendChild(structuredFields);

    // Action buttons
    form.appendChild(el('div', { 'class': 'form-actions' },
      el('button', {
        'class': 'btn btn-sm btn-outline',
        html: '<i class="fas fa-times"></i> Cancel',
        on: { click: function () { editingCardId = null; renderCardList(); } },
      }),
      el('button', {
        'class': 'btn btn-sm btn-success',
        html: '<i class="fas fa-check"></i> Save',
        on: { click: function () { saveCardForm(form, card.id); } },
      })
    ));

    return form;
  }

  // Track which card/field is waiting for an image upload
  let pendingImageUpload = { cardId: null, field: null };

  function triggerImageUpload(cardId, field) {
    pendingImageUpload = { cardId: cardId, field: field };
    const inputId = field === 'nameImage' ? 'card-name-image-upload' : 'card-image-upload';
    document.getElementById(inputId).click();
  }

  function handleCardImageUpload(event, field) {
    const file = event.target.files[0];
    if (!file || !pendingImageUpload.cardId) return;

    const reader = new FileReader();
    reader.onload = function (e) {
      const dataUrl = e.target.result;
      const imageId = FlyerUtils.generateId();
      const cardId = pendingImageUpload.cardId;

      ImageStore.saveImage(imageId, dataUrl).then(function () {
        imageCache[imageId] = dataUrl;

        // Find the card and set the image
        const page = getActivePage();
        if (page && page.cards) {
          for (let i = 0; i < page.cards.length; i++) {
            if (page.cards[i].id === cardId) {
              if (field === 'nameImage') {
                page.cards[i].nameImageId = imageId;
              } else {
                page.cards[i].imageId = imageId;
              }
              break;
            }
          }
        }

        markDirty();
        renderCardList();
        debouncedRenderPreview();
      });
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  function removeCardImage(cardId, field) {
    const page = getActivePage();
    if (!page || !page.cards) return;

    for (let i = 0; i < page.cards.length; i++) {
      if (page.cards[i].id === cardId) {
        const key = field === 'nameImage' ? 'nameImageId' : 'imageId';
        const oldId = page.cards[i][key];
        if (oldId) {
          ImageStore.deleteImage(oldId);
          delete imageCache[oldId];
        }
        page.cards[i][key] = null;
        break;
      }
    }

    markDirty();
    renderCardList();
    debouncedRenderPreview();
  }

  function saveCardForm(form, cardId) {
    const page = getActivePage();
    if (!page || !page.cards) return;

    let card = null;
    for (let i = 0; i < page.cards.length; i++) {
      if (page.cards[i].id === cardId) { card = page.cards[i]; break; }
    }
    if (!card) return;

    const freeTextChecked = form.querySelector('.freetext-field').style.display !== 'none';

    if (freeTextChecked) {
      card.freeTextOverride = form.querySelector('.input-freetext').value || null;
      const ftSize = form.querySelector('.input-freetext-size');
      card.freeTextFontSize = ftSize && ftSize.value ? parseInt(ftSize.value, 10) : 12;
      const ftAlign = form.querySelector('.input-freetext-align');
      card.freeTextAlign = ftAlign ? ftAlign.value : 'left';
      card.freeTextBold = !!form.querySelector('.input-freetext-bold').checked;
      card.freeTextItalic = !!form.querySelector('.input-freetext-italic').checked;
      card.isClosure = !!form.querySelector('.input-freetext-closure').checked;
      const ftColorOverride = form.querySelector('.input-freetext-color-override');
      card.colorOverride = ftColorOverride && ftColorOverride.checked
        ? form.querySelector('.input-freetext-color-override-value').value : null;
    } else {
      card.freeTextOverride = null;
      card.name = form.querySelector('.input-name').value;
      card.subtitle = form.querySelector('.input-subtitle').value;
      card.note = form.querySelector('.input-note') ? form.querySelector('.input-note').value : '';
      card.dateText = form.querySelector('.input-date').value;
      card.timeText = form.querySelector('.input-time').value;
      card.isClosure = form.querySelector('.input-closure').checked;

      // Branch selection
      const branchSelect = form.querySelector('.input-branch-select');
      if (branchSelect) {
        if (branchSelect.value === '__custom__') {
          card.branchName = form.querySelector('.input-custom-branch-name').value || 'Custom';
          card.branchAddress = form.querySelector('.input-custom-branch-address').value || '';
          card.branchColor = form.querySelector('.input-custom-branch-color').value || '#666666';
          card.branchId = card.branchName;
        } else {
          const selectedOpt = branchSelect.options[branchSelect.selectedIndex];
          card.branchName = branchSelect.value;
          card.branchAddress = selectedOpt.getAttribute('data-address') || '';
          card.branchColor = selectedOpt.getAttribute('data-color') || '#0474bf';
          card.branchId = branchSelect.value;
        }
      }

      const colorOverrideChecked = form.querySelector('.input-color-override').checked;
      card.colorOverride = colorOverrideChecked
        ? form.querySelector('.input-color-override-value').value : null;

      // Multi-location
      const multiLocChecked = form.querySelector('.input-multi-location');
      if (multiLocChecked && multiLocChecked.checked) {
        const locEntries = form.querySelectorAll('.location-entry');
        card.locations = [];
        locEntries.forEach(function (entry) {
          const locSelect = entry.querySelector('.location-branch-select');
          const dayInput = entry.querySelector('.location-day-input');
          const timeInput = entry.querySelector('.location-time-input');
          if (locSelect) {
            let locData;
            if (locSelect.value === '__custom__') {
              locData = {
                branchName: entry.querySelector('.location-custom-name').value || 'Custom',
                branchAddress: entry.querySelector('.location-custom-address').value || '',
                branchColor: entry.querySelector('.location-custom-color').value || '#666666',
                dayText: dayInput ? dayInput.value : '',
                timeText: timeInput ? timeInput.value : '',
              };
            } else {
              const selOpt = locSelect.options[locSelect.selectedIndex];
              locData = {
                branchName: locSelect.value,
                branchAddress: selOpt.getAttribute('data-address') || '',
                branchColor: selOpt.getAttribute('data-color') || '#0474bf',
                dayText: dayInput ? dayInput.value : '',
                timeText: timeInput ? timeInput.value : '',
              };
            }
            card.locations.push(locData);
          }
        });
      } else {
        card.locations = [];
      }
    }

    if (card.colorOverride) {
      lastColorOverride = card.colorOverride;
    }

    editingCardId = null;
    isDirty = true;
    renderCardList();
    debouncedRenderPreview();
    scheduleAutosave();
  }

  function addKidCard() {
    const page = getActivePage();
    if (!page || !page.cards) return;
    const newCard = FlyerUtils.createBlankCard();
    page.cards.push(newCard);
    editingCardId = newCard.id;
    isDirty = true;
    renderCardList();
    debouncedRenderPreview();
    scheduleAutosave();
  }

  function deleteKidCard(cardId) {
    const page = getActivePage();
    if (!page || !page.cards) return;
    page.cards = page.cards.filter(function (c) { return c.id !== cardId; });
    if (editingCardId === cardId) editingCardId = null;
    isDirty = true;
    renderCardList();
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

  function applyModeUI() {
    const isKid = meta.mode === 'kid';
    document.body.classList.toggle('mode-kid', isKid);

    // Toggle sidebar program containers
    const standardContainer = document.getElementById('standard-programs-container');
    const kidContainer = document.getElementById('kid-programs-container');
    if (standardContainer) standardContainer.style.display = isKid ? 'none' : '';
    if (kidContainer) kidContainer.style.display = isKid ? '' : 'none';

    // Lock page size to letter in kid mode
    const pageSizeGroup = document.getElementById('page-size-group');
    if (pageSizeGroup) pageSizeGroup.style.display = isKid ? 'none' : '';
    if (isKid) meta.pageSize = 'letter';

    // Mode toggle buttons
    const modeBtns = document.querySelectorAll('[data-flyer-mode]');
    modeBtns.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-flyer-mode') === meta.mode);
    });
  }

  function bindSettings() {
    // ── Mode Toggle ──────────────────────────────────
    const modeBtns = document.querySelectorAll('[data-flyer-mode]');
    modeBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const newMode = btn.getAttribute('data-flyer-mode');
        if (newMode === meta.mode) return;

        meta.mode = newMode;

        // Re-initialize pages for the new mode
        if (newMode === 'kid') {
          const kidPage = FlyerUtils.createDefaultKidPage();
          // Carry over footer language from current page
          const currentPage = getCurrentPage();
          if (currentPage) {
            kidPage.footer = FlyerUtils.deepClone(currentPage.footer);
            kidPage.header.monthText = currentPage.header.monthText;
            kidPage.header.titleColor = currentPage.header.titleColor;
            kidPage.header.monthColor = currentPage.header.monthColor;
          }
          // Set kid header title based on footer language
          const footerSource = kidPage.footer.source;
          const kidLangKey = footerSource === 'default-spanish' ? 'kid-spanish' : 'kid-english';
          const kidTitle = CONFIG.HEADER_TITLE_BY_LANGUAGE[kidLangKey];
          if (kidTitle) {
            kidPage.header.titleText = kidTitle.text;
            kidPage.styles.headerTitleFontSize = kidTitle.fontSize;
            kidPage.styles.headerMonthFontSize = kidTitle.fontSize;
          }
          pages = [kidPage];
          activePage = 0;
        } else {
          const defaultFlyer = FlyerUtils.createDefaultFlyer();
          pages = [{
            header: defaultFlyer.header,
            branches: defaultFlyer.branches,
            footer: defaultFlyer.footer,
            styles: defaultFlyer.styles,
          }];
          activePage = 0;
        }

        applyModeUI();
        markDirty();
        syncSettingsFromPage();
        renderPageList();
        renderBranchList();
        renderPreview();
      });
    });

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

    // ── Header Text / Color / Size ────────────────────
    const headerMonthText = document.getElementById('header-month-text');
    const headerTitleColor = document.getElementById('header-title-color');
    const headerMonthColor = document.getElementById('header-month-color');
    const headerTitleSize = document.getElementById('header-title-size');

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
      const size = parseInt(headerTitleSize.value, 10) || 28;
      getCurrentPage().styles.headerTitleFontSize = size;
      getCurrentPage().styles.headerMonthFontSize = size;
      markDirty();
      debouncedRenderPreview();
    });

    const stripFilledToggle = document.getElementById('header-strip-filled');
    stripFilledToggle.addEventListener('change', function () {
      getCurrentPage().styles.stripFilled = stripFilledToggle.checked;
      markDirty();
      debouncedRenderPreview();
    });

    const branchBordersToggle = document.getElementById('style-branch-borders');
    branchBordersToggle.addEventListener('change', function () {
      getCurrentPage().styles.branchBorders = branchBordersToggle.checked;
      markDirty();
      debouncedRenderPreview();
    });

    // ── Kid Mode: Card Styling Controls ──────────────
    const cardGapInput = document.getElementById('style-card-gap');

    if (cardGapInput) {
      cardGapInput.addEventListener('input', function () {
        getCurrentPage().styles.cardGap = parseInt(cardGapInput.value, 10) || 4;
        markDirty();
        debouncedRenderPreview();
      });
    }
    const cardImageWidthInput = document.getElementById('style-card-image-width');
    if (cardImageWidthInput) {
      cardImageWidthInput.addEventListener('input', function () {
        getCurrentPage().styles.cardImageWidth = parseInt(cardImageWidthInput.value, 10) || 80;
        markDirty();
        debouncedRenderPreview();
      });
    }
    const noteFontSizeInput = document.getElementById('style-program-note-font-size');
    if (noteFontSizeInput) {
      noteFontSizeInput.addEventListener('input', function () {
        getCurrentPage().styles.programNoteFontSize = parseInt(noteFontSizeInput.value, 10) || 10;
        markDirty();
        debouncedRenderPreview();
      });
    }

    // ── Column Width Controls ─────────────────────────
    const columnNameSlider = document.getElementById('style-column-name-width');
    const columnTimeInput = document.getElementById('style-column-time-width');
    const columnNameDisplay = document.getElementById('column-name-display');
    const columnDateDisplay = document.getElementById('column-date-display');

    function updateColumnDisplays() {
      const nameW = parseInt(columnNameSlider.value, 10);
      const timeW = parseInt(columnTimeInput.value, 10);
      const dateW = 100 - nameW - timeW;
      columnNameDisplay.textContent = nameW + '%';
      columnDateDisplay.textContent = dateW + '%';
    }

    columnNameSlider.addEventListener('input', function () {
      getCurrentPage().styles.columnNameWidth = parseInt(columnNameSlider.value, 10);
      updateColumnDisplays();
      markDirty();
      debouncedRenderPreview();
    });

    columnTimeInput.addEventListener('input', function () {
      getCurrentPage().styles.columnTimeWidth = parseInt(columnTimeInput.value, 10);
      updateColumnDisplays();
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
        const page = getCurrentPage();
        page.footer.source = source;
        // Auto-set title text and font size based on language and mode
        let langKey = source;
        if (meta.mode === 'kid') {
          langKey = source === 'default-spanish' ? 'kid-spanish' : 'kid-english';
        }
        const langTitle = CONFIG.HEADER_TITLE_BY_LANGUAGE[langKey];
        if (langTitle) {
          page.header.titleText = langTitle.text;
          page.styles.headerTitleFontSize = langTitle.fontSize;
          page.styles.headerMonthFontSize = langTitle.fontSize;
          document.getElementById('header-title-size').value = langTitle.fontSize;
        }
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

    const asteriskSize = document.getElementById('footer-asterisk-size');
    asteriskSize.addEventListener('input', function () {
      getCurrentPage().footer.asteriskFontSize = parseInt(asteriskSize.value, 10) || 7;
      markDirty();
      debouncedRenderPreview();
    });

    const asteriskBold = document.getElementById('footer-asterisk-bold');
    asteriskBold.addEventListener('change', function () {
      getCurrentPage().footer.asteriskBold = asteriskBold.checked;
      markDirty();
      debouncedRenderPreview();
    });

    const asteriskItalic = document.getElementById('footer-asterisk-italic');
    asteriskItalic.addEventListener('change', function () {
      getCurrentPage().footer.asteriskItalic = asteriskItalic.checked;
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

    updatePageIndicator();
  }

  function updatePageIndicator() {
    const text = document.getElementById('page-indicator-text');
    const prevBtn = document.getElementById('page-prev');
    const nextBtn = document.getElementById('page-next');
    if (!text) return;
    text.textContent = 'Page ' + (activePage + 1) + ' of ' + pages.length;
    if (prevBtn) prevBtn.disabled = (activePage <= 0);
    if (nextBtn) nextBtn.disabled = (activePage >= pages.length - 1);
  }

  function switchToPage(index) {
    activePage = index;
    syncSettingsFromPage();
    renderPageList();
    updatePageIndicator();
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
    document.getElementById('header-month-text').value = page.header.monthText;
    document.getElementById('header-title-color').value = page.header.titleColor;
    document.getElementById('header-month-color').value = page.header.monthColor;
    document.getElementById('header-title-size').value = page.styles.headerTitleFontSize;
    document.getElementById('header-strip-filled').checked = !!page.styles.stripFilled;
    document.getElementById('style-branch-borders').checked = page.styles.branchBorders !== false;

    // Typography size inputs
    document.getElementById('style-program-name-size').value = page.styles.programNameFontSize;
    document.getElementById('style-program-date-size').value = page.styles.programDateFontSize;
    document.getElementById('style-program-time-size').value = page.styles.programTimeFontSize;
    document.getElementById('style-program-subtitle-size').value = page.styles.programSubtitleFontSize;

    // Bold checkboxes
    document.getElementById('style-program-name-bold').checked = page.styles.programNameBold;
    document.getElementById('style-program-date-bold').checked = page.styles.programDateBold;
    document.getElementById('style-program-time-bold').checked = page.styles.programTimeBold;

    // Column widths
    const nameW = page.styles.columnNameWidth || 48;
    const timeW = page.styles.columnTimeWidth || 20;
    document.getElementById('style-column-name-width').value = nameW;
    document.getElementById('style-column-time-width').value = timeW;
    document.getElementById('column-name-display').textContent = nameW + '%';
    document.getElementById('column-date-display').textContent = (100 - nameW - timeW) + '%';

    // Footer
    const footerSourceBtns = document.querySelectorAll('[data-footer-source]');
    footerSourceBtns.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-footer-source') === page.footer.source);
    });
    document.getElementById('footer-asterisk-note').value = page.footer.asteriskNote || '';
    document.getElementById('footer-asterisk-size').value = page.footer.asteriskFontSize || 12;
    document.getElementById('footer-asterisk-bold').checked = !!page.footer.asteriskBold;
    document.getElementById('footer-asterisk-italic').checked = !!page.footer.asteriskItalic;

    // Page size
    const pageSizeBtns = document.querySelectorAll('[data-page-size]');
    pageSizeBtns.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-page-size') === meta.pageSize);
    });


    // Font dropdowns
    const fontCondensed = document.getElementById('font-condensed');
    const fontDisplay = document.getElementById('font-display');
    if (fontCondensed) fontCondensed.value = fontRoles.headerTitle;
    if (fontDisplay) fontDisplay.value = fontRoles.branchName;

    // Mode UI
    applyModeUI();

    // Kid mode-specific settings
    if (meta.mode === 'kid' && page.styles) {
      const cardGInput = document.getElementById('style-card-gap');
      const cardIWInput = document.getElementById('style-card-image-width');
      if (cardGInput) cardGInput.value = page.styles.cardGap || 4;
      if (cardIWInput) cardIWInput.value = page.styles.cardImageWidth || 180;
      const noteFSInput = document.getElementById('style-program-note-font-size');
      if (noteFSInput) noteFSInput.value = page.styles.programNoteFontSize || 10;
    }

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
        const serialized = {
          header: FlyerUtils.deepClone(page.header),
          footer: FlyerUtils.deepClone(page.footer),
          styles: FlyerUtils.deepClone(page.styles),
        };
        if (meta.mode === 'kid') {
          serialized.cards = FlyerUtils.deepClone(page.cards || []);
        } else {
          serialized.branches = FlyerUtils.deepClone(page.branches || []);
        }
        return serialized;
      }),
    }, null, 2);
  }

  function saveFile() {
    // Collect image IDs used by kid mode cards
    const usedIds = meta.mode === 'kid' ? ImageStore.collectUsedImageIds(pages) : [];

    const saveWithImages = usedIds.length > 0
      ? (function () {
        // Gather only the images actually used
        return Promise.all(usedIds.map(function (id) {
          return ImageStore.getImage(id).then(function (dataUrl) {
            return { id: id, dataUrl: dataUrl };
          });
        })).then(function (results) {
          const imageMap = {};
          results.forEach(function (r) {
            if (r.dataUrl) imageMap[r.id] = r.dataUrl;
          });
          return imageMap;
        });
      })()
      : Promise.resolve({});

    saveWithImages.then(function (imageMap) {
      const data = JSON.parse(serializeAll());
      // Embed images in the file for portability
      if (Object.keys(imageMap).length > 0) {
        data.images = imageMap;
      }
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const firstPage = pages[0];
      const baseName = (firstPage.header.titleText + ' - ' + firstPage.header.monthText).trim() || 'flyer';
      a.download = baseName + '.flyer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      isDirty = false;
      showNotification('File saved successfully.', 'success');
    });
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
              cards: page.cards,
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
      meta.mode = data.meta.mode || 'standard';
    }

    // Restore font roles
    if (data.fontRoles) {
      fontRoles = FlyerUtils.deepClone(data.fontRoles);
    } else {
      fontRoles = FlyerUtils.deepClone(CONFIG.FONT_ROLES);
    }

    // Restore pages (supports both multi-page, kid mode, and legacy single-page format)
    if (data.pages && data.pages.length > 0) {
      pages = data.pages.map(function (p) {
        const page = {
          header: FlyerUtils.deepClone(p.header || CONFIG.DEFAULT_HEADER),
          footer: FlyerUtils.deepClone(p.footer || CONFIG.DEFAULT_FOOTER),
          styles: FlyerUtils.deepClone(p.styles || CONFIG.DEFAULT_STYLES),
        };
        if (meta.mode === 'kid') {
          page.cards = FlyerUtils.deepClone(p.cards || []);
        } else {
          page.branches = FlyerUtils.deepClone(p.branches || []);
        }
        return page;
      });
    } else if (data.header || data.branches) {
      // Legacy single-page format
      pages = [{
        header: FlyerUtils.deepClone(data.header || CONFIG.DEFAULT_HEADER),
        branches: FlyerUtils.deepClone(data.branches || []),
        footer: FlyerUtils.deepClone(data.footer || CONFIG.DEFAULT_FOOTER),
        styles: FlyerUtils.deepClone(data.styles || CONFIG.DEFAULT_STYLES),
      }];
    }

    activePage = 0;
    isDirty = false;

    // Import embedded images into IndexedDB and cache
    const imageImportPromise = data.images && typeof data.images === 'object'
      ? ImageStore.importImages(data.images).then(function () {
        Object.keys(data.images).forEach(function (id) {
          imageCache[id] = data.images[id];
        });
      })
      : Promise.resolve();

    imageImportPromise.then(function () {
      // Update all settings inputs to reflect loaded state
      applyModeUI();
      populateFontDropdowns();
      syncSettingsFromPage();
      renderPageList();
      renderBranchList();
      renderPreview();

      showNotification('File loaded successfully.', 'success');
    });
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
    if (meta.mode === 'kid') {
      pages = [FlyerUtils.createDefaultKidPage()];
    } else {
      const defaultFlyer = FlyerUtils.createDefaultFlyer();
      pages = [{
        header: defaultFlyer.header,
        branches: defaultFlyer.branches,
        footer: defaultFlyer.footer,
        styles: defaultFlyer.styles,
      }];
    }
    activePage = 0;
    const savedMode = meta.mode;
    meta = FlyerUtils.deepClone(CONFIG.DEFAULT_META);
    meta.mode = savedMode;
    fontRoles = FlyerUtils.deepClone(CONFIG.FONT_ROLES);
    isDirty = false;
    localStorage.removeItem(CONFIG.STORAGE_KEY);

    applyModeUI();
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

    // Reset zoom to 100% during export, restore after
    const savedZoom = zoomLevel;
    if (zoomLevel !== 1) {
      zoomLevel = 1;
      applyZoom();
    }

    document.fonts.ready.then(function () {
      const pageDims = CONFIG.PAGE[meta.pageSize] || CONFIG.PAGE.letter;
      const pageWidth = pageDims.width;
      const pageHeight = pageDims.height;

      const jsPDFLib = window.jspdf || window.jsPDF;
      if (!jsPDFLib) {
        showNotification('PDF library failed to load. Check your internet connection.', 'error');
        return;
      }
      const JsPDFConstructor = jsPDFLib.jsPDF || jsPDFLib;
      const pdf = new JsPDFConstructor({
        unit: 'in',
        format: [pageWidth, pageHeight],
        orientation: 'portrait',
      });

      const scaleRatio = CONFIG.PDF.dpi / CONFIG.SCREEN_DPI;
      const previewWidthPx = pageWidth * CONFIG.SCREEN_DPI;
      const previewHeightPx = pageHeight * CONFIG.SCREEN_DPI;

      // Pre-load all kid mode images into cache before rendering PDF pages
      const preloadPromise = meta.mode === 'kid'
        ? (function () {
          const ids = [];
          pages.forEach(function (p) {
            if (p.cards) {
              p.cards.forEach(function (c) {
                if (c.imageId && !imageCache[c.imageId]) ids.push(c.imageId);
                if (c.nameImageId && !imageCache[c.nameImageId]) ids.push(c.nameImageId);
              });
            }
          });
          return ids.length > 0
            ? Promise.all(ids.map(function (id) {
              return ImageStore.getImage(id).then(function (dataUrl) {
                if (dataUrl) imageCache[id] = dataUrl;
              });
            }))
            : Promise.resolve();
        })()
        : Promise.resolve();

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

            // Wait for layout to settle, then auto-size text, rasterize, then capture
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                // Kid mode has no vertical text, skip rasterization
                if (meta.mode !== 'kid') {
                  autoSizeVerticalText(tempDiv);
                  rasterizeVerticalText(tempDiv, scaleRatio);
                }

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
                }).catch(function (err) {
                  document.body.removeChild(tempDiv);
                  resolve();
                  showNotification('Page render failed: ' + err.message, 'error');
                });
              });
            });
          });
        });
      });

      // Execute page renders sequentially (after image preload)
      let chain = preloadPromise;
      pagePromises.forEach(function (fn) {
        chain = chain.then(fn);
      });

      chain.then(function () {
        const firstPage = pages[0];
        const filename = (firstPage.header.titleText + ' - ' + firstPage.header.monthText).trim() + '.pdf' || 'flyer.pdf';
        pdf.save(filename);
        showNotification('PDF exported successfully!', 'success');
      }).catch(function (err) {
        showNotification('PDF export failed: ' + err.message, 'error');
      }).finally(function () {
        if (savedZoom !== 1) {
          zoomLevel = savedZoom;
          applyZoom();
        }
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
    const wrapper = document.getElementById('preview-wrapper');
    const preview = document.getElementById('flyer-preview');
    container.style.transform = 'scale(' + zoomLevel + ')';
    // Set container dimensions so the scrollable wrapper knows the scaled size
    if (preview && wrapper) {
      const w = preview.offsetWidth * zoomLevel;
      const h = preview.offsetHeight * zoomLevel;
      container.style.width = preview.offsetWidth + 'px';
      container.style.height = preview.offsetHeight + 'px';
      container.style.marginBottom = (h - preview.offsetHeight) + 'px';
      // Center horizontally: use auto margins when content fits, explicit margin when it overflows
      const wrapperWidth = wrapper.clientWidth - 40; // subtract 20px padding each side
      if (w <= wrapperWidth) {
        const offset = (wrapperWidth - w) / 2;
        container.style.marginLeft = offset + 'px';
        container.style.marginRight = offset + 'px';
      } else {
        container.style.marginLeft = '0';
        container.style.marginRight = (w - preview.offsetWidth) + 'px';
      }
    }
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

    // Page indicator prev/next
    document.getElementById('page-prev').addEventListener('click', function () {
      if (activePage > 0) switchToPage(activePage - 1);
    });
    document.getElementById('page-next').addEventListener('click', function () {
      if (activePage < pages.length - 1) switchToPage(activePage + 1);
    });

    // Sidebar toggle and tab switching
    bindSidebarToggle();
    bindTabSwitching();

    // Add Branch button (standard mode)
    document.getElementById('btn-add-branch').addEventListener('click', function () {
      const newBranch = FlyerUtils.createBlankBranch();
      getCurrentPage().branches.push(newBranch);
      markDirty();
      renderBranchList();
      debouncedRenderPreview();
    });

    // Add Card button (kid mode)
    document.getElementById('btn-add-card').addEventListener('click', function () {
      addKidCard();
    });

    // Card image upload handlers
    document.getElementById('card-image-upload').addEventListener('change', function (e) {
      handleCardImageUpload(e, 'image');
    });
    document.getElementById('card-name-image-upload').addEventListener('change', function (e) {
      handleCardImageUpload(e, 'nameImage');
    });

    // Initialize ImageStore
    ImageStore.init();

    // Apply initial mode UI
    applyModeUI();

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
