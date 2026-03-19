import { getWikiRaceClientConfig } from './config.js';
import { getMultiplayerSnapshot } from './api-client.js';

const SUPABASE_BROWSER_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
const DEFAULT_STALE_AFTER_MS = 12000;
const DEFAULT_POLL_INTERVAL_MS = 3000;

let supabaseScriptPromise = null;

function toLobbyChannelName(lobbyCode) {
  return `wiki-race-lobby:${String(lobbyCode || '').trim().toUpperCase()}`;
}

function normalizeLobbyCode(lobbyCode) {
  return String(lobbyCode || '').trim().toUpperCase();
}

function setSafeTimeout(callback, timeoutMs) {
  return window.setTimeout(callback, timeoutMs);
}

async function ensureSupabaseBrowserClientLoaded() {
  if (window.supabase?.createClient) return window.supabase;
  if (supabaseScriptPromise) return supabaseScriptPromise;

  supabaseScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SUPABASE_BROWSER_CDN}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.supabase || null), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Supabase browser client')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = SUPABASE_BROWSER_CDN;
    script.async = true;
    script.onload = () => resolve(window.supabase || null);
    script.onerror = () => reject(new Error('Failed to load Supabase browser client'));
    document.head.appendChild(script);
  });

  return supabaseScriptPromise;
}

export async function createBrowserSupabaseClient() {
  const config = getWikiRaceClientConfig();
  if (!config.realtimeEnabled) {
    return null;
  }
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    return null;
  }

  const supabase = await ensureSupabaseBrowserClientLoaded();
  if (!supabase?.createClient) {
    return null;
  }

  return supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

// regularly poll for lobby snapshot as a fallback when realtime is unavailable or connection is lost
export function createLobbySnapshotPoller({
  lobbyCode,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  onSnapshot = () => {},
  onError = () => {}
} = {}) {
  const config = getWikiRaceClientConfig();
  const normalizedLobbyCode = normalizeLobbyCode(lobbyCode);
  let timerId = null;
  let isRunning = false;
  let inFlight = false;

  async function tick() {
    if (!isRunning || inFlight || !normalizedLobbyCode) return;
    inFlight = true;
    try {
      const snapshot = await getMultiplayerSnapshot(normalizedLobbyCode);
      onSnapshot(snapshot);
    } catch (err) {
      onError(err);
    } finally {
      inFlight = false;
    }
  }

  function scheduleNextTick() {
    if (!isRunning) return;
    timerId = setSafeTimeout(async () => {
      await tick();
      scheduleNextTick();
    }, intervalMs);
  }

  return {
    async start({ immediate = true } = {}) {
      if (!config.realtimeFallbackPollingEnabled) return false;
      if (isRunning || !normalizedLobbyCode) return;
      isRunning = true;
      if (immediate) {
        await tick();
      }
      scheduleNextTick();
      return true;
    },
    stop() {
      isRunning = false;
      if (timerId != null) {
        clearTimeout(timerId);
        timerId = null;
      }
    },
    isRunning() {
      return isRunning;
    }
  };
}

// factory function that creates a realtime client 
// Input: lobby code, event handlers, and config options
// Returns: client object with { connect, disconnect, getStatus, getLastEventAtUtc } functions
export function createLobbyRealtimeClient({
  lobbyCode,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  onEvent = () => {}, // passing a function
  onStatusChange = () => {},
  onError = () => {}
} = {}) {
  const normalizedLobbyCode = normalizeLobbyCode(lobbyCode);
  let supabaseClient = null;
  let channel = null;
  let status = 'idle';
  let lastEventAtMs = null;
  let staleTimerId = null;

  function emitStatus(nextStatus, extra = {}) {
    status = nextStatus;
    onStatusChange({
      status,
      lobbyCode: normalizedLobbyCode,
      lastEventAtUtc: lastEventAtMs ? new Date(lastEventAtMs).toISOString() : null,
      ...extra
    });
  }

  function clearStaleTimer() {
    if (staleTimerId != null) {
      clearTimeout(staleTimerId);
      staleTimerId = null;
    }
  }

  function scheduleStaleTimer() {
    clearStaleTimer();
    if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) return;
    staleTimerId = setSafeTimeout(() => {
      if (status === 'subscribed') {
        emitStatus('stale');
      }
    }, staleAfterMs);
  }

  async function connect() {
    if (!normalizedLobbyCode) {
      emitStatus('error', { error: 'Invalid lobby code' });
      return false;
    }

    try {
      emitStatus('subscribing');
      supabaseClient = await createBrowserSupabaseClient();
      if (!supabaseClient) {
        emitStatus('disabled');
        return false;
      }

      channel = supabaseClient.channel(toLobbyChannelName(normalizedLobbyCode), {
        config: {
          broadcast: {
            self: false
          }
        }
      });

      channel
        .on('broadcast', { event: '*' }, (payload) => {
          lastEventAtMs = Date.now();
          if (status === 'stale') {
            emitStatus('subscribed', { recovered: true });
          } else if (status !== 'subscribed') {
            emitStatus('subscribed');
          }
          scheduleStaleTimer();
          onEvent(payload?.payload || payload || {});
        })
        .subscribe((nextStatus) => {
          if (nextStatus === 'SUBSCRIBED') {
            emitStatus('subscribed');
            scheduleStaleTimer();
            return;
          }
          if (nextStatus === 'CHANNEL_ERROR' || nextStatus === 'TIMED_OUT') {
            clearStaleTimer();
            emitStatus('disconnected', { detail: nextStatus });
            onError(new Error(`Realtime channel status: ${nextStatus}`));
            return;
          }
          if (nextStatus === 'CLOSED') {
            clearStaleTimer();
            emitStatus('closed');
          }
        });

      return true;
    } catch (err) {
      clearStaleTimer();
      emitStatus('error', { error: err?.message || 'Failed to connect realtime channel' });
      onError(err);
      return false;
    }
  }

  async function disconnect() {
    clearStaleTimer();
    if (supabaseClient && channel) {
      try {
        await supabaseClient.removeChannel(channel);
      } catch (_err) {
        // Ignore close failures; local state still resets.
      }
    }
    channel = null;
    supabaseClient = null;
    emitStatus('idle');
  }

  return {
    connect,
    disconnect,
    getStatus() {
      return status;
    },
    getLastEventAtUtc() {
      return lastEventAtMs ? new Date(lastEventAtMs).toISOString() : null;
    }
  };
}
