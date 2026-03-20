import { toWikiPageRefFromTitleOrPath } from './_mw.js';
import { applyWikiApiCors, handleCorsPreflight } from './_cors.js';
import { createOrFetchDailyRun } from './_seed-store.js';

const VALID_DAILY_MODES = new Set(['agi']);

function readJsonBody(req) {
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

function normalizeDateKey(value) {
  const dateKey = String(value || '').trim();
  if (!dateKey) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : null;
}

function normalizeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return VALID_DAILY_MODES.has(mode) ? mode : null;
}

function normalizeSeedHash(value) {
  const seedHash = String(value || '').trim().toLowerCase();
  if (!seedHash) return null;
  return /^[a-f0-9]{24}$/i.test(seedHash) ? seedHash : null;
}

function badRequest(res, message, detail = null) {
  return res.status(400).json({
    error: message,
    detail
  });
}

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  applyWikiApiCors(req, res);

  if (req.method && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = readJsonBody(req);
  if (!body) return badRequest(res, 'Invalid JSON body');

  const mode = normalizeMode(body.mode);
  const dateKey = normalizeDateKey(body.dateKey);
  const seedHash = normalizeSeedHash(body.seedHash);

  if (!mode) return badRequest(res, 'Invalid mode');
  if (!dateKey) return badRequest(res, 'Invalid dateKey');
  if (!seedHash) return badRequest(res, 'Invalid seedHash');

  try {
    const result = await createOrFetchDailyRun({
      mode,
      dateKey,
      seedHash
    });
    const runSeed = result.runSeed;
    const startPage = toWikiPageRefFromTitleOrPath({
      title: runSeed?.start_title,
      path: runSeed?.start_path
    });
    const endPage = toWikiPageRefFromTitleOrPath({
      title: runSeed?.end_title,
      path: runSeed?.end_path
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      mode,
      dateKey: result.dailyRun.dateKey,
      seedHash: result.dailyRun.seedHash,
      startPage,
      endPage,
      seedSource: 'supabase'
    });
  } catch (err) {
    return res.status(err?.status || 502).json({
      error: err?.message || 'Failed to persist daily run',
      detail: err?.detail || null
    });
  }
}
