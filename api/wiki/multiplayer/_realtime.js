import { isWikiRaceRealtimeEnabled } from '../_flags.js';
import { getSupabaseServiceClient } from '../_supabase.js';

const REALTIME_SUBSCRIBE_TIMEOUT_MS = 6000;

function toLobbyChannelName(lobbyCode) {
  return `wiki-race-lobby:${String(lobbyCode || '').trim().toUpperCase()}`;
}

async function waitForChannelSubscribed(channel) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Realtime subscribe timeout'));
    }, REALTIME_SUBSCRIBE_TIMEOUT_MS);

    channel.subscribe((status) => {
      if (settled) return;
      if (status === 'SUBSCRIBED') {
        settled = true;
        clearTimeout(timer);
        resolve();
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Realtime channel status: ${status}`));
      }
    });
  });
}

export async function publishLobbyEvent({
  lobbyCode,
  event,
  payload = {}
} = {}) {
  if (!isWikiRaceRealtimeEnabled()) {
    return { ok: false, skipped: true, reason: 'realtime_disabled' };
  }

  const normalizedLobbyCode = String(lobbyCode || '').trim().toUpperCase();
  const normalizedEvent = String(event || '').trim();
  if (!normalizedLobbyCode || !normalizedEvent) {
    return { ok: false, skipped: true, reason: 'invalid_event' };
  }

  const supabaseClient = await getSupabaseServiceClient();
  if (!supabaseClient) {
    return { ok: false, skipped: true, reason: 'supabase_unconfigured' };
  }

  const channel = supabaseClient.channel(toLobbyChannelName(normalizedLobbyCode), {
    config: {
      broadcast: {
        ack: false,
        self: false
      }
    }
  });

  try {
    // block until subscription is active before sending, 
    // to ensure message is received by current subscribers 
    // (e.g. lobby host waiting for player_joined event after creating a lobby)
    await waitForChannelSubscribed(channel); 
    await channel.send({
      type: 'broadcast',
      event: normalizedEvent,
      payload: {
        lobbyCode: normalizedLobbyCode,
        event: normalizedEvent,
        occurredAtUtc: new Date().toISOString(),
        ...payload
      }
    });

    return { ok: true };
  } finally {
    try {
      await supabaseClient.removeChannel(channel);
    } catch (_err) {
      // Ignore cleanup failures; event send path already completed or failed.
    }
  }
}
