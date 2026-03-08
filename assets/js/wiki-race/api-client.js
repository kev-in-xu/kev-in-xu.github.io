import { getBrowserWikiPageByPath, getBrowserWikiPageByTitle } from './mw-browser-client.js';

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

function getMwSource() {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const fromQuery = new URLSearchParams(search).get('mwSource');
  if (fromQuery === 'browser' || fromQuery === 'backend') return fromQuery;

  const root = document.getElementById('wiki-race-app');
  const fromData = root?.dataset?.mwSource?.trim();
  if (fromData === 'browser' || fromData === 'backend') return fromData;

  return 'browser';
}

export function getDailyStart() {
  return fetchJson(buildApiUrl('/api/wiki/daily-start'));
}

export function getWikiPageByTitle(title) {
  if (getMwSource() === 'browser') {
    return getBrowserWikiPageByTitle(title);
  }
  return fetchJson(buildApiUrl(`/api/wiki/page?title=${encodeURIComponent(title)}`));
}

export function getWikiPageByPath(path) {
  if (getMwSource() === 'browser') {
    return getBrowserWikiPageByPath(path);
  }
  return fetchJson(buildApiUrl(`/api/wiki/page?path=${encodeURIComponent(path)}`));
}
