import { buildWikiPagePayloadByTitle } from './_page-pipeline.js';
import { applyWikiApiCors, handleCorsPreflight } from './_cors.js';
import { getCachedWikiPageByTitle, setCachedWikiPage } from './_cache.js';

/**
 * Parses incoming page query as either title or wiki path.
 * Input: request object with `query.title` or `query.path`.
 * Output: `{ mode, value }` for valid input, otherwise `null`.
 */
function parseTitleOrPath(req) {
  const title = req.query?.title ? String(req.query.title).trim() : '';
  const path = req.query?.path ? String(req.query.path).trim() : '';

  if (title) return { mode: 'title', value: title };
  if (path && path.startsWith('/wiki/')) {
    return { mode: 'title', value: decodeURIComponent(path.slice('/wiki/'.length)).replace(/_/g, ' ') };
  }
  return null;
}

/**
 * HTTP handler for `/api/wiki/page`. Called by client via api-client.js.
 * Input: GET request with `?title=...` or `?path=/wiki/...`.
 * Output: JSON page payload from cache or fresh Wikipedia fetch.
 */
export default async function handler(req, res) {
  const startedAt = Date.now();
  if (handleCorsPreflight(req, res)) return;
  applyWikiApiCors(req, res);

  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const parsed = parseTitleOrPath(req);
  if (!parsed) {
    return res.status(400).json({ error: 'Provide ?title=... or ?path=/wiki/...' });
  }

  try {
    const cacheLookupStartedAt = Date.now();
    const cachedPayload = await getCachedWikiPageByTitle(parsed.value);
    const cacheLookupMs = Date.now() - cacheLookupStartedAt;

    if (cachedPayload) { // if cache lookup successful
      if (cachedPayload.flags?.isDisambiguation) {
        return res.status(422).json({
          error: 'Disambiguation pages are not allowed',
          flags: cachedPayload.flags,
          page: cachedPayload.page,
          timingMs: {
            cacheLookupMs,
            endpointTotalMs: Date.now() - startedAt
          }
        });
      }

      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      res.setHeader('X-Wiki-Api-Total-Ms', String(Date.now() - startedAt));
      return res.status(200).json({
        ...cachedPayload,
        cache: {
          ...(cachedPayload.cache || {}),
          source: 'cache',
          hit: true
        },
        timingMs: {
          ...(cachedPayload.timingMs || {}),
          cacheLookupMs,
          endpointTotalMs: Date.now() - startedAt
        },
        todo: 'Page served from Supabase cache.'
      });
    }

    // unsuccessful cache lookup -> fetch fresh page from Wikipedia, formats, and writes to cache
    const payload = await buildWikiPagePayloadByTitle(parsed.value);

    if (payload.flags.isDisambiguation) {
      return res.status(422).json({
        error: 'Disambiguation pages are not allowed',
        flags: payload.flags,
        page: payload.page
      });
    }

    try {
      await setCachedWikiPage(parsed.value, payload); // writes
    } catch (_cacheWriteError) {
      // Non-fatal: still return fresh page if cache write fails.
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('X-Wiki-Api-Total-Ms', String(Date.now() - startedAt));
    return res.status(200).json({
      page: payload.page,
      canonicalPath: payload.canonicalPath,
      displayTitle: payload.displayTitle,
      html: payload.html,
      linkIndex: payload.linkIndex,
      metrics: payload.metrics,
      flags: payload.flags,
      timingMs: {
        ...(payload.timingMs || {}),
        endpointTotalMs: Date.now() - startedAt
      },
      fetchedAtUtc: payload.fetchedAtUtc,
      cache: {
        ...(payload.cache || {}),
        hit: false
      },
      todo: 'Page fetched from Wikipedia and written to Supabase page cache.'
    });
  } catch (err) {
    return res.status(err?.status || 500).json({
      error: 'Failed to fetch or parse Wikipedia page',
      detail: String(err)
    });
  }
}
