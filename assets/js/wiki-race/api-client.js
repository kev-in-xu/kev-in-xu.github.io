function getApiBaseUrl() {
  const root = document.getElementById('wiki-race-app');
  const fromData = root?.dataset?.apiBase?.trim();
  const fromWindow = typeof window !== 'undefined' && typeof window.WIKI_RACE_API_BASE === 'string'
    ? window.WIKI_RACE_API_BASE.trim()
    : '';
  return fromWindow || fromData || '';
}

function buildApiUrl(pathWithQuery) {
  const base = getApiBaseUrl();
  if (!base) return pathWithQuery;
  return `${base.replace(/\/+$/, '')}${pathWithQuery}`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    mode: 'cors'
  });

  let body;
  try {
    body = await response.json();
  } catch (_err) {
    body = null;
  }

  if (!response.ok) {
    const message = body?.error || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = body;
    throw error;
  }

  return body;
}

export function getDailyStart({ target = 'agi' } = {}) {
  const mode = String(target || 'agi').trim() || 'agi';
  return fetchJson(buildApiUrl(`/api/wiki/daily-start?target=${encodeURIComponent(mode)}`));
}
