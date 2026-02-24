import { createStore, createInitialGameState } from './state.js';
import { createRenderer } from './render.js';
import { createTimer } from './timer.js';
import { createHistoryController } from './history.js';
import { getDailyStart, getWikiPageByPath, getWikiPageByTitle } from './api-client.js';

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
  const timer = createTimer((elapsedMs) => {
    renderer.renderState(buildUiState(store.getState(), elapsedMs, historyController));
  });

  async function loadAndRenderPageByTitle(title, { moveType = 'click', countMove = false } = {}) {
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
        targetPage: daily.target,
        startPage: daily.startPage,
        status: 'loading_start'
      }));

      const page = await loadAndRenderPageByTitle(daily.startPage.title, {
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
    renderer.els.startBtn?.scrollIntoView({
      block: 'start',
      inline: 'nearest',
      behavior: 'smooth'
    });
    startRun();
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

    const path = link.getAttribute('data-wiki-path') || normalizePathFromHref(link.getAttribute('href'));
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
}

bootstrap();
