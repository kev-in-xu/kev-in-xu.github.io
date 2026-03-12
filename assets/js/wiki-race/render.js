import { formatElapsedMs } from './timer.js';

export function createRenderer(rootEl) {
  const TOC_SCROLL_TOP_OFFSET_PX = 16;
  const LOADING_PLACEHOLDER_HTML = '<p class="wiki-race-placeholder">Loading article</p>';
  const els = {
    startBtn: rootEl.querySelector('[data-action="start"]'),
    backBtn: rootEl.querySelector('[data-action="back"]'),
    abandonBtn: rootEl.querySelector('[data-action="abandon"]'),
    timer: rootEl.querySelector('[data-field="timer"]'),
    clicks: rootEl.querySelector('[data-field="clicks"]'),
    seed: rootEl.querySelector('[data-field="seed"]'),
    stats: rootEl.querySelector('.wiki-race-stats'),
    article: rootEl.querySelector('[data-region="article"]'),
    tocPanel: rootEl.querySelector('[data-region="toc-panel"]'),
    toc: rootEl.querySelector('[data-region="toc"]'),
    route: rootEl.querySelector('[data-region="route"]')
  };
  let lastArticleHtml = null;
  let lastAllowedLinksKey = '';
  let lastRouteText = null;
  let cleanupTocSync = () => {};
  let cleanupLazyImageSync = () => {};

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
    if (els.stats) {
      let statsState = 'idle';
      if (state.status === 'running') statsState = 'running';
      if (state.status === 'won') statsState = 'complete';
      els.stats.setAttribute('data-state', statsState);
    }

    els.timer.textContent = formatElapsedMs(state.elapsedMs || 0);
    els.clicks.textContent = String(state.clickCount ?? 0);
    if (els.seed) {
      const seedLabel = String(state.runSeedLabel || '--');
      els.seed.textContent = seedLabel;
      els.seed.setAttribute('title', seedLabel);
    }

    const isRunning = state.status === 'running';
    const isLoadingStart = state.status === 'loading_start';
    const isFinished = state.status === 'won' || state.status === 'abandoned';

    els.startBtn.disabled = state.status === 'loading_start' || isRunning;
    els.backBtn.disabled = !isRunning || !state.canGoBack;
    els.abandonBtn.disabled = !isRunning;
    els.article.classList.toggle('is-finished', isFinished);

    if (isLoadingStart && !state.articleHtml) {
      if (els.article.innerHTML !== LOADING_PLACEHOLDER_HTML) {
        els.article.innerHTML = LOADING_PLACEHOLDER_HTML;
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
