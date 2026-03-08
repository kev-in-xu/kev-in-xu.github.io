const MW_API = 'https://en.wikipedia.org/w/api.php';
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 4;
const MIN_RETRY_MS = 5000;

const DISALLOWED_NAMESPACES = [
  'Category:',
  'File:',
  'Help:',
  'Portal:',
  'Special:',
  'Talk:',
  'Template:',
  'Wikipedia:'
];

const REMOVE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  '.mw-editsection',
  '.reflist',
  '.references',
  'sup.reference',
  '.reference',
  '.authority-control',
  '.printfooter',
  '.catlinks',
  '.shortdescription',
  '.ambox',
  '.cmbox',
  '.fmbox',
  '.tmbox',
  '.plainlinks'
];

const STRIP_TAGS = [
  'img',
  'audio',
  'video',
  'source',
  'track',
  'map',
  'area',
  'svg',
  'math'
];

const ALLOWED_TAGS = new Set([
  'article', 'section', 'div', 'span', 'aside', 'nav',
  'p', 'br', 'hr',
  'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption',
  'blockquote', 'pre', 'code',
  'b', 'strong', 'i', 'em', 'small', 'sub', 'sup',
  'a'
]);

const REFERENCE_SECTION_TITLES = new Set([
  'references',
  'notes',
  'citations',
  'sources',
  'bibliography',
  'works cited'
]);

let inflightCount = 0;
const pendingQueue = [];
const requestCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - Date.now());
}

function backoffMs(attempt, retryAfterMs) {
  if (retryAfterMs != null) return retryAfterMs;
  const base = Math.min(30000, MIN_RETRY_MS * (2 ** attempt));
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}

function runQueued(task) {
  return new Promise((resolve, reject) => {
    pendingQueue.push({ task, resolve, reject });
    drainQueue();
  });
}

function drainQueue() {
  while (inflightCount < MAX_CONCURRENT && pendingQueue.length) {
    const entry = pendingQueue.shift();
    inflightCount += 1;
    Promise.resolve()
      .then(entry.task)
      .then((result) => entry.resolve(result))
      .catch((err) => entry.reject(err))
      .finally(() => {
        inflightCount -= 1;
        drainQueue();
      });
  }
}

function createMwApiUrl(params) {
  const url = new URL(MW_API);
  Object.entries({
    format: 'json',
    origin: '*',
    ...params
  }).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchWithRetries(url) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json'
      },
      mode: 'cors'
    });

    if (response.status === 429 || response.status === 503) {
      if (attempt >= MAX_RETRIES) {
        const err = new Error(`MediaWiki request failed (${response.status})`);
        err.status = response.status;
        throw err;
      }
      const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
      await sleep(backoffMs(attempt, retryAfterMs));
      continue;
    }

    if (!response.ok) {
      const err = new Error(`MediaWiki request failed (${response.status})`);
      err.status = response.status;
      throw err;
    }

    return response.json();
  }

  throw new Error('Unexpected MediaWiki retry exit');
}

function fetchMwJsonCached(params) {
  const url = createMwApiUrl(params);
  if (requestCache.has(url)) return requestCache.get(url);
  const promise = runQueued(() => fetchWithRetries(url))
    .catch((err) => {
      requestCache.delete(url);
      throw err;
    });
  requestCache.set(url, promise);
  return promise;
}

function toWikiPageRef({ title, pageid }) {
  const normalizedTitle = String(title || '').replace(/ /g, '_');
  const path = `/wiki/${encodeURIComponent(normalizedTitle).replace(/%3A/g, ':')}`;
  return {
    title: String(title || normalizedTitle.replace(/_/g, ' ')),
    normalizedTitle,
    path,
    url: `https://en.wikipedia.org${path}`,
    pageId: pageid
  };
}

function isListLikeTitle(title) {
  const value = String(title || '').trim().toLowerCase();
  return value.startsWith('list of ') || value.startsWith('lists of ');
}

function isDisallowedNamespaceTitle(title) {
  return DISALLOWED_NAMESPACES.some((prefix) => String(title || '').startsWith(prefix));
}

