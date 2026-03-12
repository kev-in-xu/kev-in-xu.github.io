import { createStore, createInitialGameState } from './state.js';
import { createRenderer } from './render.js';
import { createTimer } from './timer.js';
import { createHistoryController } from './history.js';
import { getDailyStart, postWinningRun } from './api-client.js';
import { getWikiPageByPath, getWikiPageByTitle } from './mw-browser-client.js';

const LOTTIE_WEB_CDN = 'https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js';
const SESSION_ID_STORAGE_KEY = 'wiki-race-session-id-v1';
const TARGET_PREVIEW_MAX_SECTIONS = 3;
const TARGET_PREVIEW_MAX_SNIPPET_CHARS = 220;
const TARGET_PREVIEW_HIDE_DELAY_MS = 140;
let lottieLoadPromise = null;

function isFullscreenActive() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

function loadLottieWeb() {
  if (window.lottie) return Promise.resolve(window.lottie);
  if (lottieLoadPromise) return lottieLoadPromise;

  lottieLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = LOTTIE_WEB_CDN;
    script.async = true;
    script.onload = () => resolve(window.lottie || null);
    script.onerror = () => reject(new Error('Failed to load lottie-web'));
    document.head.appendChild(script);
  });

  return lottieLoadPromise;
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function createWinConfetti(rootEl) {
  const confettiSrc = rootEl?.dataset?.confettiSrc || '';
  if (!confettiSrc || prefersReducedMotion()) {
    return {
      reset() {},
      prime() {},
      play() {}
    };
  }

  const container = document.createElement('div');
  container.className = 'wiki-race-confetti';
  rootEl.appendChild(container);

  let animation = null;
  let animationReadyPromise = null;
  let hasPlayedForRun = false;

  async function ensureAnimation() {
    if (animationReadyPromise) return animationReadyPromise;
    const lottie = await loadLottieWeb();
    if (!lottie) throw new Error('lottie-web unavailable');
    animation = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      path: confettiSrc,
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid slice'
      }
    });
    animation.setSpeed(0.6);
    animationReadyPromise = new Promise((resolve, reject) => {
      function onLoaded() {
        animation.removeEventListener('DOMLoaded', onLoaded);
        animation.removeEventListener('data_failed', onFailed);
        resolve(animation);
      }
      function onFailed() {
        animation.removeEventListener('DOMLoaded', onLoaded);
        animation.removeEventListener('data_failed', onFailed);
        reject(new Error('Failed to load confetti animation JSON'));
      }
      animation.addEventListener('DOMLoaded', onLoaded);
      animation.addEventListener('data_failed', onFailed);
    });
    animation.addEventListener('complete', () => {
      container.classList.remove('is-active');
    });
    return animationReadyPromise;
  }

  return {
    reset() {
      hasPlayedForRun = false;
      container.classList.remove('is-active');
      if (animation) animation.stop();
    },
    async prime() {
      try {
        const anim = await ensureAnimation();
        anim.goToAndStop(0, true);
      } catch (_err) {
        // Ignore warmup failures; game remains playable.
      }
    },
    async play() {
      if (hasPlayedForRun) return;
      hasPlayedForRun = true;
      try {
        const anim = await ensureAnimation();
        container.classList.add('is-active');
        requestAnimationFrame(() => {
          anim.goToAndPlay(0, true);
        });
      } catch (_err) {
        container.classList.remove('is-active');
      }
    }
  };
}

async function requestElementFullscreen(el) {
  if (!el) return false;
  try {
    if (el.requestFullscreen) {
      await el.requestFullscreen();
      return true;
    }
    if (el.webkitRequestFullscreen) {
      await Promise.resolve(el.webkitRequestFullscreen());
      return true;
    }
  } catch (_err) {
    return false;
  }
  return false;
}

async function exitAnyFullscreen() {
  try {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
      return true;
    }
    if (document.webkitExitFullscreen) {
      await Promise.resolve(document.webkitExitFullscreen());
      return true;
    }
  } catch (_err) {
    return false;
  }
  return false;
}

