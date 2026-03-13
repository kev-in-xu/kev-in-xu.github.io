const TARGET_PREVIEW_MAX_SECTIONS = 3;
const TARGET_PREVIEW_MAX_SNIPPET_CHARS = 320;
const TARGET_PREVIEW_HIDE_DELAY_MS = 140;

function normalizePreviewText(value) {
  return String(value || '')
    .replace(/\[edit\]/gi, '')
    .replace(/\.mw-parser-output\s+\.[^{]+\{[^}]+\}(?:\s*\.mw-parser-output\s+\.[^{]+\{[^}]+\})*/gi, ' ')
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

  articleBody.querySelectorAll('.IPA, .IPA-label, .IPA-label-small, style').forEach((node) => {
    node.remove();
  });

  const snippets = [];
  const seenSnippets = new Set();
  const paragraphs = Array.from(articleBody.querySelectorAll('p'))
    .map((paragraph) => normalizePreviewText(paragraph.textContent || ''))
    .filter((text) => text.length >= 48);

  for (const paragraph of paragraphs) {
    if (snippets.length >= maxSections) break;

    const snippet = truncatePreviewText(paragraph, maxChars);
    if (!snippet || seenSnippets.has(snippet)) continue;

    seenSnippets.add(snippet);
    snippets.push({
      heading: `Snippet ${snippets.length + 1}`,
      snippet
    });
  }

  return snippets;
}

export function createTargetPreviewController({
  modeSubtitle,
  isPreviewAvailable = () => false,
  fetchPageByTitle
} = {}) {
  let requestToken = 0;
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

  function clearHideTimer() {
    if (targetPreviewHideTimer !== null) {
      clearTimeout(targetPreviewHideTimer);
      targetPreviewHideTimer = null;
    }
  }

  function render() {
    const canRenderOpen = Boolean(
      targetPreviewState.isOpen
      && isPreviewAvailable()
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

  function hideNow() {
    clearHideTimer();
    if (!targetPreviewState.isOpen) return;
    targetPreviewState.isOpen = false;
    render();
  }

  function scheduleHide() {
    clearHideTimer();
    targetPreviewHideTimer = window.setTimeout(() => {
      targetPreviewHideTimer = null;
      hideNow();
    }, TARGET_PREVIEW_HIDE_DELAY_MS);
  }

  function showNow() {
    if (!isPreviewAvailable() || !targetPreviewState.title) return;
    clearHideTimer();
    targetPreviewState.isOpen = true;
    render();
  }

  function resetState() {
    clearHideTimer();
    targetPreviewState.status = 'idle';
    targetPreviewState.title = '';
    targetPreviewState.sections = [];
    targetPreviewState.errorMessage = '';
    targetPreviewState.isOpen = false;
    render();
  }

  function setLoading(title) {
    targetPreviewState.status = 'loading';
    targetPreviewState.title = normalizePreviewText(title) || 'Unknown destination';
    targetPreviewState.sections = [];
    targetPreviewState.errorMessage = '';
    render();
  }

  function setReady(title, sections) {
    targetPreviewState.status = 'ready';
    targetPreviewState.title = normalizePreviewText(title) || 'Unknown destination';
    targetPreviewState.sections = Array.isArray(sections) ? sections : [];
    targetPreviewState.errorMessage = '';
    render();
  }

  function setError(title, message) {
    targetPreviewState.status = 'error';
    targetPreviewState.title = normalizePreviewText(title) || 'Unknown destination';
    targetPreviewState.sections = [];
    targetPreviewState.errorMessage = message || 'Target preview unavailable.';
    render();
  }

  function bindLinkEvents() {
    if (targetPreviewLinkEl) {
      targetPreviewLinkEl.removeEventListener('mouseenter', showNow);
      targetPreviewLinkEl.removeEventListener('mouseleave', scheduleHide);
      targetPreviewLinkEl.removeEventListener('focus', showNow);
      targetPreviewLinkEl.removeEventListener('blur', scheduleHide);
      targetPreviewLinkEl.removeAttribute('aria-describedby');
      targetPreviewLinkEl.classList.remove('wiki-race-destination-link');
    }

    targetPreviewLinkEl = modeSubtitle?.querySelector('a[data-role="target-page-link"]') || null;
    if (!targetPreviewLinkEl) {
      hideNow();
      return;
    }

    targetPreviewLinkEl.classList.add('wiki-race-destination-link');
    targetPreviewLinkEl.setAttribute('aria-describedby', targetPreviewEl.id);
    targetPreviewLinkEl.addEventListener('mouseenter', showNow);
    targetPreviewLinkEl.addEventListener('mouseleave', scheduleHide);
    targetPreviewLinkEl.addEventListener('focus', showNow);
    targetPreviewLinkEl.addEventListener('blur', scheduleHide);
  }

  targetPreviewEl.addEventListener('mouseenter', showNow);
  targetPreviewEl.addEventListener('mouseleave', scheduleHide);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideNow();
  });

  async function prefetch(targetPage, token) {
    const pageTitle = targetPage?.title || '';
    if (!pageTitle) {
      setError('', 'Target preview unavailable for this run.');
      return;
    }
    if (typeof fetchPageByTitle !== 'function') {
      setError(pageTitle, 'Failed to load destination preview.');
      return;
    }

    setLoading(pageTitle);

    try {
      const payload = await fetchPageByTitle(pageTitle);
      if (token != null && token !== requestToken) return;

      const sections = buildTargetSectionPreview(payload?.html || '');
      if (!sections.length) {
        setError(payload?.displayTitle || pageTitle, 'No destination sections available.');
        return;
      }

      setReady(payload?.displayTitle || pageTitle, sections);
    } catch (_err) {
      if (token != null && token !== requestToken) return;
      setError(pageTitle, 'Failed to load destination preview.');
    }
  }

  function beginRun() {
    requestToken += 1;
    resetState();
    return requestToken;
  }

  function invalidate() {
    requestToken += 1;
    resetState();
  }

  function isActiveToken(token) {
    return token === requestToken;
  }

  return {
    bindLinkEvents,
    beginRun,
    invalidate,
    isActiveToken,
    prefetch,
    render
  };
}
