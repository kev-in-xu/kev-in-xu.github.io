import { state } from './state.js';

let authToken = '';

function apiUrl(path) {
  return `${state.apiBase}${path}`;
}

export function setAuthToken(token) {
  authToken = String(token || '');
}

export async function apiFetch(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
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
