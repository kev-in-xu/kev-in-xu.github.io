const ALLOWED_ORIGINS = new Set([
  'https://kev-in-xu.github.io',
  'http://localhost:4000',
  'http://127.0.0.1:4000',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]);

/**
 * Applies CORS headers when the request origin is allowlisted.
 * Input: Node-style `req` and `res`.
 * Output: No return value; mutates response headers.
 * Logic: Checks `req.headers.origin` and writes allow headers for known origins.
 */
export function applyWikiApiCors(req, res) {
  const origin = req.headers?.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept');
  }
}

/**
 * Handles OPTIONS preflight requests for wiki API endpoints.
 * Input: Node-style `req` and `res`.
 * Output: `true` if request was handled as preflight, else `false`.
 * Logic: Reuses CORS headers and returns HTTP 204 for OPTIONS.
 */
export function handleCorsPreflight(req, res) {
  applyWikiApiCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
