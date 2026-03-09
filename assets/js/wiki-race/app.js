import { createStore, createInitialGameState } from './state.js';
import { createRenderer } from './render.js';
import { createTimer } from './timer.js';
import { createHistoryController } from './history.js';
import { getDailyStart } from './api-client.js';
import { getWikiPageByPath, getWikiPageByTitle } from './mw-browser-client.js';

const LOTTIE_WEB_CDN = 'https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js';
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
      el.webkitRequestFullscreen();
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
      document.webkitExitFullscreen();
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

async function bootstrap() {
  const root = document.getElementById('wiki-race-app');
  if (!root) return;

  const store = createStore(createInitialGameState());
  const renderer = createRenderer(root);
  const historyController = createHistoryController();
  const winConfetti = createWinConfetti(root);
  const fullscreenBtn = root.querySelector('[data-action="fullscreen"]');

  function syncFullscreenButtonLabel() {
    if (!fullscreenBtn) return;
    fullscreenBtn.textContent = isFullscreenActive() ? 'Exit Fullscreen' : 'Fullscreen';
  }

  syncFullscreenButtonLabel();
  document.addEventListener('fullscreenchange', syncFullscreenButtonLabel);
  document.addEventListener('webkitfullscreenchange', syncFullscreenButtonLabel);

  const timer = createTimer((elapsedMs) => {
    renderer.renderState(buildUiState(store.getState(), elapsedMs, historyController));
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
        moveType,
        clickCountAfterStep: nextClicks
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
    winConfetti.reset();
    historyController.reset();
    timer.reset();
    store.setState({
      ...createInitialGameState(),
      status: 'loading_start'
    });
    renderer.renderState(buildUiState(store.getState(), 0, historyController));

    try {
      const daily = await getDailyStart();
      store.updateState((prev) => ({
        ...prev,
        dateKey: daily.dateKey,
        targetPage: daily.endPage,
        startPage: daily.startPage,
        status: 'loading_start'
      }));

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
      return page;
    } catch (err) {
      store.updateState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: err?.message || 'Failed to start the daily challenge.'
      }));
      renderer.renderState(buildUiState(store.getState(), timer.getElapsedMs(), historyController));
    }
  }

  async function handleArticleNav(path, source) {
    const state = store.getState();
    if (state.status !== 'running' || !state.currentPage) return;

    const targetPath = state.targetPage?.path || '/wiki/Artificial_general_intelligence';
    const winningClick = path === targetPath;
    const snapshot = {
      page: state.currentPage,
      routeLength: state.route.length,
      scrollTop: renderer.els.article.scrollTop
    };
    historyController.pushSnapshot(snapshot);

    if (winningClick) {
      store.updateState((prev) => ({ ...prev, clickCount: prev.clickCount + 1 }));
      const elapsed = timer.stop();
      renderer.renderState(buildUiState(store.getState(), elapsed, historyController));
    }

    try {
      const page = await getWikiPageByPath(path);
      const reachedTarget = winningClick || isTargetPageMatch(page, store.getState().targetPage);
      let finalElapsedMs = null;
      if (reachedTarget && store.getState().status === 'running') {
        finalElapsedMs = timer.stop();
      }

      store.updateState((prev) => {
        const clickCount = prev.clickCount + (winningClick ? 0 : 1);
        const route = [...prev.route, {
          title: page.displayTitle,
          path: page.page.path,
          moveType: source,
          clickCountAfterStep: clickCount
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
      if (reachedTarget) {
        void winConfetti.play();
      }
    } catch (err) {
      store.updateState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: err?.message || 'Page load failed. Start again.'
      }));
      renderer.renderState(buildUiState(store.getState(), timer.getElapsedMs(), historyController));
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
        moveType: 'browser_back',
        clickCountAfterStep: clickCount
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
  });

  renderer.renderState(buildUiState(store.getState(), 0, historyController));

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
