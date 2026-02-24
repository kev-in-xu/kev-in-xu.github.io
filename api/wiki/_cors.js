const ALLOWED_ORIGINS = new Set([
  'https://kev-in-xu.github.io',
  'http://localhost:4000',
  'http://127.0.0.1:4000',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]);

export function applyWikiApiCors(req, res) {
  const origin = req.headers?.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept');
  }
}

export function handleCorsPreflight(req, res) {
  applyWikiApiCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

