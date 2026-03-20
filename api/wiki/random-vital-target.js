import { applyWikiApiCors, handleCorsPreflight } from './_cors.js';
import { fetchRandomVitalPageRef } from './_mw.js';

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  applyWikiApiCors(req, res);

  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const endPage = await fetchRandomVitalPageRef();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ endPage });
  } catch (err) {
    return res.status(err?.status || 502).json({
      error: err?.message || 'Failed to resolve random vital target',
      detail: err?.detail || null
    });
  }
}
