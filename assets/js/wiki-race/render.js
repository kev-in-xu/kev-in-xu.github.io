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
      els.status.textContent = 'Loading today\'s start page...';
    } else if (state.status === 'won') {
      els.status.textContent = `Finished in ${state.clickCount} clicks, ${formatElapsedMs(state.elapsedMs || 0)}.`;
    } else if (state.status === 'abandoned') {
      els.status.textContent = 'Run abandoned.';
    } else if (state.status === 'error') {
      els.status.textContent = state.errorMessage || 'An error occurred. Start again.';
    } else if (isIdle) {
      els.status.innerHTML = 'Click <strong>Start</strong> to reveal today&apos;s article.';
    } else if (isRunning) {
      els.status.textContent = state.currentPageTitle
        ? `Current page: ${state.currentPageTitle}`
        : 'Run started.';
    } else if (isTerminal) {
      els.status.textContent = state.status;
    }

    if (state.articleHtml) {
      els.article.innerHTML = state.articleHtml;
    }

    els.route.textContent = state.routeTitles?.length ? state.routeTitles.join(' -> ') : '-';
  }

  function onArticleLinkClick(handler) {
    els.article.addEventListener('click', (event) => {
      const link = event.target.closest('a');
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
