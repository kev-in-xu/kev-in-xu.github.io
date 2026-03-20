import { titleFromWikiPath, toWikiPageRefFromTitleOrPath } from './_mw.js';
import { buildWikiPagePayloadByTitle } from './_page-pipeline.js';
import { getCachedWikiPageByTitle, setCachedWikiPage } from './_cache.js';
import { getDailyRunRow, getRunSeedRowByHash } from './_seed-store.js';
import { isWikiRaceSeedStoreEnabled } from './_flags.js';
import { getSupabaseServiceClient } from './_supabase.js';
import { applyWikiApiCors, handleCorsPreflight } from './_cors.js';
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

// Converts a canonical run lookup into the api-client.js response shape.
function toClientRaceStartResponse(payload, seedSource, { seedHash = null } = {}) {
  const endPage = payload.endPage;
  return {
    dateKey: payload.dateKey,
    startPage: payload.startPage,
    endPage,
    seedSource,
    seedHash
  };
}

async function ensurePagePayloadForSeededRun(pageRef, fallbackTitle) {
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
  return ensurePagePayloadForSeededRun(null, fallbackTitle);
}

/**
 * HTTP handler for `/api/wiki/race-start`.
 * Input: GET request with optional `?date=YYYY-MM-DD`.
 * Output: JSON containing date key, start page, end page, and optional seed hash.
 * Logic:
 * - AGI mode reads the canonical daily run mapping and linked seed row.
 * - seeded mode resolves an existing seed row by seed hash.
 */
export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  applyWikiApiCors(req, res);

  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const dateKey = req.query?.date ? String(req.query.date) : utcDateKey();
  const targetMode = parseTargetMode(req);
  const isSeedStoreEnabled = isWikiRaceSeedStoreEnabled();

  if (targetMode === 'random_vital') {
    return res.status(400).json({
      error: 'random_vital must be generated in the browser'
    });
  }

  if (!isSeedStoreEnabled && (targetMode === 'agi' || targetMode === 'seeded')) {
    return res.status(503).json({ error: 'Seed storage is disabled' });
  }

  if (targetMode === 'agi' || targetMode === 'seeded') {
    const supabaseClient = await getSupabaseServiceClient();
    if (!supabaseClient) {
      return res.status(503).json({ error: 'Seed lookup is not configured' });
    }
  }

  if (targetMode === 'agi') {
    let dailyRun = null;
    try {
      dailyRun = await getDailyRunRow({
        mode: 'agi',
        dateKey
      });
    } catch (err) {
      return res.status(502).json({
        error: 'Failed to load AGI daily run',
        detail: err?.message || null
      });
    }

    if (!dailyRun?.seedHash) {
      return res.status(404).json({
        error: 'AGI daily run has not been instantiated',
        code: 'agi_run_missing'
      });
    }

    let seedRow = null;
    try {
      seedRow = await getRunSeedRowByHash(dailyRun.seedHash);
    } catch (err) {
      return res.status(502).json({
        error: 'Failed to load AGI daily run seed',
        detail: err?.message || null
      });
    }

    if (!seedRow) {
      return res.status(404).json({
        error: 'AGI daily run seed is missing',
        code: 'agi_run_missing'
      });
    }

    const responsePayload = {
      dateKey,
      startPage: toWikiPageRefFromTitleOrPath({
        title: seedRow.start_title || titleFromWikiPath(seedRow.start_path),
        path: seedRow.start_path
      }),
      endPage: toWikiPageRefFromTitleOrPath({
        title: seedRow.end_title || titleFromWikiPath(seedRow.end_path),
        path: seedRow.end_path
      })
    };

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(
      toClientRaceStartResponse(responsePayload, 'supabase', { seedHash: dailyRun.seedHash })
    );
  }

  if (targetMode === 'seeded') {
    const seedHash = normalizeSeedHash(req.query?.seed);
    if (!seedHash) {
      return res.status(400).json({ error: 'Invalid seed key' });
    }

    let seedRow = null;
    try {
      seedRow = await getRunSeedRowByHash(seedHash);
    } catch (err) {
      return res.status(502).json({
        error: 'Failed to load seeded run',
        detail: err?.message || null
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
      toClientRaceStartResponse(responsePayload, 'supabase', { seedHash })
    );
  }

  return res.status(400).json({ error: 'Unsupported race target' });
}
