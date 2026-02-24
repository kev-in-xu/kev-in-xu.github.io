import { buildWikiPagePayloadByTitle } from './_page-pipeline.js';
import { applyWikiApiCors, handleCorsPreflight } from './_cors.js';

function parseTitleOrPath(req) {
  const title = req.query?.title ? String(req.query.title).trim() : '';
  const path = req.query?.path ? String(req.query.path).trim() : '';

  if (title) return { mode: 'title', value: title };
  if (path && path.startsWith('/wiki/')) {
    return { mode: 'title', value: decodeURIComponent(path.slice('/wiki/'.length)).replace(/_/g, ' ') };
  }
  return null;
}

export default async function handler(req, res) {
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
    const payload = await buildWikiPagePayloadByTitle(parsed.value);

    if (payload.flags.isDisambiguation) {
      return res.status(422).json({
        error: 'Disambiguation pages are not allowed',
        flags: payload.flags,
        page: payload.page
      });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      page: payload.page,
      canonicalPath: payload.canonicalPath,
      displayTitle: payload.displayTitle,
      html: payload.html,
      linkIndex: payload.linkIndex,
      metrics: payload.metrics,
      flags: payload.flags,
      fetchedAtUtc: payload.fetchedAtUtc,
      cache: payload.cache,
      scaffold: false,
      todo: 'Next: add Vercel Blob cache and stricter zone selectors as heuristics are tuned.'
    });
  } catch (err) {
    return res.status(err?.status || 500).json({
      error: 'Failed to fetch or parse Wikipedia page',
      detail: String(err)
    });
  }
}
