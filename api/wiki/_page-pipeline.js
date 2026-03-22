import { fetchMwJson, toWikiPageRef } from './_mw.js';
import { computePageFlags } from '../../lib/wiki-rules.js';
import { sanitizeWikiArticleHtml } from './_sanitize.js';
import { load } from 'cheerio';

/**
 * Converts MediaWiki display title HTML into plain text.
 * Input: `displayTitle` (possibly HTML) and `fallback` title.
 * Output: Clean title string.
 * Logic: Strips tags, collapses whitespace, and falls back when empty.
 */
function stripDisplayTitle(displayTitle, fallback) {
  const $ = load('<div id="__display-title"></div>');
  $('#__display-title').html(String(displayTitle || ''));
  const stripped = $('#__display-title').text()
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || fallback;
}

// Calls parse API to get HTML and display title
async function buildWikiPagePayloadFromMeta(pageMeta) {
  const parseData = await fetchMwJson({
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
    _internal: {
      rawHtml,
      pageMeta,
      parseData
    }
  };
}

export async function buildRandomWikiPagePayloads({ limit = 5, namespace = 0 } = {}) {
  const queryData = await fetchMwJson({
    action: 'query',
    generator: 'random',
    grnnamespace: namespace,
    grnlimit: limit,
    prop: 'info|pageprops|categories',
    inprop: 'url',
    clshow: '!hidden',
    cllimit: 'max'
  });

  const pageMetas = Object.values(queryData?.query?.pages || {}).filter((pageMeta) => pageMeta && !pageMeta.missing);
  const settledPayloads = await Promise.allSettled(
    pageMetas.map((pageMeta) => buildWikiPagePayloadFromMeta(pageMeta))
  );

  return settledPayloads
    .filter((result) => result.status === 'fulfilled' && result.value)
    .map((result) => result.value);
}

/**
 * Builds a sanitized wiki page payload used by the game frontend and cache.
 * Input: Wikipedia `title` string or `titles[]`.
 * Output: Single payload for a single input title; array of payloads for array input.
 * Logic: Fetches metadata and parsed HTML, sanitizes content, computes flags, then shapes response.
 */
export async function buildWikiPagePayloadByTitle(title) {
  const isBatch = Array.isArray(title);
  const normalizedTitles = Array.from(new Set((isBatch ? title : [title])
    .map((t) => String(t || '').trim())
    .filter(Boolean)));

  if (!normalizedTitles.length) {
    const err = new Error('Wikipedia page title(s) not provided');
    err.status = 404;
    throw err;
  }

  const queryData = await fetchMwJson({
    action: 'query',
    prop: 'info|pageprops|categories',
    inprop: 'url',
    clshow: '!hidden',
    cllimit: 'max',
    titles: normalizedTitles.join('|')
  });

  const pageMetas = Object.values(queryData?.query?.pages || {}).filter((pageMeta) => pageMeta && !pageMeta.missing);
  if (!pageMetas.length && !isBatch) {
    const err = new Error('Wikipedia page not found');
    err.status = 404;
    throw err;
  }

  const payloads = [];
  for (const pageMeta of pageMetas) {
    payloads.push(await buildWikiPagePayloadFromMeta(pageMeta));
  }

  if (isBatch) return payloads;
  const payload = payloads[0] || null;
  if (!payload) {
    const err = new Error('Wikipedia page not found');
    err.status = 404;
    throw err;
  }
  return payload;
}
