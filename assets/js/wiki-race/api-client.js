import { getWikiRaceClientConfig } from './config.js';

function buildApiUrl(pathWithQuery) {
  const base = getWikiRaceClientConfig().apiBase;
  if (!base) return pathWithQuery;
  return `${base.replace(/\/+$/, '')}${pathWithQuery}`;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch (_err) {
    return null;
  }
}

async function fetchJson(url, fetchOptions = {}) {
  const response = await fetch(url, {
    mode: 'cors',
    ...fetchOptions,
    headers: {
      Accept: 'application/json',
      ...(fetchOptions.headers || {})
    }
  });

  const body = await parseJsonResponse(response);

  if (!response.ok) {
    const message = body?.error || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = body;
    throw error;
  }

  return body;
}

async function postJson(path, payload) {
  return fetchJson(buildApiUrl(path), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    mode: 'cors',
    body: JSON.stringify(payload || {})
  });
}

export function getRaceStart({ target = 'agi', seed = null } = {}) {
  const mode = String(target || 'agi').trim() || 'agi';
  const params = new URLSearchParams();
  params.set('target', mode);
  if (seed != null && String(seed).trim()) {
    params.set('seed', String(seed).trim());
  }
  return fetchJson(buildApiUrl(`/api/wiki/race-start?${params.toString()}`));
}

export function getRandomVitalTarget() {
  return fetchJson(buildApiUrl('/api/wiki/random-vital-target'));
}

export function persistRandomRunSeed(payload) {
  return postJson('/api/wiki/random-seed', payload);
}

// api caller for submitting game results to the backend, which will validate and persist the data.
export async function postWinningRun(payload) {
  try {
    const body = await postJson('/api/wiki/game-result', payload);
    return {
      ok: true,
      payload: body
    };
  } catch (err) {
    return {
      ok: false,
      status: err?.status ?? null,
      error: err?.message || 'Network request failed',
      payload: err?.payload || null
    };
  }
}

export function createMultiplayerLobby(payload) {
  return postJson('/api/wiki/lobbies', payload);
}

export function joinMultiplayerLobby(lobbyCode, payload) {
  return postJson(`/api/wiki/lobbies/${encodeURIComponent(String(lobbyCode || '').trim())}/join`, payload);
}

export function kickMultiplayerPlayer(lobbyCode, payload) {
  return postJson(`/api/wiki/lobbies/${encodeURIComponent(String(lobbyCode || '').trim())}/kick`, payload);
}

export function leaveMultiplayerLobby(lobbyCode, payload) {
  return postJson(`/api/wiki/lobbies/${encodeURIComponent(String(lobbyCode || '').trim())}/leave`, payload);
}

export function startMultiplayerLobby(lobbyCode, payload) {
  return postJson(`/api/wiki/lobbies/${encodeURIComponent(String(lobbyCode || '').trim())}/start`, payload);
}

export function getMultiplayerSnapshot(lobbyCode) {
  return fetchJson(buildApiUrl(`/api/wiki/lobbies/${encodeURIComponent(String(lobbyCode || '').trim())}/snapshot`));
}

export async function submitMultiplayerRoundResult(roundId, payload) {
  try {
    const body = await postJson(`/api/wiki/rounds/${encodeURIComponent(String(roundId || '').trim())}/finish`, payload);
    return {
      ok: true,
      payload: body
    };
  } catch (err) {
    return {
      ok: false,
      status: err?.status ?? null,
      error: err?.message || 'Network request failed',
      payload: err?.payload || null
    };
  }
}

export async function safePostJson(path, payload) {
  try {
    const body = await postJson(path, payload);
    return {
      ok: true,
      payload: body
    };
  } catch (err) {
    if (typeof err?.status === 'number') {
      return {
        ok: false,
        status: err.status,
        error: err?.message || `Request failed (${err.status})`,
        payload: err?.payload || null
      };
    }
    return {
      ok: false,
      status: null,
      error: err?.message || 'Network request failed'
    };
  }
}
