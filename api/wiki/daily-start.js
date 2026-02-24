import { fetchMwJson, toWikiPageRef } from './_mw.js';
import { isValidStartPage } from './_filter.js';
import { buildWikiPagePayloadByTitle } from './_page-pipeline.js';
import { cacheGetJson, cacheSetJson, blobPutJson } from './_cache.js';

const TARGET_PAGE = toWikiPageRef({ title: 'Internet' });
const MAX_ATTEMPTS = 25;
const KV_PREFIX = 'wiki-race:daily-start:';

function utcDateKey(d = new Date()) {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function fetchRandomArticleTitle() {
  const data = await fetchMwJson({
    action: 'query',
    generator: 'random',
    grnnamespace: 0,
    grnlimit: 1
  });
  const pages = Object.values(data?.query?.pages || {});
  const page = pages[0];
  if (!page?.title) {
    throw new Error('Random article lookup returned no page');
  }
  return page.title;
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const dateKey = req.query?.date ? String(req.query.date) : utcDateKey();
  const cacheKey = `${KV_PREFIX}${dateKey}`;

  try {
    const cached = await cacheGetJson(cacheKey);
    if (cached?.startPage?.path && cached?.dateKey === dateKey) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({
        ...cached,
        seedSource: 'kv'
      });
    }
  } catch (_err) {
    // Fall through to generation if cache unavailable.
  }

  let acceptedPayload = null;
  let attempts = 0;
  let lastError = null;

  for (attempts = 1; attempts <= MAX_ATTEMPTS; attempts += 1) {
    try {
      const title = await fetchRandomArticleTitle();
      const payload = await buildWikiPagePayloadByTitle(title);
      if (!isValidStartPage(payload.flags, payload.page.title)) continue;
      acceptedPayload = payload;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!acceptedPayload) {
    return res.status(502).json({
      error: 'Failed to generate daily start page',
      detail: lastError ? String(lastError) : 'No valid page found within attempt limit',
      scaffold: false
    });
  }

  const startPage = acceptedPayload.page;
  const responsePayload = {
    dateKey,
    target: TARGET_PAGE,
    startPage,
    seedSource: 'generated',
    generatedAtUtc: new Date().toISOString(),
    generationAttempts: attempts,
    scaffold: false,
    todo: 'Optional next: add lock key to prevent concurrent regeneration and persist page payloads in Blob.'
  };

  try {
    await cacheSetJson(cacheKey, responsePayload);
    const blobPath = `wiki-race/daily-start/${dateKey}.json`;
    await blobPutJson(blobPath, responsePayload);
  } catch (_err) {
    // Non-fatal: daily start still returns even if cache/blob writes fail.
  }

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=60');
  return res.status(200).json(responsePayload);
}
