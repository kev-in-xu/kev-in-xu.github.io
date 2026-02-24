async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' }
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

export function getDailyStart() {
  return fetchJson('/api/wiki/daily-start');
}

export function getWikiPageByTitle(title) {
  return fetchJson(`/api/wiki/page?title=${encodeURIComponent(title)}`);
}

export function getWikiPageByPath(path) {
  return fetchJson(`/api/wiki/page?path=${encodeURIComponent(path)}`);
}