function computePageFlags({ title, categories = [], pageprops = {}, validOutboundLinkCount = 0, html = '' }) {
  const categoryTitles = categories.map((c) => String(c.title || '').toLowerCase());
  const htmlLower = String(html || '').toLowerCase();

  const isDisambiguation =
    Boolean(pageprops.disambiguation) ||
    categoryTitles.some((c) => c.includes('disambiguation')) ||
    htmlLower.includes('may refer to');

  const isListLike =
    isListLikeTitle(title) ||
    categoryTitles.some((c) => c.includes('lists'));

  const isStubLike =
    categoryTitles.some((c) => c.includes('stubs')) ||
    htmlLower.includes('stub');

  const isDeadEnd = validOutboundLinkCount < 1;

  return {
    isDisambiguation,
    isListLike,
    isStubLike,
    isDeadEnd
  };
}

function stripHtmlTags(text) {
  return String(text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function headingText(el) {
  return stripHtmlTags(el?.textContent || '').toLowerCase();
}

function removeReferenceSections(root) {
  const headings = Array.from(root.querySelectorAll('h2, h3'));
  headings.forEach((heading) => {
    const title = headingText(heading);
    if (!REFERENCE_SECTION_TITLES.has(title)) return;

    let cursor = heading.nextElementSibling;
    while (cursor) {
      const next = cursor.nextElementSibling;
      const tagName = String(cursor.tagName || '').toLowerCase();
      if (tagName === 'h2') break;
      cursor.remove();
      cursor = next;
    }
    heading.remove();
  });
}

function normalizeAndValidateWikiPath(href) {
  if (!href) return null;
  try {
    const raw = String(href).trim();
    if (!raw || raw.startsWith('#')) return null;

    let url;
    if (raw.startsWith('./')) {
      if (raw.includes('?') || raw.includes('#')) return null;
      url = new URL(`/wiki/${raw.slice(2)}`, 'https://en.wikipedia.org');
    } else {
      url = new URL(raw, 'https://en.wikipedia.org');
    }

    if (url.hostname !== 'en.wikipedia.org') return null;
    if (!url.pathname.startsWith('/wiki/')) return null;
    if (url.hash || url.search) return null;

    const slug = decodeURIComponent(url.pathname.slice('/wiki/'.length));
    if (!slug) return null;
    if (slug.includes(':') && !slug.startsWith('Category:')) return null;

    return `/wiki/${encodeURIComponent(slug).replace(/%2F/g, '/')}`;
  } catch (_err) {
    return null;
  }
}

function cleanupAttributes(root) {
  Array.from(root.querySelectorAll('*')).forEach((el) => {
    const tagName = String(el.tagName || '').toLowerCase();

    if (!ALLOWED_TAGS.has(tagName)) {
      const fragment = document.createDocumentFragment();
      while (el.firstChild) fragment.appendChild(el.firstChild);
      el.replaceWith(fragment);
      return;
    }

    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'style') {
        el.removeAttribute(attr.name);
        return;
      }

      const keepGlobal = name.startsWith('data-') || ['class', 'id', 'title', 'lang', 'dir'].includes(name);
      if (keepGlobal) return;

      if (tagName === 'a') {
        if (name !== 'href') el.removeAttribute(attr.name);
      } else if (tagName === 'th' || tagName === 'td') {
        if (!['colspan', 'rowspan', 'scope'].includes(name)) el.removeAttribute(attr.name);
      } else {
        el.removeAttribute(attr.name);
      }
    });
  });
}

function normalizeLinks(root) {
  const linkIndex = [];
  const seen = new Set();

  Array.from(root.querySelectorAll('a')).forEach((anchor) => {
    const href = String(anchor.getAttribute('href') || '').trim();

    if (href.startsWith('#')) {
      Array.from(anchor.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const keep = ['href', 'title', 'class', 'id'].includes(name) || name.startsWith('data-');
        if (!keep) anchor.removeAttribute(attr.name);
      });
      return;
    }

    const path = normalizeAndValidateWikiPath(href);
    if (!path) {
      anchor.replaceWith(document.createTextNode(anchor.textContent || ''));
      return;
    }

    const slug = decodeURIComponent(path.slice('/wiki/'.length));
    const text = stripHtmlTags(anchor.textContent || '') || slug.replace(/_/g, ' ');
    const title = slug.replace(/_/g, ' ');

    anchor.setAttribute('href', path);
    anchor.setAttribute('data-wiki-path', path);
    Array.from(anchor.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const keep = ['href', 'title', 'data-wiki-path', 'class', 'id'].includes(name) || name.startsWith('data-');
      if (!keep) anchor.removeAttribute(attr.name);
    });

    if (!seen.has(path)) {
      linkIndex.push({
        href: path,
        path,
        title,
        normalizedTitle: slug,
        text
      });
      seen.add(path);
    }
  });

  return linkIndex;
}

