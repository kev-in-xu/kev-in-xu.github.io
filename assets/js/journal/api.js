import { state } from './state.js';

function apiUrl(path) {
  return `${state.apiBase}${path}`;
}

export async function apiFetch(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(json.detail || json.error || 'Request failed');
    err.status = response.status;
    throw err;
  }
  return json;
}

export function setApiBase(app) {
  const configured = app.dataset.apiBase || '';
  if (configured) {
    state.apiBase = configured.replace(/\/$/, '');
    return;
  }
  if (location.hostname === 'kev-in-xu.github.io') {
    state.apiBase = 'https://journal-api-ashy.vercel.app';
    return;
  }
  state.apiBase = '';
}
