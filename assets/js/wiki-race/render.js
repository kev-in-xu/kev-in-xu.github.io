import { formatElapsedMs } from './timer.js';

export function createRenderer(rootEl) {
  const els = {
    startBtn: rootEl.querySelector('[data-action="start"]'),
    backBtn: rootEl.querySelector('[data-action="back"]'),
    abandonBtn: rootEl.querySelector('[data-action="abandon"]'),
    timer: rootEl.querySelector('[data-field="timer"]'),
    clicks: rootEl.querySelector('[data-field="clicks"]'),
    status: rootEl.querySelector('[data-region="status"]'),
    article: rootEl.querySelector('[data-region="article"]'),
    route: rootEl.querySelector('[data-region="route"]')
  };
  let lastArticleHtml = null;
  let lastAllowedLinksKey = '';
  let lastRouteText = null;
  let lastStatusText = null;
  let lastStatusHtml = null;

  function renderState(state) {
    els.timer.textContent = formatElapsedMs(state.elapsedMs || 0);
    els.clicks.textContent = String(state.clickCount ?? 0);

    const isIdle = state.status === 'idle';
    const isRunning = state.status === 'running';
    const isTerminal = state.status === 'won' || state.status === 'abandoned' || state.status === 'error';

    els.startBtn.disabled = state.status === 'loading_start' || isRunning;
    els.backBtn.disabled = !isRunning || !state.canGoBack;
    els.abandonBtn.disabled = !isRunning;

    if (state.status === 'loading_start') {
      const next = 'Loading today\'s start page...';
      if (lastStatusText !== next || lastStatusHtml !== null) {
        els.status.textContent = next;
        lastStatusText = next;
        lastStatusHtml = null;
      }
    } else if (state.status === 'won') {
      const next = `Finished in ${state.clickCount} clicks, ${formatElapsedMs(state.elapsedMs || 0)}.`;
      if (lastStatusText !== next || lastStatusHtml !== null) {
        els.status.textContent = next;
        lastStatusText = next;
        lastStatusHtml = null;
      }
    } else if (state.status === 'abandoned') {
      const next = 'Run abandoned.';
      if (lastStatusText !== next || lastStatusHtml !== null) {
        els.status.textContent = next;
        lastStatusText = next;
        lastStatusHtml = null;
      }
    } else if (state.status === 'error') {
      const next = state.errorMessage || 'An error occurred. Start again.';
      if (lastStatusText !== next || lastStatusHtml !== null) {
        els.status.textContent = next;
        lastStatusText = next;
        lastStatusHtml = null;
      }
    } else if (isIdle) {
      const nextHtml = 'Click <strong>Start</strong> to reveal today&apos;s article.';
      if (lastStatusHtml !== nextHtml) {
        els.status.innerHTML = nextHtml;
        lastStatusHtml = nextHtml;
        lastStatusText = null;
      }
    } else if (isRunning) {
      const next = state.currentPageTitle
        ? `Current page: ${state.currentPageTitle}`
        : 'Run started.';
      if (lastStatusText !== next || lastStatusHtml !== null) {
        els.status.textContent = next;
        lastStatusText = next;
        lastStatusHtml = null;
      }
    } else if (isTerminal) {
      const next = state.status;
      if (lastStatusText !== next || lastStatusHtml !== null) {
        els.status.textContent = next;
        lastStatusText = next;
        lastStatusHtml = null;
      }
    }

    const allowedLinksKey = (state.allowedLinkPaths || []).join('|');
    const shouldUpdateArticleHtml = state.articleHtml && state.articleHtml !== lastArticleHtml;
    const shouldRefreshLinkStates = shouldUpdateArticleHtml || allowedLinksKey !== lastAllowedLinksKey;

    if (shouldUpdateArticleHtml) {
      els.article.innerHTML = state.articleHtml;
      els.article.querySelectorAll('.wiki-race-categories').forEach((node) => node.remove());
      lastArticleHtml = state.articleHtml;
    }

    if (shouldRefreshLinkStates && state.articleHtml) {
      const allowedPaths = new Set(state.allowedLinkPaths || []);
      els.article.querySelectorAll('a[href]').forEach((anchor) => {
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

    const routeText = state.routeTitles?.length ? state.routeTitles.join(' -> ') : '-';
    if (routeText !== lastRouteText) {
      els.route.textContent = routeText;
      lastRouteText = routeText;
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
    onControl
  };
}
