import { titleFromWikiPath, toWikiPageRef } from './_mw.js';
import { buildWikiPagePayloadByTitle } from './_page-pipeline.js';
import { cacheGetJson, cacheSetJson, detectCacheBackends, getCachedWikiPageByTitle, setCachedWikiPage } from './_cache.js';
import { generateRandomRacePair } from './_race-seed.js';
import { isWikiRaceSeedStoreEnabled } from './_flags.js';
import { getSupabaseServiceClient } from './_supabase.js';
import { applyWikiApiCors, handleCorsPreflight } from './_cors.js';

const AGI_TARGET_PAGE = toWikiPageRef({ title: 'Artificial general intelligence' });
const CACHE_PREFIX = 'wiki-race:daily-start:';
const SEEDED_KEY_PATTERN = /^[a-f0-9]{24}$/i;

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
  if (raw === 'seeded' || raw === 'seed' || raw === 'replay') {
    return 'seeded';
  }
  if (raw === 'random_vital' || raw === 'random-vital' || raw === 'vital_random') {
    return 'random_vital';
  }
  return 'agi';
}

function normalizeSeedHash(value) {
  const seedHash = String(value || '').trim().toLowerCase();
  return SEEDED_KEY_PATTERN.test(seedHash) ? seedHash : null;
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

// converts wiki payload to api-client.js' expected response shape
function toClientDailyResponse(payload, seedSource, { seedHash = null } = {}) {
  const endPage = payload.endPage;
  return {
    dateKey: payload.dateKey,
    startPage: payload.startPage,
    endPage,
    seedSource,
    seedHash
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

async function ensurePagePayloadFromSeedRow({ title, path } = {}) {
  const fallbackTitle = String(title || '').trim() || titleFromWikiPath(path);
  if (!fallbackTitle) return null;
  return ensurePagePayloadForDaily(null, fallbackTitle);
}

/**
 * HTTP handler for `/api/wiki/daily-start`.
 * Input: GET request with optional `?date=YYYY-MM-DD`.
 * Output: JSON containing date key, start page, and end page.
 * Logic:
 * - AGI mode serves cached daily seed keyed by UTC date.
 * - random_vital mode generates fresh start/end pages per request and persists a unique run seed hash.
 */
export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  applyWikiApiCors(req, res);

  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const dateKey = req.query?.date ? String(req.query.date) : utcDateKey();
  const targetMode = parseTargetMode(req);
  const useDailyCache = targetMode === 'agi';
  const cacheKey = useDailyCache ? `${CACHE_PREFIX}${dateKey}` : null;
  const isSeedStoreEnabled = isWikiRaceSeedStoreEnabled();

  if (!isSeedStoreEnabled && (targetMode === 'random_vital' || targetMode === 'seeded')) {
    return res.status(503).json({ error: 'Seed storage is disabled' });
  }

  if (targetMode === 'seeded') {
    const seedHash = normalizeSeedHash(req.query?.seed);
    if (!seedHash) {
      return res.status(400).json({ error: 'Invalid seed key' });
    }

    const supabaseClient = await getSupabaseServiceClient();
    if (!supabaseClient) {
      return res.status(503).json({ error: 'Seed lookup is not configured' });
    }

    const { data: seedRow, error: seedLookupError } = await supabaseClient
      .from('wiki_race_random_seeds')
      .select('seed_hash, start_title, end_title, start_path, end_path, created_at_utc, metadata_json')
      .eq('seed_hash', seedHash)
      .maybeSingle();

    if (seedLookupError) {
      return res.status(502).json({
        error: 'Failed to load seeded run',
        detail: seedLookupError.message
      });
    }

    if (!seedRow) {
      return res.status(404).json({ error: 'Invalid seed key' });
    }

    let startPayload = null;
    let endPayload = null;
    try {
      startPayload = await ensurePagePayloadFromSeedRow({
        title: seedRow.start_title,
        path: seedRow.start_path
      });
      endPayload = await ensurePagePayloadFromSeedRow({
        title: seedRow.end_title,
        path: seedRow.end_path
      });
    } catch (_err) {
      startPayload = null;
      endPayload = null;
    }

    if (!startPayload?.page?.path || !endPayload?.page?.path) {
      return res.status(404).json({ error: 'Invalid seed key' });
    }

    try {
      await setCachedWikiPage(startPayload.page.normalizedTitle || startPayload.page.title, startPayload);
      await setCachedWikiPage(endPayload.page.normalizedTitle || endPayload.page.title, endPayload);
    } catch (_err) {
      // Non-fatal: seeded response still succeeds if page cache warmup fails.
    }

    const storedDateKey = seedRow?.metadata_json?.dateKey;
    const responsePayload = {
      dateKey: isDateKey(storedDateKey) ? storedDateKey : dateKey,
      startPage: startPayload.page,
      endPage: endPayload.page
    };

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(
      toClientDailyResponse(responsePayload, 'supabase', { seedHash })
    );
  }

  // looks up daily cache for AGI mode, but random_vital mode always generates fresh pages and seeds.
  if (useDailyCache && cacheKey) { 
    const { primary } = await detectCacheBackends();
    try {
      const cached = await cacheGetJson(cacheKey);
      if (cached?.startPage?.path && cached?.endPage?.path && cached?.dateKey === dateKey) {
        try {
          const startPayload = cached.startPayload || await ensurePagePayloadForDaily(cached.startPage, cached.startPage?.title);
          const endPayload = cached.endPayload || await ensurePagePayloadForDaily(
            cached.endPage,
            AGI_TARGET_PAGE.title
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
  }

  let generatedRace = null;
  try {
    generatedRace = await generateRandomRacePair({
      targetMode,
      dateKey
    });
  } catch (err) {
    return res.status(err?.status || 502).json({
      error: err?.message || 'Failed to generate race',
      detail: err?.detail || null
    });
  }

  const responsePayload = {
    dateKey,
    startPage: generatedRace.startPage,
    endPage: generatedRace.endPage,
    generatedAtUtc: new Date().toISOString(),
    generationAttempts: generatedRace.generationAttempts,
    startPayload: generatedRace.startPayload,
    endPayload: generatedRace.endPayload
  };

  try {
    if (useDailyCache && cacheKey) {
      await cacheSetJson(cacheKey, responsePayload);
    }
  } catch (_err) {
    // Non-fatal: daily start still returns even if cache writes fail.
  }

  const cacheControl = useDailyCache
    ? 'public, s-maxage=60, stale-while-revalidate=60'
    : 'no-store';
  res.setHeader('Cache-Control', cacheControl);
  return res.status(200).json(
    toClientDailyResponse(responsePayload, generatedRace.seedSource, { seedHash: generatedRace.seedHash })
  );
}