function sanitizeWikiArticleHtml({ rawHtml }) {
  // Temporary debug mode: keep MediaWiki parse HTML raw (no cleanup/rewrites).
  const raw = String(rawHtml || '');
  const root = document.createElement('div');
  root.innerHTML = raw;
  const linkIndex = [];
  const seen = new Set();

  Array.from(root.querySelectorAll('a[href]')).forEach((anchor) => {
    const href = String(anchor.getAttribute('href') || '').trim();
    const path = normalizeAndValidateWikiPath(href);
    if (!path || seen.has(path)) return;

    const slug = decodeURIComponent(path.slice('/wiki/'.length));
    linkIndex.push({
      href: path,
      path,
      title: slug.replace(/_/g, ' '),
      normalizedTitle: slug,
      text: stripHtmlTags(anchor.textContent || '') || slug.replace(/_/g, ' ')
    });
    seen.add(path);
  });

  const html = [
    '<article class="wiki-race-article-body mw-parser-output">',
    raw || '<p>No article content available.</p>',
    '</article>'
  ].join('');

  return {
    html,
    linkIndex,
    metrics: {
      validOutboundLinkCount: linkIndex.length,
      hasCategories: false
    }
  };
}

function stripDisplayTitle(displayTitle, fallback) {
  const stripped = String(displayTitle || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || fallback;
}

function pageMetaFromQuery(query) {
  const pages = Object.values(query?.pages || {});
  return pages.find((page) => page && !page.missing) || null;
}

function titleFromPath(path) {
  if (!path || !String(path).startsWith('/wiki/')) return null;
  return decodeURIComponent(String(path).slice('/wiki/'.length)).replace(/_/g, ' ');
}

async function buildPayloadForTitle(title) {
  const resolvedTitle = String(title || '').trim();
  if (!resolvedTitle) {
    const err = new Error('Wikipedia page not found');
    err.status = 404;
    throw err;
  }

  const queryData = await fetchMwJsonCached({
    action: 'query',
    prop: 'info|pageprops|categories',
    inprop: 'url',
    clshow: '!hidden',
    cllimit: 'max',
    titles: resolvedTitle
  });

  const pageMeta = pageMetaFromQuery(queryData.query);
  if (!pageMeta) {
    const err = new Error('Wikipedia page not found');
    err.status = 404;
    throw err;
  }

  if (isDisallowedNamespaceTitle(pageMeta.title)) {
    const err = new Error('Disallowed page namespace');
    err.status = 422;
    throw err;
  }

  const parseData = await fetchMwJsonCached({
    action: 'parse',
    page: pageMeta.title,
    prop: 'text|displaytitle|revid'
  });

  const rawHtml = parseData?.parse?.text?.['*'] || '';
  const cleanDisplayTitle = stripDisplayTitle(parseData?.parse?.displaytitle, pageMeta.title);
  const sanitized = sanitizeWikiArticleHtml({
    rawHtml,
    displayTitle: cleanDisplayTitle,
    categories: pageMeta.categories || []
  });

  const flags = computePageFlags({
    title: pageMeta.title,
    categories: pageMeta.categories || [],
    pageprops: pageMeta.pageprops || {},
    validOutboundLinkCount: sanitized.metrics.validOutboundLinkCount,
    html: rawHtml
  });

  if (flags.isDisambiguation) {
    const err = new Error('Disambiguation pages are not allowed');
    err.status = 422;
    err.payload = {
      error: 'Disambiguation pages are not allowed',
      flags
    };
    throw err;
  }

  const pageRef = toWikiPageRef({ title: pageMeta.title, pageid: pageMeta.pageid });
  return {
    page: pageRef,
    canonicalPath: pageRef.path,
    displayTitle: cleanDisplayTitle,
    html: sanitized.html,
    linkIndex: sanitized.linkIndex,
    metrics: sanitized.metrics,
    flags,
    fetchedAtUtc: new Date().toISOString(),
    cache: {
      source: 'fresh',
      revid: parseData?.parse?.revid
    }
  };
}

export async function getBrowserWikiPageByTitle(title) {
  return buildPayloadForTitle(title);
}

export async function getBrowserWikiPageByPath(path) {
  const title = titleFromPath(path);
  if (!title) {
    const err = new Error('Provide ?title=... or ?path=/wiki/...');
    err.status = 400;
    throw err;
  }
  return buildPayloadForTitle(title);
}
