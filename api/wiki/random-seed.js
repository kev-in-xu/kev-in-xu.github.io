import { applyWikiApiCors, handleCorsPreflight } from './_cors.js';
import { isWikiRaceSeedStoreEnabled } from './_flags.js';
import { areSameWikiPageRefs, normalizeWikiPageRef } from './_page-ref.js';
import { createAndPersistRandomRunSeed } from './_seed-store.js';

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

  if (!isWikiRaceSeedStoreEnabled()) {
    return res.status(503).json({ error: 'Seed storage is disabled' });
  }

  const body = readJsonBody(req);
  if (!body) return badRequest(res, 'Invalid JSON body');

  const startPage = normalizeWikiPageRef(body.startPage);
  const endPage = normalizeWikiPageRef(body.endPage);
  const rawDateKey = String(body.dateKey || '').trim();
  const dateKey = rawDateKey ? normalizeDateKey(rawDateKey) : null;

  if (!startPage) return badRequest(res, 'Invalid startPage');
  if (!endPage) return badRequest(res, 'Invalid endPage');
  if (rawDateKey && !dateKey) return badRequest(res, 'Invalid dateKey');
  if (areSameWikiPageRefs(startPage, endPage)) {
    return badRequest(res, 'startPage and endPage must be different');
  }

  try {
    const seedResult = await createAndPersistRandomRunSeed({
      startPage,
      endPage,
      dateKey
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      seedHash: seedResult.seedHash,
      seedSource: seedResult.seedSource
    });
  } catch (err) {
    return res.status(err?.status || 502).json({
      error: err?.message || 'Failed to persist random run seed',
      detail: err?.detail || null
    });
  }
}
