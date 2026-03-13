import { applyWikiApiCors, handleCorsPreflight } from './_cors.js';
import { getSupabaseServiceClient } from './_supabase.js';

const VALID_MODES = new Set(['agi', 'random_vital', 'seeded']);
const VALID_SEED_SOURCES = new Set(['supabase', 'memory', 'generated']);
const SEED_HASH_PATTERN = /^[a-f0-9]{24}$/i;

function readJsonBody(req) { // reads and parses JSON body from api-client
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (_err) {
      return null;
    }
  }
  return null;
}

// parsing functions for validating and normalizing incoming data fields
function toNonEmptyString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function parseUtcTimestamp(value) {
  const text = toNonEmptyString(value);
  if (!text) return null;
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function parseDateKey(value) {
  const text = toNonEmptyString(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

function parseNonNegativeInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return null;
  return Math.floor(num);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function normalizeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return VALID_MODES.has(mode) ? mode : null;
}

function normalizeSeedSource(value) {
  const seedSource = String(value || '').trim().toLowerCase();
  if (!seedSource) return null;
  return VALID_SEED_SOURCES.has(seedSource) ? seedSource : null;
}

function normalizeSeedHash(value) {
  const seedHash = String(value || '').trim().toLowerCase();
  if (!seedHash) return null;
  return SEED_HASH_PATTERN.test(seedHash) ? seedHash : null;
}

function normalizePageRef(value) {
  if (!value || typeof value !== 'object') return null;
  const title = toNonEmptyString(value.title);
  const url = toNonEmptyString(value.url);
  const normalizedTitle = toNonEmptyString(value.normalizedTitle);
  const pageIdRaw = value.pageId;
  const pageId = Number.isFinite(Number(pageIdRaw)) ? Number(pageIdRaw) : null;

  if (!title || !url) return null;
  if (!/^https?:\/\//i.test(url)) return null;

  return {
    title,
    normalizedTitle,
    url,
    pageId
  };
}

function normalizeRoute(routeValue) {
  if (!Array.isArray(routeValue) || routeValue.length === 0) return null;

  const route = [];
  for (const step of routeValue) {
    if (!step || typeof step !== 'object') return null;
    const title = toNonEmptyString(step.title);
    const path = toNonEmptyString(step.path);
    const url = toNonEmptyString(step.url);
    const moveType = toNonEmptyString(step.moveType);
    const clickCountAfterStep = parseNonNegativeInt(step.clickCountAfterStep);
    const redirectFollowed = Boolean(step.redirectFollowed);

    if (!title || !url || !moveType) return null;
    if (!/^https?:\/\//i.test(url)) return null;

    route.push({
      title,
      path,
      url,
      moveType,
      clickCountAfterStep,
      redirectFollowed
    });
  }

  return route;
}

// ultility functions for getting additional metrics
function countBacktracks(route) {
  return route.reduce((count, step) => count + (step.moveType === 'browser_back' ? 1 : 0), 0);
}

function countRedirects(route) {
  return route.reduce((count, step) => count + (step.redirectFollowed ? 1 : 0), 0);
}

function badRequest(res, message, detail) {
  return res.status(400).json({ error: message, detail });
}

// handler for api requests from api-client to submit game results.
export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  applyWikiApiCors(req, res);

  if (req.method && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseClient = await getSupabaseServiceClient();
  if (!supabaseClient) {
    return res.status(503).json({ error: 'Game result storage is not configured' });
  }

  const body = readJsonBody(req);
  if (!body) return badRequest(res, 'Invalid JSON body');

  const runId = toNonEmptyString(body.runId);
  const sessionId = toNonEmptyString(body.sessionId);
  const mode = normalizeMode(body.mode);
  const dateKeyRaw = toNonEmptyString(body.dateKey);
  const dateKey = dateKeyRaw ? parseDateKey(dateKeyRaw) : null;
  const seedSourceRaw = toNonEmptyString(body.seedSource);
  const seedSource = seedSourceRaw ? normalizeSeedSource(seedSourceRaw) : null;
  const seedHashRaw = toNonEmptyString(body.seedHash);
  const seedHash = seedHashRaw ? normalizeSeedHash(seedHashRaw) : null;
  const startedAtUtc = parseUtcTimestamp(body.startedAtUtc);
  const completedAtUtc = parseUtcTimestamp(body.completedAtUtc);
  const durationMs = parseNonNegativeInt(body.durationMs);
  const clickCount = parseNonNegativeInt(body.clickCount);

  if (!runId) return badRequest(res, 'Missing required field', 'runId');
  if (!isUuid(runId)) return badRequest(res, 'Invalid runId');
  if (!sessionId) return badRequest(res, 'Missing required field', 'sessionId');
  if (!mode) return badRequest(res, 'Invalid mode');
  if (dateKeyRaw && !dateKey) return badRequest(res, 'Invalid dateKey');
  if (seedSourceRaw && !seedSource) return badRequest(res, 'Invalid seedSource');
  if (seedHashRaw && !seedHash) return badRequest(res, 'Invalid seedHash');
  if (!startedAtUtc) return badRequest(res, 'Invalid startedAtUtc');
  if (!completedAtUtc) return badRequest(res, 'Invalid completedAtUtc');
  if (durationMs == null) return badRequest(res, 'Invalid durationMs');
  if (clickCount == null) return badRequest(res, 'Invalid clickCount');
  if (Date.parse(completedAtUtc) < Date.parse(startedAtUtc)) {
    return badRequest(res, 'completedAtUtc must be after startedAtUtc');
  }

  const startPage = normalizePageRef(body.startPage);
  const targetPage = normalizePageRef(body.targetPage);
  const route = normalizeRoute(body.route);
  if (!startPage) return badRequest(res, 'Invalid startPage');
  if (!targetPage) return badRequest(res, 'Invalid targetPage');
  if (!route) return badRequest(res, 'Invalid route');

  const firstUrl = route[0]?.url || null;
  const lastUrl = route[route.length - 1]?.url || null;
  if (firstUrl !== startPage.url) {
    return badRequest(res, 'Route does not start at startPage.url');
  }
  if (lastUrl !== targetPage.url) {
    return badRequest(res, 'Route does not end at targetPage.url');
  }

  const row = {
    run_id: runId,
    session_id: sessionId,
    mode,
    date_key: dateKey,
    seed_source: seedSource,
    seed_hash: seedHash,
    started_at_utc: startedAtUtc,
    completed_at_utc: completedAtUtc,
    duration_ms: durationMs,
    start_title: startPage.title,
    start_normalized_title: startPage.normalizedTitle,
    start_url: startPage.url,
    start_page_id: startPage.pageId,
    target_title: targetPage.title,
    target_normalized_title: targetPage.normalizedTitle,
    target_url: targetPage.url,
    target_page_id: targetPage.pageId,
    route_json: route,
    click_count: clickCount,
    backtrack_count: countBacktracks(route),
    redirect_count: countRedirects(route)
  };

  const { error } = await supabaseClient
    .from('wiki_race_win_runs')
    .upsert(row, {
      onConflict: 'run_id',
      ignoreDuplicates: true
    });

  if (error) {
    return res.status(502).json({
      error: 'Failed to persist game result',
      detail: error.message
    });
  }

  return res.status(200).json({
    ok: true,
    runId
  });
}
