import { formatElapsedMs } from './timer.js';

export function createRenderer(rootEl) {
  const TOC_SCROLL_TOP_OFFSET_PX = 16;
  const IDLE_PLACEHOLDER_HTML = '<p class="wiki-race-placeholder">Article content will appear here after you start.</p>';
  const LOADING_PLACEHOLDER_HTML = `
    <p class="wiki-race-placeholder wiki-race-loading-placeholder">
      Loading article<span class="wiki-race-loading-dots" aria-hidden="true">...</span>
    </p>
  `;
  const ERROR_PLACEHOLDER_HTML = '<p class="wiki-race-placeholder">Article failed to load. Start again.</p>';
  const FULLSCREEN_OUTWARD_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
    </svg>
  `;
  const FULLSCREEN_INWARD_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" />
    </svg>

  `;
  const els = {
    playModeTabs: Array.from(rootEl.querySelectorAll('[data-play-mode]')),
    soloToolbar: rootEl.querySelector('[data-region="solo-toolbar"]'),
    soloToolbarControls: rootEl.querySelector('[data-region="solo-toolbar-controls"]'),
    sharedToolbarControls: rootEl.querySelector('[data-region="shared-toolbar-controls"]'),
    multiplayerPanel: rootEl.querySelector('[data-region="multiplayer-panel"]'),
    multiplayerHome: rootEl.querySelector('[data-region="multiplayer-home"]'),
    multiplayerLobby: rootEl.querySelector('[data-region="multiplayer-lobby"]'),
    multiplayerLobbyHeader: rootEl.querySelector('[data-region="multiplayer-lobby-header"]'),
    multiplayerError: rootEl.querySelector('[data-region="multiplayer-error"]'),
    multiplayerShareBlock: rootEl.querySelector('.wiki-race-share-block'),
    multiplayerNickname: rootEl.querySelector('[data-field="multiplayer-nickname"]'),
    multiplayerLobbyCode: rootEl.querySelector('[data-field="multiplayer-lobby-code"]'),
    multiplayerShareCode: rootEl.querySelector('[data-field="multiplayer-share-code"]'),
    multiplayerLobbyStatus: rootEl.querySelector('[data-field="multiplayer-lobby-status"]'),
    multiplayerConnectionStatus: rootEl.querySelector('[data-field="multiplayer-connection-status"]'),
    multiplayerRosterPanel: rootEl.querySelector('.wiki-race-roster-panel'),
    multiplayerRoster: rootEl.querySelector('[data-region="multiplayer-roster"]'),
    multiplayerStartCountdownBtn: rootEl.querySelector('[data-action="start-lobby-race"]'),
    multiplayerInlineLeaveBtn: rootEl.querySelector('[data-action="leave-lobby-inline"]'),
    startBtn: rootEl.querySelector('[data-action="start"]'),
    backBtn: rootEl.querySelector('[data-action="back"]'),
    abandonBtn: rootEl.querySelector('[data-action="abandon"]'),
    fullscreenBtn: rootEl.querySelector('[data-action="fullscreen"]'),
    modeSelect: rootEl.querySelector('[data-field="game-mode"]'),
    seededInputWrap: rootEl.querySelector('[data-region="seeded-input"]'),
    seededInput: rootEl.querySelector('[data-field="seeded-key"]'),
    toolbarError: rootEl.querySelector('[data-region="toolbar-error"]'),
    timer: rootEl.querySelector('[data-field="timer"]'),
    clicks: rootEl.querySelector('[data-field="clicks"]'),
    stats: rootEl.querySelector('.wiki-race-stats'),
    article: rootEl.querySelector('[data-region="article"]'),
    tocPanel: rootEl.querySelector('[data-region="toc-panel"]'),
    toc: rootEl.querySelector('[data-region="toc"]'),
    route: rootEl.querySelector('[data-region="route"]')
  };
  let lastArticleHtml = null;
  let lastAllowedLinksKey = '';
  let lastRouteText = null;
  let lastRouteTitleCount = 0;
  let cleanupTocSync = () => {};
  let cleanupLazyImageSync = () => {};

  function renderMultiplayerRoster(state) {
    if (!els.multiplayerRoster) return;
    const players = Array.isArray(state.multiplayerPlayers) ? state.multiplayerPlayers : [];
    const slots = Array.from({ length: 6 }, (_value, index) => players[index] || null);
    els.multiplayerRoster.innerHTML = '';
    const rows = [
      { label: 'Player', key: 'player' },
      { label: 'Time', key: 'time' },
      { label: 'Clicks', key: 'clicks' }
    ];

    rows.forEach((rowConfig) => {
      const row = document.createElement('tr');
      row.className = 'wiki-race-roster-row';
      const rowLabel = document.createElement('th');
      rowLabel.scope = 'row';
      rowLabel.className = 'wiki-race-roster-row-label';
      rowLabel.textContent = rowConfig.label;
      row.appendChild(rowLabel);

      slots.forEach((player) => {
        const cell = document.createElement('td');
        cell.className = 'wiki-race-roster-cell';

        if (!player) {
          cell.classList.add('is-empty');
          row.appendChild(cell);
          return;
        }

        const playerStatus = String(player.resultStatus || '').trim();
        cell.classList.add(`wiki-race-roster-cell-${rowConfig.key}`);
        if (playerStatus) {
          cell.classList.add(`is-${playerStatus}`);
        }

        if (rowConfig.key === 'player') {
          const content = document.createElement('div');
          content.className = 'wiki-race-roster-player-slot';

          const name = document.createElement('span');
          name.className = `wiki-race-roster-name${playerStatus ? ` is-${playerStatus}` : ''}`;
          name.textContent = player.nickname;
          content.appendChild(name);

          if (player.isHost) {
            const badge = document.createElement('span');
            badge.className = 'wiki-race-roster-badge';
            badge.textContent = 'Host';
            content.appendChild(badge);
          }

          if (state.canKickPlayers && !player.isSelf && !state.multiplayerRoundStarted) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'wiki-race-kick-btn';
            button.textContent = 'X';
            button.setAttribute('aria-label', `Kick ${player.nickname}`);
            button.dataset.action = 'kick-player';
            button.dataset.sessionId = player.sessionId;
            content.appendChild(button);
          }

          cell.appendChild(content);
        } else {
          cell.textContent = rowConfig.key === 'time'
            ? String(player.timeLabel || '')
            : String(player.clicksLabel || '');
        }

        row.appendChild(cell);
      });

      els.multiplayerRoster.appendChild(row);
    });
  }

  function setFullscreenToggleState(isFullscreenActive) {
    if (!els.fullscreenBtn) return;
    const actionLabel = isFullscreenActive ? 'Exit fullscreen' : 'Enter fullscreen';
    els.fullscreenBtn.classList.add('wiki-race-btn-icon');
    els.fullscreenBtn.setAttribute('aria-label', actionLabel);
    els.fullscreenBtn.setAttribute('title', actionLabel);
    els.fullscreenBtn.innerHTML = isFullscreenActive ? FULLSCREEN_INWARD_ICON : FULLSCREEN_OUTWARD_ICON;
  }

  function normalizeMediaUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (value.startsWith('//')) return `https:${value}`;
    return value;
  }

  // Normalizes srcset by ensuring all URLs are absolute and properly encoded.
  function normalizeSrcset(srcset) {
    return String(srcset || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [url, descriptor] = part.split(/\s+/, 2);
        const normalized = normalizeMediaUrl(url);
        return descriptor ? `${normalized} ${descriptor}` : normalized;
      })
      .join(', ');
  }

  // Promotes lazy image placeholders to real images when they come into view.
  function setupLazyImagePlaceholders() {
    cleanupLazyImageSync();
    cleanupLazyImageSync = () => {};

    const articleBody = els.article.querySelector('.wiki-race-article-body');
    if (!articleBody) return;

    const placeholders = Array.from(
      articleBody.querySelectorAll('span.lazy-image-placeholder[data-mw-src], span.lazy-image-placeholder[data-src]')
    );
    if (!placeholders.length) return;

    const promote = (placeholder) => {
      if (!placeholder || !placeholder.parentNode) return;

      const src = normalizeMediaUrl(
        placeholder.getAttribute('data-mw-src') || placeholder.getAttribute('data-src')
      );
      if (!src) return;

      const img = document.createElement('img');
      img.src = src;

      const srcset = normalizeSrcset(
        placeholder.getAttribute('data-mw-srcset') || placeholder.getAttribute('data-srcset')
      );
      if (srcset) img.srcset = srcset;

      const className = placeholder.getAttribute('data-class');
      if (className) img.className = className;

      const widthAttr = placeholder.getAttribute('data-width');
      const heightAttr = placeholder.getAttribute('data-height');
      if (widthAttr) img.setAttribute('width', widthAttr);
      if (heightAttr) img.setAttribute('height', heightAttr);

      img.loading = 'lazy';
      img.decoding = 'async';
      placeholder.replaceWith(img);
    };

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        promote(entry.target);
        obs.unobserve(entry.target);
      });
    }, {
      root: els.article,
      rootMargin: '400px 0px', // Start loading images when they are within 300px of the viewport.
      threshold: 0.01
    });

    placeholders.forEach((placeholder) => observer.observe(placeholder));
    cleanupLazyImageSync = () => observer.disconnect();
  }

  function ensureHeadingId(heading, fallbackText, seenIds) {
    const preferredId = heading.getAttribute('id') || heading.querySelector('.mw-headline')?.getAttribute('id') || '';
    if (preferredId) {
      let uniqueId = preferredId;
      let index = 2;
      while (seenIds.has(uniqueId)) {
        uniqueId = `${preferredId}_${index}`;
        index += 1;
      }
      heading.setAttribute('id', uniqueId);
      seenIds.add(uniqueId);
      return uniqueId;
    }

    const base = String(fallbackText || 'section')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_') || 'section';

    let id = base;
    let index = 2;
    while (seenIds.has(id)) {
      id = `${base}_${index}`;
      index += 1;
    }
    heading.setAttribute('id', id);
    seenIds.add(id);
    return id;
  }

  function collectHeadings(articleBody) {
    const headingEls = articleBody.querySelectorAll('h2, h3, h4');
    const seenIds = new Set();
    const counters = [0, 0, 0, 0, 0, 0, 0];
    const items = [];
    let minLevel = 6;

    headingEls.forEach((heading) => {
      const level = Number(heading.tagName.slice(1));
      if (!Number.isFinite(level) || level < 2 || level > 4) return;

      const titleNode = heading.querySelector('.mw-headline') || heading;
      const text = (titleNode.textContent || '').replace(/\[edit\]\s*$/i, '').trim();
      if (!text) return;

      minLevel = Math.min(minLevel, level);
      const id = ensureHeadingId(heading, text, seenIds);

      counters[level] += 1;
      for (let i = level + 1; i < counters.length; i += 1) {
        counters[i] = 0;
      }

      const number = [];
      for (let i = minLevel; i <= level; i += 1) {
        if (counters[i] > 0) number.push(counters[i]);
      }

      items.push({
        id,
        text,
        level,
        number: number.join('.'),
        node: heading
      });
    });

    return items;
  }

  // Renders the table of contents based on the current article HTML, and sets up scroll syncing.
  function renderToc() {
    cleanupTocSync();
    cleanupTocSync = () => {};
    if (!els.toc || !els.tocPanel) return;

    const articleBody = els.article.querySelector('.wiki-race-article-body');
    if (!articleBody) {
      els.tocPanel.classList.remove('is-ready');
      els.toc.querySelector('.vector-toc-contents').innerHTML = '<p class="wiki-race-toc-placeholder">Section links appear after you start.</p>';
      cleanupLazyImageSync();
      return;
    }

    const headings = collectHeadings(articleBody);
    if (!headings.length) {
      els.tocPanel.classList.remove('is-ready');
      els.toc.querySelector('.vector-toc-contents').innerHTML = '<p class="wiki-race-toc-placeholder">No section headings in this article.</p>';
      return;
    }

    els.tocPanel.classList.add('is-ready');

    const contents = els.toc.querySelector('.vector-toc-contents');
    contents.innerHTML = '';
    const list = document.createElement('ul');
    list.className = 'vector-toc-list';

    const topLi = document.createElement('li');
    topLi.className = 'vector-toc-list-item vector-toc-level-2';
    topLi.dataset.anchor = 'top';

    const topAnchor = document.createElement('a');
    topAnchor.className = 'vector-toc-link';
    topAnchor.href = '#';

    const topNumber = document.createElement('span');
    topNumber.className = 'vector-toc-numb';
    topNumber.textContent = '';

    const topText = document.createElement('span');
    topText.className = 'vector-toc-text';
    topText.textContent = '(Top)';
    topText.style.fontWeight = '700';

    topAnchor.appendChild(topNumber);
    topAnchor.appendChild(topText);
    topLi.appendChild(topAnchor);
    list.appendChild(topLi);

    const idToLink = new Map();
    headings.forEach((item) => {
      const li = document.createElement('li');
      li.className = `vector-toc-list-item vector-toc-level-${item.level}`;
      li.dataset.anchor = item.id;

      const anchor = document.createElement('a');
      anchor.className = 'vector-toc-link';
      anchor.href = `#${item.id}`;

      const number = document.createElement('span');
      number.className = 'vector-toc-numb';
      number.textContent = item.number || '';

      const text = document.createElement('span');
      text.className = 'vector-toc-text';
      text.textContent = item.text;

      anchor.appendChild(number);
      anchor.appendChild(text);
      li.appendChild(anchor);
      list.appendChild(li);
      idToLink.set(item.id, li);
    });
    contents.appendChild(list);

    const headingNodes = headings.map((item) => item.node).filter(Boolean);

    function setActiveHeading() {
      const articleTop = els.article.getBoundingClientRect().top;
      let activeId = headings[0].id;
      for (const headingNode of headingNodes) {
        const delta = headingNode.getBoundingClientRect().top - articleTop;
        if (delta <= 80) {
          activeId = headingNode.getAttribute('id');
        } else {
          break;
        }
      }

      idToLink.forEach((li, id) => {
        li.classList.toggle('vector-toc-list-item-active', id === activeId);
      });
    }

    const onScroll = () => setActiveHeading();
    const onResize = () => setActiveHeading();
    const onTocClick = (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      const anchor = target?.closest?.('a.vector-toc-link[href^="#"]');
      if (!anchor || !contents.contains(anchor)) return;

      event.preventDefault();
      const id = decodeURIComponent(String(anchor.getAttribute('href') || '').slice(1));
      if (!id) {
        els.article.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
        return;
      }

      const heading = articleBody.querySelector(`#${CSS.escape(id)}`);
      if (!heading) return;

      const articleRect = els.article.getBoundingClientRect();
      const headingRect = heading.getBoundingClientRect();
      const top = els.article.scrollTop + (headingRect.top - articleRect.top) - TOC_SCROLL_TOP_OFFSET_PX;
      els.article.scrollTo({
        top: Math.max(0, top),
        behavior: 'smooth'
      });
    };

    els.article.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    contents.addEventListener('click', onTocClick);
    setActiveHeading();

    cleanupTocSync = () => {
      els.article.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      contents.removeEventListener('click', onTocClick);
    };
  }

  function renderState(state) {
    const isMultiplayerMode = state.playMode === 'multiplayer';
    const hasJoinedMultiplayerLobby = Boolean(state.hasJoinedMultiplayerLobby);
    const shouldShowToolbar = !isMultiplayerMode || hasJoinedMultiplayerLobby;
    const showSoloControls = !isMultiplayerMode;

    if (els.playModeTabs?.length) {
      els.playModeTabs.forEach((tab) => {
        const isActive = tab.dataset.playMode === state.playMode;
        tab.classList.toggle('is-active', isActive);
        tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }
    if (els.soloToolbar) {
      els.soloToolbar.hidden = !shouldShowToolbar;
      els.soloToolbar.style.display = shouldShowToolbar ? '' : 'none';
    }
    if (els.soloToolbarControls) {
      els.soloToolbarControls.hidden = !showSoloControls;
      els.soloToolbarControls.style.display = showSoloControls ? '' : 'none';
    }
    if (els.sharedToolbarControls) {
      els.sharedToolbarControls.hidden = !shouldShowToolbar;
      els.sharedToolbarControls.style.display = shouldShowToolbar ? '' : 'none';
    }
    if (els.multiplayerPanel) {
      els.multiplayerPanel.hidden = !isMultiplayerMode;
      els.multiplayerPanel.style.display = isMultiplayerMode ? '' : 'none';
    }
    if (els.multiplayerHome) {
      els.multiplayerHome.hidden = !isMultiplayerMode || state.hasJoinedMultiplayerLobby;
    }
    if (els.multiplayerLobby) {
      els.multiplayerLobby.hidden = !isMultiplayerMode || !state.hasJoinedMultiplayerLobby;
    }
    if (els.multiplayerLobbyHeader) {
      const shouldShowLobbyHeader = isMultiplayerMode && state.hasJoinedMultiplayerLobby;
      els.multiplayerLobbyHeader.hidden = !shouldShowLobbyHeader;
      els.multiplayerLobbyHeader.style.display = shouldShowLobbyHeader ? '' : 'none';
    }
    if (els.multiplayerShareBlock) {
      els.multiplayerShareBlock.hidden = !state.hasJoinedMultiplayerLobby;
    }
    if (els.multiplayerError) {
      const multiplayerError = String(state.multiplayerErrorMessage || '').trim();
      els.multiplayerError.hidden = !multiplayerError;
      els.multiplayerError.textContent = multiplayerError;
    }
    if (els.multiplayerNickname) {
      els.multiplayerNickname.value = String(state.multiplayerNicknameValue || '');
    }
    if (els.multiplayerLobbyCode) {
      els.multiplayerLobbyCode.value = String(state.multiplayerLobbyCodeValue || '');
    }
    if (els.multiplayerShareCode) {
      els.multiplayerShareCode.textContent = String(state.multiplayerShareCode || '------');
    }
    if (els.multiplayerConnectionStatus) {
      const shouldShowConnectionStatus = state.hasJoinedMultiplayerLobby && state.debugMode;
      els.multiplayerConnectionStatus.hidden = !shouldShowConnectionStatus;
      els.multiplayerConnectionStatus.style.display = shouldShowConnectionStatus ? '' : 'none';
      els.multiplayerConnectionStatus.textContent = String(state.multiplayerConnectionStatusLabel || 'Offline');
      els.multiplayerConnectionStatus.dataset.state = String(state.multiplayerConnectionStatus || 'idle');
    }
    if (els.multiplayerRosterPanel) {
      const shouldShowRosterPanel = isMultiplayerMode && state.hasJoinedMultiplayerLobby;
      els.multiplayerRosterPanel.hidden = !shouldShowRosterPanel;
      els.multiplayerRosterPanel.style.display = shouldShowRosterPanel ? '' : 'none';
    }
    if (els.multiplayerStartCountdownBtn) {
      const shouldShowStart = state.hasJoinedMultiplayerLobby
        && state.canStartMultiplayerCountdown
        && !state.multiplayerRoundStarted;
      els.multiplayerStartCountdownBtn.hidden = !shouldShowStart;
      els.multiplayerStartCountdownBtn.disabled = !shouldShowStart;
    }
    if (els.multiplayerInlineLeaveBtn) {
      els.multiplayerInlineLeaveBtn.disabled = !state.hasJoinedMultiplayerLobby;
    }
    if (els.multiplayerLobbyStatus) {
      els.multiplayerLobbyStatus.textContent = String(state.multiplayerLobbyStatusLabel || 'lobby open');
    }
    renderMultiplayerRoster(state);

    if (els.stats) {
      let statsState = 'idle';
      if (state.status === 'running') statsState = 'running';
      if (state.status === 'won') statsState = 'complete';
      els.stats.setAttribute('data-state', statsState);
    }

    els.timer.textContent = formatElapsedMs(state.elapsedMs || 0);
    els.clicks.textContent = String(state.clickCount ?? 0);

    const isArticleLoading = Boolean(state.isArticleLoading);
    const isRunning = state.status === 'running';
    const isLoadingStart = state.status === 'loading_start';
    const isFinished = state.status === 'won' || state.status === 'abandoned';
    const selectedMode = String(state.selectedMode || 'agi').trim() || 'agi';
    const showSeedField = selectedMode !== 'agi' && Boolean(state.showSeedField);
    const isSeedFieldEditable = Boolean(state.isSeedFieldEditable);
    const canCopySeedField = Boolean(state.canCopySeedField);
    const toolbarErrorMessage = String(state.toolbarErrorMessage || '').trim();

    els.startBtn.disabled = state.canStart === false || state.status === 'loading_start' || isRunning || isMultiplayerMode;
    els.backBtn.disabled = !isRunning || !state.canGoBack;
    els.abandonBtn.disabled = !isRunning;
    if (els.modeSelect) {
      // Keep mode selection fixed while a run is active.
      els.modeSelect.disabled = Boolean(state.disableModeSelection) || isRunning || isLoadingStart || isMultiplayerMode;
    }
    if (els.seededInput) {
      els.seededInput.value = String(state.seedFieldValue || '');
      els.seededInput.readOnly = !isSeedFieldEditable;
      els.seededInput.disabled = isSeedFieldEditable && (isRunning || isLoadingStart);
      els.seededInput.setAttribute('aria-invalid', showSeedField && isSeedFieldEditable && toolbarErrorMessage ? 'true' : 'false');
      els.seededInput.setAttribute('title', canCopySeedField ? 'Click to copy seed' : '');
      els.seededInput.dataset.copyable = canCopySeedField ? 'true' : 'false';
    }
    if (els.seededInputWrap) {
      els.seededInputWrap.hidden = !showSeedField;
      els.seededInputWrap.style.display = showSeedField ? '' : 'none';
      els.seededInputWrap.dataset.copyable = canCopySeedField ? 'true' : 'false';
      els.seededInputWrap.setAttribute('title', canCopySeedField ? 'Click to copy seed' : '');
    }
    if (els.toolbarError) {
      els.toolbarError.hidden = !toolbarErrorMessage;
      els.toolbarError.textContent = toolbarErrorMessage;
    }
    els.article.classList.toggle('is-finished', isFinished);
    els.article.classList.toggle('is-nav-loading', isArticleLoading);
    els.article.setAttribute('aria-busy', isArticleLoading ? 'true' : 'false');

    if (!state.articleHtml) {
      const placeholderHtml = state.status === 'loading_start'
        ? LOADING_PLACEHOLDER_HTML
        : (state.status === 'error' ? ERROR_PLACEHOLDER_HTML : IDLE_PLACEHOLDER_HTML);
      if (els.article.innerHTML !== placeholderHtml) {
        els.article.innerHTML = placeholderHtml;
        els.article.classList.remove('has-sidebar');
        lastArticleHtml = null;
        lastAllowedLinksKey = '';
        renderToc();
      }
    }

    const allowedLinksKey = (state.allowedLinkPaths || []).join('|');
    const shouldUpdateArticleHtml = state.articleHtml && state.articleHtml !== lastArticleHtml;
    const shouldRefreshLinkStates = shouldUpdateArticleHtml || allowedLinksKey !== lastAllowedLinksKey;

    if (shouldUpdateArticleHtml) {
      els.article.innerHTML = state.articleHtml;
      els.article.scrollTop = 0;
      if (els.tocPanel) els.tocPanel.scrollTop = 0;
      const tocContents = els.toc?.querySelector('.vector-toc-contents');
      if (tocContents) tocContents.scrollTop = 0;
      const articleBody = els.article.querySelector(".wiki-race-article-body");
      if (articleBody) {
        articleBody.querySelectorAll(".wiki-race-page-title").forEach((node) => node.remove());
        if (state.currentPageTitle) {
          const pageTitle = document.createElement("h1");
          pageTitle.className = "wiki-race-page-title";
          pageTitle.textContent = state.currentPageTitle;
          articleBody.prepend(pageTitle);
        }
      }
      setupLazyImagePlaceholders();
      els.article.querySelectorAll('.wiki-race-categories').forEach((node) => node.remove());
      const hasSidebar = Boolean(
        els.article.querySelector('.wiki-race-article-body .sidebar, .wiki-race-article-body [role="navigation"]')
      );
      els.article.classList.toggle('has-sidebar', hasSidebar);
      lastArticleHtml = state.articleHtml;
      renderToc();
    }

    if (shouldRefreshLinkStates && state.articleHtml) {
      const allowedPaths = new Set(state.allowedLinkPaths || []);
      els.article.querySelectorAll('a[href]').forEach((anchor) => {
        const href = (anchor.getAttribute('href') || '').trim();
        if (href.startsWith('#')) {
          anchor.removeAttribute('data-disabled');
          anchor.removeAttribute('aria-disabled');
          anchor.removeAttribute('tabindex');
          return;
        }
        const path = anchor.getAttribute('data-wiki-path') || anchor.getAttribute('href') || '';
        if (!allowedPaths.has(path)) {
          anchor.setAttribute('data-disabled', 'true');
          anchor.setAttribute('aria-disabled', 'true');
          anchor.setAttribute('tabindex', '-1');
        } else {
          anchor.removeAttribute('data-disabled');
          anchor.removeAttribute('aria-disabled');
          anchor.removeAttribute('tabindex');
        }
      });
      lastAllowedLinksKey = allowedLinksKey;
    }

    const routeTitles = Array.isArray(state.routeTitles) ? state.routeTitles : [];
    const routeTitleCount = routeTitles.length;
    const routeText = routeTitleCount ? routeTitles.join(' -> ') : '-';
    if (routeText !== lastRouteText) {
      els.route.textContent = routeText;
      if (routeTitleCount > lastRouteTitleCount) {
        requestAnimationFrame(() => {
          if (!els.route) return;
          els.route.scrollLeft = els.route.scrollWidth;
        });
      }
      lastRouteText = routeText;
    }
    lastRouteTitleCount = routeTitleCount;

    const showArticleScaffold = true;
    if (els.route?.closest('.wiki-race-route-panel')) {
      const routePanel = els.route.closest('.wiki-race-route-panel');
      routePanel.hidden = !showArticleScaffold;
      routePanel.style.display = showArticleScaffold ? '' : 'none';
    }
    if (els.tocPanel?.closest('.wiki-race-main')) {
      const mainPanel = els.tocPanel.closest('.wiki-race-main');
      mainPanel.hidden = !showArticleScaffold;
      mainPanel.style.display = showArticleScaffold ? '' : 'none';
    }
  }

  function onArticleLinkClick(handler) {
    els.article.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      const link = target?.closest?.('a');
      if (!link || !els.article.contains(link)) return;
      handler(event, link);
    });
  }

  function onControl(action, handler) {
    rootEl.querySelector(`[data-action="${action}"]`)?.addEventListener('click', handler);
  }

  return {
    els,
    renderState,
    onArticleLinkClick,
    onControl,
    setFullscreenToggleState
  };
}
