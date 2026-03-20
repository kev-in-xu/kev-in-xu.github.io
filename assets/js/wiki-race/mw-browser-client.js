import {
  computePageFlags,
  isDisallowedNamespaceTitle,
  sanitizeWikiArticleHtml
} from './page-filter.js';
import { isValidStartPage } from '../../../lib/wiki-rules.js';

const MW_API = 'https://en.wikipedia.org/w/api.php';
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 4;
const MIN_RETRY_MS = 5000;
const RANDOM_START_MAX_ATTEMPTS = 25;
const RANDOM_START_BATCH_SIZE = 5;

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

function fetchMwJsonUncached(params) {
  const url = createMwApiUrl(params);
  return runQueued(() => fetchWithRetries(url));
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

function pageMetasFromQuery(query) {
  return Object.values(query?.pages || {}).filter((page) => page && !page.missing);
}

function redirectMetaFromQuery(query, requestedTitle) {
  const requested = String(requestedTitle || '').trim();
  if (!requested) {
    return { followed: false };
  }

  const redirects = Array.isArray(query?.redirects) ? query.redirects : [];
  const matched = redirects.find((entry) => String(entry?.from || '') === requested);
  if (!matched || !matched.to) {
    return { followed: false };
  }

  return {
    followed: true,
    fromTitle: String(matched.from),
    toTitle: String(matched.to)
  };
}

function titleFromPath(path) {
  if (!path || !String(path).startsWith('/wiki/')) return null;
  return decodeURIComponent(String(path).slice('/wiki/'.length)).replace(/_/g, ' ');
}

async function buildPayloadFromPageMeta(pageMeta) {
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

  //TODO consider using flags to filter disambiguation, redirect, and other non-article pages

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
    },
    redirect: { followed: false }
  };
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
    redirects: 1,
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

  const payload = await buildPayloadFromPageMeta(pageMeta);
  payload.redirect = redirectMetaFromQuery(queryData?.query, resolvedTitle);
  return payload;
}

export async function getWikiPageByTitle(title) {
  return buildPayloadForTitle(title);
}

export async function getWikiPageByPath(path) {
  const title = titleFromPath(path);
  if (!title) {
    const err = new Error('Provide ?title=... or ?path=/wiki/...');
    err.status = 400;
    throw err;
  }
  return buildPayloadForTitle(title);
}

export async function getRandomStartPage({
  maxAttempts = RANDOM_START_MAX_ATTEMPTS,
  batchSize = RANDOM_START_BATCH_SIZE,
  namespace = 0
} = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const queryData = await fetchMwJsonUncached({
        action: 'query',
        generator: 'random',
        grnnamespace: namespace,
        grnlimit: batchSize,
        prop: 'info|pageprops|categories',
        inprop: 'url',
        clshow: '!hidden',
        cllimit: 'max'
      });

      const pageMetas = pageMetasFromQuery(queryData?.query);
      const settled = await Promise.allSettled(
        pageMetas.map((pageMeta) => buildPayloadFromPageMeta(pageMeta))
      );

      for (const result of settled) {
        if (result.status !== 'fulfilled' || !result.value) continue;
        const payload = result.value;
        if (!isValidStartPage(payload.flags, payload.page.title)) continue;
        return payload;
      }
    } catch (err) {
      lastError = err;
    }
  }

  const error = new Error('Failed to generate random race start page');
  error.status = lastError?.status || 502;
  throw error;
}
