import { fetchMwJson, toWikiPageRef } from './_mw.js';
import { computePageFlags } from './_filter.js';
import { sanitizeWikiArticleHtml } from './_sanitize.js';

/**
 * Selects the first page record from a MediaWiki query response.
 * Input: MediaWiki `query` object.
 * Output: Page object or `null`.
 * Logic: Converts `query.pages` map to array and returns the first entry.
 */
function pickPageFromQuery(query) {
  const pages = Object.values(query?.pages || {});
  return pages[0] || null;
}

/**
 * Converts MediaWiki display title HTML into plain text.
 * Input: `displayTitle` (possibly HTML) and `fallback` title.
 * Output: Clean title string.
 * Logic: Strips tags, collapses whitespace, and falls back when empty.
 */
function stripDisplayTitle(displayTitle, fallback) {
  const stripped = String(displayTitle || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || fallback;
}

/**
 * Builds a sanitized wiki page payload used by the game frontend and cache.
 * Input: Wikipedia `title`.
 * Output: Page payload with metadata, cleaned HTML, link index, metrics, and flags.
 * Logic: Fetches metadata and parsed HTML, sanitizes content, computes flags, then shapes response.
 */
export async function buildWikiPagePayloadByTitle(title) {
  const queryData = await fetchMwJson({
    action: 'query',
    prop: 'info|pageprops|categories',
    inprop: 'url',
    clshow: '!hidden',
    cllimit: 'max',
    titles: title
  });

  const pageMeta = pickPageFromQuery(queryData.query);
  if (!pageMeta || pageMeta.missing) {
    const err = new Error('Wikipedia page not found');
    err.status = 404;
    throw err;
  }

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
