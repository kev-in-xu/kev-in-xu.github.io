import { createStore, createInitialGameState } from './state.js';
import { createRenderer } from './render.js';
import { createTimer } from './timer.js';
import { createHistoryController } from './history.js';
import { getDailyStart, postWinningRun } from './api-client.js';
import { getWikiPageByPath, getWikiPageByTitle } from './mw-browser-client.js';
import { createTargetPreviewController } from './target-preview.js';

const LOTTIE_WEB_CDN = 'https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js';
const SESSION_ID_STORAGE_KEY = 'wiki-race-session-id-v1';
const SEEDED_KEY_PATTERN = /^[a-f0-9]{24}$/i;
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

function buildUiState(gameState, elapsedMs, historyController, toolbarState = {}) {
  const allowedLinkPaths = gameState.currentPage?.linkIndex?.map((link) => link.path) || [];
  const selectedMode = String(toolbarState.selectedMode || 'agi').trim() || 'agi';
  const seedInputValue = String(toolbarState.seedInputValue || '');
  const runSeedLabel = String(gameState.runSeedLabel || '--');
  const isSeededMode = selectedMode === 'seeded';
  const isRandomMode = selectedMode === 'random_vital';
  const canShowSeedField = isSeededMode
    ? !['loading_start', 'running'].includes(gameState.status)
    : (isRandomMode && runSeedLabel !== '--' && runSeedLabel !== 'agi');
  return {
    selectedMode,
    status: gameState.status,
    clickCount: gameState.clickCount,
    runSeedLabel,
    elapsedMs,
    canGoBack: historyController.canGoBack(),
    currentPageTitle: gameState.currentPage?.displayTitle || null,
    articleHtml: gameState.currentPage?.html || null,
    routeTitles: gameState.route.map((step) => step.title),
    allowedLinkPaths,
    seedFieldValue: isSeededMode ? seedInputValue : (canShowSeedField ? runSeedLabel : ''),
    showSeedField: canShowSeedField,
    isSeedFieldEditable: isSeededMode,
    canCopySeedField: isRandomMode && canShowSeedField,
    toolbarErrorMessage: gameState.errorMessage || null,
    canStart: !toolbarState.isStartRequestPending
      && !(selectedMode === 'seeded' && !toolbarState.isSeedInputValid),
    disableModeSelection: Boolean(toolbarState.isStartRequestPending)
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

async function copyTextToClipboard(text) {
  const value = String(text || '').trim();
  if (!value) return false;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_err) {
    // Fall through to the legacy copy path.
  }

  const fallbackInput = document.createElement('input');
  fallbackInput.type = 'text';
  fallbackInput.value = value;
  fallbackInput.setAttribute('readonly', 'readonly');
  fallbackInput.style.position = 'absolute';
  fallbackInput.style.left = '-9999px';
  document.body.appendChild(fallbackInput);
  fallbackInput.select();
  fallbackInput.setSelectionRange(0, value.length);

  try {
    return document.execCommand('copy');
  } catch (_err) {
    return false;
  } finally {
    fallbackInput.remove();
  }
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

async function bootstrap() {
  const root = document.getElementById('wiki-race-app');
  if (!root) return;
  const modeSubtitle = root.querySelector('[data-region="mode-subtitle"]');
  const store = createStore(createInitialGameState());
  const renderer = createRenderer(root);
  const historyController = createHistoryController();
  const winConfetti = createWinConfetti(root);
  const modeSelect = renderer.els.modeSelect;
  const seededInputWrap = renderer.els.seededInputWrap;
  const seededInput = renderer.els.seededInput;
  let currentTargetPage = null;
  let activeRunMeta = null;
  let startRequestPending = false;
  let startRequestToken = 0;
  let selectedMode = normalizeSelectedMode(modeSelect?.value || 'agi');
  let seedInputValue = '';
  let timer = null;

  function normalizeSelectedMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    if (mode === 'random_vital' || mode === 'seeded') return mode;
    return 'agi';
  }

  function sanitizeSeedKey(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-f0-9]/g, '')
      .slice(0, 24);
  }

  function isValidSeedKey(value) {
    return SEEDED_KEY_PATTERN.test(String(value || ''));
  }

  function getSelectedMode() {
    return selectedMode;
  }

  function getToolbarState() {
    return {
      selectedMode,
      seedInputValue,
      isSeedInputValid: isValidSeedKey(seedInputValue),
      isStartRequestPending: startRequestPending
    };
  }

  function renderUi(elapsedMs = timer ? timer.getElapsedMs() : 0) {
    renderer.renderState(buildUiState(store.getState(), elapsedMs, historyController, getToolbarState()));
    targetPreview.render();
  }

  function clearToolbarError() {
    const currentState = store.getState();
    if (!currentState.errorMessage) return;
    store.updateState((prev) => ({ ...prev, errorMessage: null }));
  }

  // create instance of controller that shows target page previews (via target-preview.js)
  const targetPreview = createTargetPreviewController({
    modeSubtitle,
    isPreviewAvailable: () => store.getState().status !== 'idle',
    fetchPageByTitle: getWikiPageByTitle
  });

  // activeRunMeta holds client-generated metadata for the current run, 
  // which will be included in the payload when submitting results to the backend.
  function initializeRunMeta(mode) {
    activeRunMeta = {
      runId: createClientRunId(),
      sessionId: getOrCreateSessionId(),
      startedAtUtc: new Date().toISOString(),
      mode,
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
        targetPreview.bindLinkEvents();
        return;
      }
      modeSubtitle.innerHTML = 'Reach the wikipedia page for ______ using as few clicks as possible. Start from a random Wikipedia article.';
      targetPreview.bindLinkEvents();
      return;
    }
    if (getSelectedMode() === 'seeded') {
      if (currentTargetPage?.url && currentTargetPage?.title) {
        const targetTitle = String(currentTargetPage.title).trim();
        modeSubtitle.innerHTML = `Replay the seeded wikipedia race to <a data-role="target-page-link" href="${currentTargetPage.url}" target="_blank" rel="noopener noreferrer">${targetTitle}</a>. Enter a stored 24-character seed key to load the run.`;
        targetPreview.bindLinkEvents();
        return;
      }
      modeSubtitle.innerHTML = 'Enter a stored 24-character seed key to replay a saved wikipedia race.';
      targetPreview.bindLinkEvents();
      return;
    }
    modeSubtitle.innerHTML = 'Reach the wikipedia page for <a data-role="target-page-link" href="https://en.wikipedia.org/wiki/Artificial_general_intelligence" target="_blank" rel="noopener noreferrer">artificial general intelligence</a> using as few article links as possible. Daily challenge resets at 00:00 UTC.';
    targetPreview.bindLinkEvents();
  }
  syncModeSubtitle();
  modeSelect?.addEventListener('change', () => {
    selectedMode = normalizeSelectedMode(modeSelect.value);
    targetPreview.invalidate();
    currentTargetPage = null;
    clearToolbarError();
    const nextMode = getSelectedMode();
    store.updateState((prev) => ({
      ...prev,
      runSeedLabel: nextMode === 'agi' ? 'agi' : '--'
    }));
    renderUi();
    syncModeSubtitle();
  });
  seededInput?.addEventListener('input', () => {
    const nextSeed = sanitizeSeedKey(seededInput.value);
    if (nextSeed !== seededInput.value) {
      seededInput.value = nextSeed;
    }
    seedInputValue = nextSeed;
    clearToolbarError();
    renderUi();
  });
  seededInputWrap?.addEventListener('click', async () => {
    if (getSelectedMode() !== 'random_vital') return;
    const seedToCopy = String(store.getState().runSeedLabel || '').trim();
    if (!seedToCopy || seedToCopy === '--' || seedToCopy === 'agi') return;

    seededInput.select();
    seededInput.setSelectionRange(0, seedToCopy.length);
    const copied = await copyTextToClipboard(seedToCopy);
    seededInput.setAttribute('title', copied ? 'Copied' : 'Copy failed');
    seededInputWrap.setAttribute('title', copied ? 'Copied' : 'Copy failed');
  });

  function syncFullscreenButtonLabel() {
    renderer.setFullscreenToggleState(isFullscreenActive());
  }

  syncFullscreenButtonLabel();
  document.addEventListener('fullscreenchange', syncFullscreenButtonLabel);
  document.addEventListener('webkitfullscreenchange', syncFullscreenButtonLabel);

  timer = createTimer((elapsedMs) => {
    renderUi(elapsedMs);
  });

  async function loadAndRenderStartPageByTitle(title, { moveType = 'click', countMove = false } = {}) {
    const page = await getWikiPageByTitle(title);

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
    const selectedMode = getSelectedMode();
    const submittedSeed = selectedMode === 'seeded' ? sanitizeSeedKey(seedInputValue) : null;
    if (selectedMode === 'seeded' && !isValidSeedKey(submittedSeed)) {
      store.updateState((prev) => ({
        ...prev,
        errorMessage: 'The seed is invalid.'
      }));
      renderUi();
      return null;
    }

    startRequestToken += 1;
    const requestToken = startRequestToken;
    const runPreviewToken = targetPreview.beginRun();
    startRequestPending = true;
    clearToolbarError();
    winConfetti.reset();
    historyController.reset();
    timer.reset();
    currentTargetPage = null;
    store.setState({
      ...createInitialGameState(),
      status: 'loading_start',
      runSeedLabel: selectedMode === 'agi' ? 'agi' : (selectedMode === 'seeded' ? submittedSeed : '--')
    });
    renderUi(0);
    syncModeSubtitle();
    void requestElementFullscreen(root);

    try {
      const daily = await getDailyStart({
        target: selectedMode,
        seed: selectedMode === 'seeded' ? submittedSeed : null
      });
      if (requestToken !== startRequestToken) return null;

      initializeRunMeta(selectedMode);
      if (activeRunMeta) {
        activeRunMeta.mode = selectedMode;
        activeRunMeta.dateKey = daily?.dateKey || null;
        activeRunMeta.seedSource = daily?.seedSource || null;
        activeRunMeta.seedHash = selectedMode === 'seeded'
          ? submittedSeed
          : (daily?.seedHash || null);
      }
      currentTargetPage = daily.endPage || null;
      syncModeSubtitle();
      store.updateState((prev) => ({
        ...prev,
        dateKey: daily.dateKey,
        targetPage: daily.endPage,
        startPage: daily.startPage,
        runSeedLabel: selectedMode === 'agi'
          ? 'agi'
          : (selectedMode === 'seeded' ? submittedSeed : (daily?.seedHash || '--')),
        status: 'loading_start'
      }));
      renderUi(0);
      void targetPreview.prefetch(daily.endPage, runPreviewToken);

      const page = await loadAndRenderStartPageByTitle(daily.startPage.title, {
        moveType: 'start',
        countMove: false
      });

      timer.start();

      store.updateState((prev) => ({
        ...prev,
        status: 'running'
      }));
      renderUi(timer.getElapsedMs());
      return page;
    } catch (err) {
      if (requestToken !== startRequestToken) return null;
      const isInvalidSeedError = selectedMode === 'seeded' && (err?.status === 400 || err?.status === 404);
      const currentStatus = store.getState().status;
      store.updateState((prev) => ({
        ...prev,
        status: isInvalidSeedError ? prev.status : (currentStatus === 'idle' || currentStatus === 'won' || currentStatus === 'abandoned' ? prev.status : 'error'),
        errorMessage: isInvalidSeedError
          ? 'The seed is invalid.'
          : (err?.message || 'Failed to start the daily challenge.')
      }));
      renderUi();
      if (!isInvalidSeedError) {
        targetPreview.invalidate();
      }
      syncModeSubtitle();
      return null;
    } finally {
      if (requestToken === startRequestToken) {
        startRequestPending = false;
        renderUi();
      }
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
      renderUi(finalElapsedMs ?? timer.getElapsedMs());
      if (reachedTarget) {
        const payload = buildWinningRunPayload(finalElapsedMs);
        if (payload) {
          void postWinningRun(payload).then((result) => {
            if (!result?.ok) {
              console.warn('Failed to submit wiki race win result', {
                mode: payload.mode,
                runId: payload.runId,
                seedHash: payload.seedHash || null,
                error: result?.error || 'Unknown error',
                status: result?.status ?? null,
                payload: result?.payload || null
              });
            }
          });
        }
        void winConfetti.play();
      }
    } catch (err) {
      store.updateState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: err?.message || 'Page load failed. Start again.'
      }));
      renderUi();
    }
  }

  renderer.onControl('start', () => {
    renderer.els.startBtn?.scrollIntoView({
      block: 'start',
      inline: 'nearest',
      behavior: 'smooth'
    });
    void startRun();
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
    renderUi();
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
      renderUi();
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

    renderUi();
    renderer.els.article.scrollTop = snapshot.scrollTop || 0;
  });

  renderUi(0);

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