function normalizePathFromHref(href) {
  try {
    const url = new URL(href, window.location.origin);
    if (url.hostname === 'en.wikipedia.org' && url.pathname.startsWith('/wiki/')) {
      return url.pathname;
    }
    if (url.origin === window.location.origin && url.pathname.startsWith('/wiki/')) {
      return url.pathname;
    }
    return null;
  } catch (_err) {
    return null;
  }
}

function buildUiState(gameState, elapsedMs, historyController) {
  const allowedLinkPaths = gameState.currentPage?.linkIndex?.map((link) => link.path) || [];
  return {
    status: gameState.status,
    errorMessage: gameState.errorMessage,
    clickCount: gameState.clickCount,
    elapsedMs,
    canGoBack: historyController.canGoBack(),
    currentPageTitle: gameState.currentPage?.displayTitle || null,
    articleHtml: gameState.currentPage?.html || null,
    routeTitles: gameState.route.map((step) => step.title),
    allowedLinkPaths
  };
}

function isAllowedCurrentPageLink(currentPage, path) {
  if (!currentPage?.linkIndex?.length) return false;
  return currentPage.linkIndex.some((link) => link.path === path);
}

function isTargetPageMatch(pagePayload, targetPage) {
  if (!pagePayload?.page || !targetPage) return false;
  const targetPath = targetPage.path;
  const currentPath = pagePayload.page.path;
  if (targetPath && currentPath && targetPath === currentPath) return true;

  const targetNorm = targetPage.normalizedTitle;
  const currentNorm = pagePayload.page.normalizedTitle;
  return Boolean(targetNorm && currentNorm && targetNorm === currentNorm);
}

// utility function to generate a UUIDv4 string for client-generated run/session IDs, 
// with fallback for older browsers without crypto support.
function createClientRunId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function getOrCreateSessionId() {
  const fallback = createClientRunId();
  try {
    const existing = localStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (existing) return existing;
    localStorage.setItem(SESSION_ID_STORAGE_KEY, fallback);
    return fallback;
  } catch (_err) {
    return fallback;
  }
}

