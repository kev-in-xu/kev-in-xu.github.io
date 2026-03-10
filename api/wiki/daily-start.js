import { fetchRandomVitalPageRef, toWikiPageRef } from './_mw.js';
import { isValidStartPage } from './_filter.js';
import { buildRandomWikiPagePayloads, buildWikiPagePayloadByTitle } from './_page-pipeline.js';
import { cacheGetJson, cacheSetJson, detectCacheBackends, getCachedWikiPageByTitle, setCachedWikiPage } from './_cache.js';
import { applyWikiApiCors, handleCorsPreflight } from './_cors.js';

const AGI_TARGET_PAGE = toWikiPageRef({ title: 'Artificial general intelligence' });
const MAX_ATTEMPTS = 25;
const RANDOM_BATCH_SIZE = 5;
const CACHE_PREFIX = 'wiki-race:daily-start:';
const RANDOM_TARGET_MAX_ATTEMPTS = 20;

/**
 * Produces a UTC date key in YYYY-MM-DD format for current time or given date.
 */
function utcDateKey(d = new Date()) {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseTargetMode(req) {
  const raw = String(req.query?.target || 'agi').trim().toLowerCase();
  if (raw === 'random_vital' || raw === 'random-vital' || raw === 'vital_random') {
    return 'random_vital';
  }
  return 'agi';
}

// converts wiki payload to api-client.js' expected response shape
function toClientDailyResponse(payload, seedSource) {
  const endPage = payload.endPage;
  return {
    dateKey: payload.dateKey,
    startPage: payload.startPage,
    endPage,
    seedSource
  };
}

async function ensurePagePayloadForDaily(pageRef, fallbackTitle) {
  const queryKey = pageRef?.normalizedTitle || pageRef?.title || fallbackTitle;
  if (!queryKey) return null;

  try {
    const cached = await getCachedWikiPageByTitle(queryKey);
    if (cached?.page?.path) return cached;
  } catch (_err) {
    // Fallback to fresh fetch.
  }

  const titleToFetch = pageRef?.title || fallbackTitle;
  if (!titleToFetch) return null;
  return buildWikiPagePayloadByTitle(titleToFetch);
}

/**
 * HTTP handler for `/api/wiki/daily-start`.
 * Input: GET request with optional `?date=YYYY-MM-DD`.
 * Output: JSON containing date key, start page, and end page.
 * Logic: serves cached daily seed when available; otherwise samples random pages until one passes start-page rules, then caches result.
 */
export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  applyWikiApiCors(req, res);

  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const dateKey = req.query?.date ? String(req.query.date) : utcDateKey();
  const targetMode = parseTargetMode(req);
  const cacheKey = targetMode === 'agi'
    ? `${CACHE_PREFIX}${dateKey}`
    : `${CACHE_PREFIX}${dateKey}:target:random_vital`;
  const { primary } = await detectCacheBackends();

  try {
    const cached = await cacheGetJson(cacheKey);
    if (cached?.startPage?.path && cached?.endPage?.path && cached?.dateKey === dateKey) {
      try {
        const startPayload = cached.startPayload || await ensurePagePayloadForDaily(cached.startPage, cached.startPage?.title);
        const endPayload = cached.endPayload || await ensurePagePayloadForDaily(
          cached.endPage,
          targetMode === 'agi' ? AGI_TARGET_PAGE.title : cached.endPage?.title
        );
        if (startPayload) await setCachedWikiPage(cached.startPage.normalizedTitle || cached.startPage.title, startPayload);
        if (endPayload) await setCachedWikiPage(cached.endPage.normalizedTitle || cached.endPage.title, endPayload);

        if (!cached.startPayload || !cached.endPayload) {
          await cacheSetJson(cacheKey, {
            ...cached,
            startPayload: startPayload || cached.startPayload || null,
            endPayload: endPayload || cached.endPayload || null
          });
        }
      } catch (_err) {
        // Non-fatal: daily response still succeeds if page-cache warmup fails.
      }
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      return res.status(200).json(toClientDailyResponse(cached, primary));
    }
  } catch (_err) {
    // Fall through to generation if cache unavailable.
  }

  let acceptedPayload = null;
  let attempts = 0;
  let lastError = null;

  for (attempts = 1; attempts <= MAX_ATTEMPTS; attempts += 1) {
    try {
      const payloads = await buildRandomWikiPagePayloads({
        limit: RANDOM_BATCH_SIZE,
        namespace: 0
      });
      for (const payload of payloads) {
        if (!isValidStartPage(payload.flags, payload.page.title)) continue;
        acceptedPayload = payload;
        break;
      }
      if (acceptedPayload) break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!acceptedPayload) {
    return res.status(502).json({
      error: 'Failed to generate daily start page',
      detail: lastError ? String(lastError) : 'No valid page found within attempt limit'
    });
  }

  let endPayload = null;
  if (targetMode === 'random_vital') {
    for (let i = 0; i < RANDOM_TARGET_MAX_ATTEMPTS; i += 1) {
      let randomTargetRef = null;
      try {
        randomTargetRef = await fetchRandomVitalPageRef();
      } catch (_err) {
        randomTargetRef = null;
      }
      if (!randomTargetRef?.title) continue;

      try {
        endPayload = await getCachedWikiPageByTitle(randomTargetRef.title);
      } catch (_err) {
        endPayload = null;
      }
      if (!endPayload) {
        try {
          endPayload = await buildWikiPagePayloadByTitle(randomTargetRef.title);
        } catch (_err) {
          endPayload = null;
        }
      }
      if (!endPayload?.page?.path) continue;
      if (endPayload.page.path === acceptedPayload.page.path) {
        endPayload = null;
        continue;
      }
      if (endPayload.flags?.isDisambiguation) {
        endPayload = null;
        continue;
      }
      break;
    }
  } else {
    try {
      endPayload = await getCachedWikiPageByTitle(AGI_TARGET_PAGE.title);
    } catch (_err) {
      endPayload = null;
    }
    if (!endPayload) {
      endPayload = await buildWikiPagePayloadByTitle(AGI_TARGET_PAGE.title);
    }
  }

  if (!endPayload?.page?.path) {
    return res.status(502).json({
      error: 'Failed to generate target page',
      detail: targetMode === 'random_vital'
        ? 'random vital target fetch failed'
        : 'Failed to resolve AGI target page'
    });
  }

  const startPage = acceptedPayload.page;
  const endPage = endPayload.page;
  const responsePayload = {
    dateKey,
    startPage,
    endPage,
    generatedAtUtc: new Date().toISOString(),
    generationAttempts: attempts,
    startPayload: acceptedPayload,
    endPayload
  };

  try {
    await setCachedWikiPage(startPage.normalizedTitle || startPage.title, acceptedPayload);
    await setCachedWikiPage(endPage.normalizedTitle || endPage.title, endPayload);
    await cacheSetJson(cacheKey, responsePayload);
  } catch (_err) {
    // Non-fatal: daily start still returns even if cache writes fail.
  }

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=60');
  return res.status(200).json(toClientDailyResponse(responsePayload, 'generated'));
}
