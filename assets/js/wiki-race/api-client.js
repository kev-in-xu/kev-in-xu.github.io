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

export function getDailyStart({ target = 'agi', seed = null } = {}) {
  const mode = String(target || 'agi').trim() || 'agi';
  const params = new URLSearchParams();
  params.set('target', mode);
  if (seed != null && String(seed).trim()) {
    params.set('seed', String(seed).trim());
  }
  return fetchJson(buildApiUrl(`/api/wiki/daily-start?${params.toString()}`));
}

// api caller for submitting game results to the backend, which will validate and persist the data.
export async function postWinningRun(payload) {
  try {
    const response = await fetch(buildApiUrl('/api/wiki/game-result'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      mode: 'cors',
      body: JSON.stringify(payload || {})
    });

    let body = null;
    try {
      body = await response.json();
    } catch (_err) {
      body = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: body?.error || `Request failed (${response.status})`,
        payload: body
      };
    }

    return {
      ok: true,
      payload: body
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: err?.message || 'Network request failed'
    };
  }
}