function normalizePreviewText(value) {
  return String(value || '')
    .replace(/\[edit\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncatePreviewText(value, maxChars = TARGET_PREVIEW_MAX_SNIPPET_CHARS) {
  const text = normalizePreviewText(value);
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function buildTargetSectionPreview(articleHtml, {
  maxSections = TARGET_PREVIEW_MAX_SECTIONS,
  maxChars = TARGET_PREVIEW_MAX_SNIPPET_CHARS
} = {}) {
  const rawHtml = String(articleHtml || '').trim();
  if (!rawHtml) return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');
  const articleBody = doc.querySelector('.wiki-race-article-body') || doc.body;
  if (!articleBody) return [];

  const sections = [];
  const seenSnippets = new Set();
  const headings = Array.from(articleBody.querySelectorAll('h2'));

  for (const heading of headings) {
    if (sections.length >= maxSections) break;

    const headingText = normalizePreviewText(
      heading.querySelector('.mw-headline')?.textContent || heading.textContent || ''
    );
    if (!headingText) continue;

    let snippetText = '';
    let cursor = heading.nextElementSibling;
    while (cursor) {
      const tagName = (cursor.tagName || '').toLowerCase();
      if (tagName === 'h2') break;

      const paragraph = tagName === 'p' ? cursor : cursor.querySelector?.('p');
      const nextText = normalizePreviewText(paragraph?.textContent || '');
      if (nextText.length >= 48) {
        snippetText = nextText;
        break;
      }

      cursor = cursor.nextElementSibling;
    }

    const snippet = truncatePreviewText(snippetText, maxChars);
    if (!snippet || seenSnippets.has(snippet)) continue;

    seenSnippets.add(snippet);
    sections.push({ heading: headingText, snippet });
  }

  if (sections.length < maxSections) {
    const fallbackParagraphs = Array.from(articleBody.querySelectorAll('p'))
      .map((paragraph) => normalizePreviewText(paragraph.textContent || ''))
      .filter((text) => text.length >= 48);

    for (const paragraph of fallbackParagraphs) {
      if (sections.length >= maxSections) break;

      const snippet = truncatePreviewText(paragraph, maxChars);
      if (!snippet || seenSnippets.has(snippet)) continue;

      seenSnippets.add(snippet);
      sections.push({
        heading: sections.length === 0 ? 'Overview' : `Overview ${sections.length + 1}`,
        snippet
      });
    }
  }

  return sections.slice(0, maxSections);
}

async function bootstrap() {
  const root = document.getElementById('wiki-race-app');
  if (!root) return;
  const modeToggle = root.querySelector('[data-field="game-mode-random"]');
  const modeSubtitle = root.querySelector('[data-region="mode-subtitle"]');
  const store = createStore(createInitialGameState());
  const renderer = createRenderer(root);
  const historyController = createHistoryController();
  const winConfetti = createWinConfetti(root);
  const fullscreenBtn = root.querySelector('[data-action="fullscreen"]');
  let currentTargetPage = null;
  let activeRunMeta = null;
  let targetPreviewRequestToken = 0;
  let targetPreviewLinkEl = null;
  let targetPreviewHideTimer = null;
  const targetPreviewState = {
    status: 'idle',
    title: '',
    sections: [],
    errorMessage: '',
    isOpen: false
  };

  const targetPreviewEl = document.createElement('section');
  targetPreviewEl.className = 'wiki-race-target-preview';
  targetPreviewEl.id = 'wiki-race-target-preview';
  targetPreviewEl.hidden = true;
  targetPreviewEl.setAttribute('aria-live', 'polite');
  modeSubtitle?.parentElement?.appendChild(targetPreviewEl);

  function getSelectedMode() {
    return modeToggle?.checked ? 'random_vital' : 'agi';
  }

  function clearTargetPreviewHideTimer() {
    if (targetPreviewHideTimer !== null) {
      clearTimeout(targetPreviewHideTimer);
      targetPreviewHideTimer = null;
    }
  }

  function isTargetPreviewAvailableNow() {
    return store.getState().status !== 'idle';
  }

  function renderTargetPreview() {
    const canRenderOpen = Boolean(
      targetPreviewState.isOpen
      && isTargetPreviewAvailableNow()
      && targetPreviewLinkEl
      && targetPreviewState.title
    );
    targetPreviewEl.hidden = !canRenderOpen;
    targetPreviewEl.classList.toggle('is-open', canRenderOpen);
    targetPreviewEl.dataset.state = targetPreviewState.status;

    if (!canRenderOpen) {
      targetPreviewEl.replaceChildren();
      return;
    }

    const fragment = document.createDocumentFragment();
    const title = document.createElement('p');
    title.className = 'wiki-race-target-preview__title';
    title.textContent = `Destination preview: ${targetPreviewState.title}`;
    fragment.appendChild(title);

    if (targetPreviewState.status === 'loading') {
      const loading = document.createElement('p');
      loading.className = 'wiki-race-target-preview__status';
      loading.textContent = 'Loading preview...';
      fragment.appendChild(loading);
    } else if (targetPreviewState.status === 'error') {
      const error = document.createElement('p');
      error.className = 'wiki-race-target-preview__status';
      error.textContent = targetPreviewState.errorMessage || 'Target preview unavailable.';
      fragment.appendChild(error);
    } else if (targetPreviewState.status === 'ready' && targetPreviewState.sections.length) {
      const list = document.createElement('ol');
      list.className = 'wiki-race-target-preview__list';
      targetPreviewState.sections.forEach((section) => {
        const item = document.createElement('li');
        item.className = 'wiki-race-target-preview__item';

        const heading = document.createElement('h3');
        heading.className = 'wiki-race-target-preview__heading';
        heading.textContent = section.heading;

        const snippet = document.createElement('p');
        snippet.className = 'wiki-race-target-preview__snippet';
        snippet.textContent = section.snippet;

        item.appendChild(heading);
        item.appendChild(snippet);
        list.appendChild(item);
      });
      fragment.appendChild(list);
    } else {
      const empty = document.createElement('p');
      empty.className = 'wiki-race-target-preview__status';
      empty.textContent = 'No preview sections available.';
      fragment.appendChild(empty);
    }

    targetPreviewEl.replaceChildren(fragment);
  }

  function hideTargetPreviewNow() {
    clearTargetPreviewHideTimer();
    if (!targetPreviewState.isOpen) return;
    targetPreviewState.isOpen = false;
    renderTargetPreview();
  }

  function scheduleTargetPreviewHide() {
    clearTargetPreviewHideTimer();
    targetPreviewHideTimer = window.setTimeout(() => {
      targetPreviewHideTimer = null;
      hideTargetPreviewNow();
    }, TARGET_PREVIEW_HIDE_DELAY_MS);
  }

  function showTargetPreviewNow() {
    if (!isTargetPreviewAvailableNow() || !targetPreviewState.title) return;
    clearTargetPreviewHideTimer();
    targetPreviewState.isOpen = true;
    renderTargetPreview();
  }

  function resetTargetPreviewState() {
    clearTargetPreviewHideTimer();
    targetPreviewState.status = 'idle';
    targetPreviewState.title = '';
    targetPreviewState.sections = [];
    targetPreviewState.errorMessage = '';
    targetPreviewState.isOpen = false;
    renderTargetPreview();
  }

  function setTargetPreviewLoading(title) {
    targetPreviewState.status = 'loading';
    targetPreviewState.title = normalizePreviewText(title) || 'Unknown destination';
    targetPreviewState.sections = [];
    targetPreviewState.errorMessage = '';
    renderTargetPreview();
  }

  function setTargetPreviewReady(title, sections) {
    targetPreviewState.status = 'ready';
    targetPreviewState.title = normalizePreviewText(title) || 'Unknown destination';
    targetPreviewState.sections = Array.isArray(sections) ? sections : [];
    targetPreviewState.errorMessage = '';
    renderTargetPreview();
  }

  function setTargetPreviewError(title, message) {
    targetPreviewState.status = 'error';
    targetPreviewState.title = normalizePreviewText(title) || 'Unknown destination';
    targetPreviewState.sections = [];
    targetPreviewState.errorMessage = message || 'Target preview unavailable.';
    renderTargetPreview();
  }

  function bindTargetPreviewLinkEvents() {
    if (targetPreviewLinkEl) {
      targetPreviewLinkEl.removeEventListener('mouseenter', showTargetPreviewNow);
      targetPreviewLinkEl.removeEventListener('mouseleave', scheduleTargetPreviewHide);
      targetPreviewLinkEl.removeEventListener('focus', showTargetPreviewNow);
      targetPreviewLinkEl.removeEventListener('blur', scheduleTargetPreviewHide);
      targetPreviewLinkEl.removeAttribute('aria-describedby');
      targetPreviewLinkEl.classList.remove('wiki-race-destination-link');
    }

    targetPreviewLinkEl = modeSubtitle?.querySelector('a[data-role="target-page-link"]') || null;
    if (!targetPreviewLinkEl) {
      hideTargetPreviewNow();
      return;
    }

    targetPreviewLinkEl.classList.add('wiki-race-destination-link');
    targetPreviewLinkEl.setAttribute('aria-describedby', targetPreviewEl.id);
    targetPreviewLinkEl.addEventListener('mouseenter', showTargetPreviewNow);
    targetPreviewLinkEl.addEventListener('mouseleave', scheduleTargetPreviewHide);
    targetPreviewLinkEl.addEventListener('focus', showTargetPreviewNow);
    targetPreviewLinkEl.addEventListener('blur', scheduleTargetPreviewHide);
  }

  targetPreviewEl.addEventListener('mouseenter', showTargetPreviewNow);
  targetPreviewEl.addEventListener('mouseleave', scheduleTargetPreviewHide);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideTargetPreviewNow();
  });

  async function prefetchTargetPreview(targetPage, requestToken) {
    const pageTitle = targetPage?.title || '';
    if (!pageTitle) {
      setTargetPreviewError('', 'Target preview unavailable for this run.');
      return;
    }

    setTargetPreviewLoading(pageTitle);

    try {
      const payload = await getWikiPageByTitle(pageTitle);
      if (requestToken !== targetPreviewRequestToken) return;

      const sections = buildTargetSectionPreview(payload?.html || '');
      if (!sections.length) {
        setTargetPreviewError(payload?.displayTitle || pageTitle, 'No destination sections available.');
        return;
      }

      setTargetPreviewReady(payload?.displayTitle || pageTitle, sections);
    } catch (_err) {
      if (requestToken !== targetPreviewRequestToken) return;
      setTargetPreviewError(pageTitle, 'Failed to load destination preview.');
    }
  }

  // activeRunMeta holds client-generated metadata for the current run, 
  // which will be included in the payload when submitting results to the backend.
  function initializeRunMeta() {
    activeRunMeta = {
      runId: createClientRunId(),
      sessionId: getOrCreateSessionId(),
      startedAtUtc: new Date().toISOString(),
      mode: getSelectedMode(),
      dateKey: null,
      seedSource: null,
      seedHash: null
    };
  }

  // after game win, build a payload of run data to submit to the backend for validation and persistence.
  function buildWinningRunPayload(durationMs) {
    const gameState = store.getState();
    if (!activeRunMeta || !gameState.startPage || !gameState.targetPage || !gameState.route.length) {
      return null;
    }

    return {
      runId: activeRunMeta.runId,
      sessionId: activeRunMeta.sessionId,
      mode: activeRunMeta.mode,
      dateKey: activeRunMeta.dateKey,
      seedSource: activeRunMeta.seedSource,
      seedHash: activeRunMeta.seedHash,
      startedAtUtc: activeRunMeta.startedAtUtc,
      completedAtUtc: new Date().toISOString(),
      durationMs: Math.max(0, Math.floor(Number(durationMs) || 0)),
      clickCount: Math.max(0, Math.floor(Number(gameState.clickCount) || 0)),
      startPage: gameState.startPage,
      targetPage: gameState.targetPage,
      route: gameState.route.map((step) => ({
        title: step.title,
        path: step.path,
        url: step.url,
        moveType: step.moveType,
        clickCountAfterStep: step.clickCountAfterStep,
        redirectFollowed: Boolean(step.redirectFollowed)
      }))
    };
  }

  function syncModeSubtitle() {
    if (!modeSubtitle) return;
    if (getSelectedMode() === 'random_vital') {
      if (currentTargetPage?.url && currentTargetPage?.title) {
        const targetTitle = String(currentTargetPage.title).trim();
        modeSubtitle.innerHTML = `Reach the wikipedia page for <a data-role="target-page-link" href="${currentTargetPage.url}" target="_blank" rel="noopener noreferrer">${targetTitle}</a> using as few clicks as possible. Start from a random Wikipedia article.`;
        bindTargetPreviewLinkEvents();
        return;
      }
      modeSubtitle.innerHTML = 'Reach the wikipedia page for ______ using as few clicks as possible. Start from a random Wikipedia article.';
      bindTargetPreviewLinkEvents();
      return;
    }
    modeSubtitle.innerHTML = 'Reach the wikipedia page for <a data-role="target-page-link" href="https://en.wikipedia.org/wiki/Artificial_general_intelligence" target="_blank" rel="noopener noreferrer">artificial general intelligence</a> using as few article links as possible. Daily challenge resets at 00:00 UTC.';
    bindTargetPreviewLinkEvents();
  }
  syncModeSubtitle();
  modeToggle?.addEventListener('change', () => {
    targetPreviewRequestToken += 1;
    currentTargetPage = null;
    resetTargetPreviewState();
    syncModeSubtitle();
  });

  function syncFullscreenButtonLabel() {
    if (!fullscreenBtn) return;
    fullscreenBtn.textContent = isFullscreenActive() ? 'Exit Fullscreen' : 'Fullscreen';
  }

  syncFullscreenButtonLabel();
  document.addEventListener('fullscreenchange', syncFullscreenButtonLabel);
  document.addEventListener('webkitfullscreenchange', syncFullscreenButtonLabel);

  const timer = createTimer((elapsedMs) => {
    renderer.renderState(buildUiState(store.getState(), elapsedMs, historyController));
    renderTargetPreview();
  });

  async function loadAndRenderStartPageByTitle(title, { moveType = 'click', countMove = false } = {}) {
    const page = await getWikiPageByTitle(title);
    const state = store.getState();

    store.updateState((prev) => {
      const nextClicks = countMove ? prev.clickCount + 1 : prev.clickCount;
      const nextRoute = [...prev.route];
      nextRoute.push({
        title: page.displayTitle,
        path: page.page.path,
        url: page.page.url,
        moveType,
        clickCountAfterStep: nextClicks,
        redirectFollowed: Boolean(page?.redirect?.followed)
      });

      return {
        ...prev,
        currentPage: page,
        clickCount: nextClicks,
        route: nextRoute,
        status: prev.status === 'loading_start' ? 'running' : prev.status,
        errorMessage: null
      };
    });

    return page;
  }

  async function startRun() {
    targetPreviewRequestToken += 1;
    const runPreviewToken = targetPreviewRequestToken;
    resetTargetPreviewState();
    initializeRunMeta();
    winConfetti.reset();
    historyController.reset();
    timer.reset();
    store.setState({
      ...createInitialGameState(),
      status: 'loading_start'
    });
    renderer.renderState(buildUiState(store.getState(), 0, historyController));
    renderTargetPreview();

    try {
      const daily = await getDailyStart({ target: getSelectedMode() });
      if (runPreviewToken !== targetPreviewRequestToken) return null;
      if (activeRunMeta) {
        activeRunMeta.mode = getSelectedMode();
        activeRunMeta.dateKey = daily?.dateKey || null;
        activeRunMeta.seedSource = daily?.seedSource || null;
        activeRunMeta.seedHash = daily?.seedHash || null;
      }
      currentTargetPage = daily.endPage || null;
      syncModeSubtitle();
      store.updateState((prev) => ({
        ...prev,
        dateKey: daily.dateKey,
        targetPage: daily.endPage,
        startPage: daily.startPage,
        status: 'loading_start'
      }));
      void prefetchTargetPreview(daily.endPage, runPreviewToken);

      const page = await loadAndRenderStartPageByTitle(daily.startPage.title, {
        moveType: 'start',
        countMove: false
      });

      timer.start();

      store.updateState((prev) => ({
        ...prev,
        status: 'running'
      }));
      renderer.renderState(buildUiState(store.getState(), timer.getElapsedMs(), historyController));
      renderTargetPreview();
      return page;
    } catch (err) {
      if (runPreviewToken !== targetPreviewRequestToken) return null;
      store.updateState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: err?.message || 'Failed to start the daily challenge.'
      }));
      renderer.renderState(buildUiState(store.getState(), timer.getElapsedMs(), historyController));
      renderTargetPreview();
    }
  }

  async function handleArticleNav(path, source) {
    const state = store.getState();
    if (state.status !== 'running' || !state.currentPage) return;

    const snapshot = {
      page: state.currentPage,
      routeLength: state.route.length,
      scrollTop: renderer.els.article.scrollTop
    };
    historyController.pushSnapshot(snapshot);

    try {
      const page = await getWikiPageByPath(path);
      const reachedTarget = isTargetPageMatch(page, store.getState().targetPage);
      let finalElapsedMs = null;
      if (reachedTarget && store.getState().status === 'running') {
        finalElapsedMs = timer.stop();
      }

      store.updateState((prev) => {
        const clickCount = prev.clickCount + 1;
        const route = [...prev.route, {
          title: page.displayTitle,
          path: page.page.path,
          url: page.page.url,
          moveType: source,
          clickCountAfterStep: clickCount,
          redirectFollowed: Boolean(page?.redirect?.followed)
        }];
        return {
          ...prev,
          currentPage: page,
          clickCount,
          route,
          status: reachedTarget ? 'won' : 'running',
          errorMessage: null
        };
      });
      renderer.renderState(buildUiState(store.getState(), finalElapsedMs ?? timer.getElapsedMs(), historyController));
      renderTargetPreview();
      if (reachedTarget) {
        const payload = buildWinningRunPayload(finalElapsedMs);
        if (payload) {
          void postWinningRun(payload);
        }
        void winConfetti.play();
      }
    } catch (err) {
      store.updateState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: err?.message || 'Page load failed. Start again.'
      }));
      renderer.renderState(buildUiState(store.getState(), timer.getElapsedMs(), historyController));
      renderTargetPreview();
    }
  }

  renderer.onControl('start', () => {
    void requestElementFullscreen(root);
    renderer.els.startBtn?.scrollIntoView({
      block: 'start',
      inline: 'nearest',
      behavior: 'smooth'
    });
    startRun();
  });

  renderer.onControl('fullscreen', async () => {
    if (isFullscreenActive()) {
      await exitAnyFullscreen();
    } else {
      await requestElementFullscreen(root);
    }
    syncFullscreenButtonLabel();
  });

  renderer.onControl('abandon', () => {
    const state = store.getState();
    if (state.status !== 'running') return;
    timer.stop();
    store.updateState((prev) => ({ ...prev, status: 'abandoned' }));
    renderer.renderState(buildUiState(store.getState(), timer.getElapsedMs(), historyController));
    renderTargetPreview();
  });

  renderer.onControl('back', () => {
    const state = store.getState();
    if (state.status !== 'running' || !historyController.canGoBack()) return;
    historyController.goBackViaBrowser();
  });

  renderer.onArticleLinkClick((event, link) => {
    const state = store.getState();
    if (state.status !== 'running') {
      event.preventDefault();
      return;
    }

    const href = (link.getAttribute('href') || '').trim();
    if (href.startsWith('#')) {
      return;
    }

    const path = link.getAttribute('data-wiki-path') || normalizePathFromHref(href);
    if (!path) {
      event.preventDefault();
      return;
    }

    if (!isAllowedCurrentPageLink(state.currentPage, path)) {
      event.preventDefault();
      store.updateState((prev) => ({
        ...prev,
        errorMessage: 'That link is not allowed in this game.'
      }));
      renderer.renderState(buildUiState(store.getState(), timer.getElapsedMs(), historyController));
      renderTargetPreview();
      return;
    }

    event.preventDefault();
    handleArticleNav(path, 'click');
  });

  window.addEventListener('popstate', () => {
    if (!historyController.consumeIgnoreNextPop()) return;

    const state = store.getState();
    const snapshot = historyController.popSnapshot();
    if (!snapshot || state.status !== 'running') return;

    store.updateState((prev) => {
      const clickCount = prev.clickCount + 1;
      const route = [...prev.route, {
        title: snapshot.page.displayTitle,
        path: snapshot.page.page.path,
        url: snapshot.page.page.url,
        moveType: 'browser_back',
        clickCountAfterStep: clickCount,
        redirectFollowed: Boolean(snapshot.page?.redirect?.followed)
      }];
      return {
        ...prev,
        currentPage: snapshot.page,
        clickCount,
        route
      };
    });

    renderer.renderState(buildUiState(store.getState(), timer.getElapsedMs(), historyController));
    renderer.els.article.scrollTop = snapshot.scrollTop || 0;
    renderTargetPreview();
  });

  renderer.renderState(buildUiState(store.getState(), 0, historyController));
  renderTargetPreview();

  const warmConfetti = () => {
    void winConfetti.prime();
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(warmConfetti, { timeout: 1200 });
  } else {
    setTimeout(warmConfetti, 350);
  }
}

bootstrap();
