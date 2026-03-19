import { applyWikiApiCors, handleCorsPreflight } from '../../_cors.js';
import { isWikiRaceMultiplayerEnabled } from '../../_flags.js';
import { publishLobbyEvent } from '../../multiplayer/_realtime.js';
import {
  formatLobbySnapshot,
  getLobbyByCode,
  getLobbyPlayers,
  isLobbyExpired,
  markLobbyExpired,
  normalizeLobbyCode,
  normalizeSessionId,
  readJsonBody
} from '../../multiplayer/_shared.js';
import { getSupabaseServiceClient } from '../../_supabase.js';

function badRequest(res, message, detail) {
  return res.status(400).json({ error: message, detail });
}

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  applyWikiApiCors(req, res);

  if (!isWikiRaceMultiplayerEnabled()) {
    return res.status(503).json({ error: 'Multiplayer is disabled' });
  }

  if (req.method && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseClient = await getSupabaseServiceClient();
  if (!supabaseClient) {
    return res.status(503).json({ error: 'Multiplayer storage is not configured' });
  }

  const lobbyCode = normalizeLobbyCode(req.query?.code);
  if (!lobbyCode) return badRequest(res, 'Invalid lobby code');

  const body = readJsonBody(req);
  if (!body) return badRequest(res, 'Invalid JSON body');

  const sessionId = normalizeSessionId(body.sessionId);
  const targetSessionId = normalizeSessionId(body.targetSessionId);

  if (!sessionId) return badRequest(res, 'Invalid sessionId');
  if (!targetSessionId) return badRequest(res, 'Invalid targetSessionId');
  if (sessionId === targetSessionId) {
    return badRequest(res, 'Host cannot kick their own session');
  }

  try {
    const lobbyRow = await getLobbyByCode(supabaseClient, lobbyCode);
    if (!lobbyRow) {
      return res.status(404).json({ error: 'Lobby not found' });
    }

    if (isLobbyExpired(lobbyRow)) {
      await markLobbyExpired(supabaseClient, lobbyRow.id);
      return res.status(410).json({ error: 'Lobby expired' });
    }

    if (lobbyRow.status !== 'open') {
      return res.status(409).json({ error: 'Lobby already started' });
    }

    if (lobbyRow.host_session_id !== sessionId) {
      return res.status(403).json({ error: 'Only the host can kick players' });
    }

    const existingPlayers = await getLobbyPlayers(supabaseClient, lobbyRow.id);
    const activePlayers = existingPlayers.filter((row) => !row.left_at_utc);
    const targetPlayer = activePlayers.find((row) => row.session_id === targetSessionId);

    if (!targetPlayer) {
      return res.status(404).json({ error: 'Player not found in lobby' });
    }

    if (targetPlayer.is_host) {
      return res.status(409).json({ error: 'Host cannot be kicked' });
    }

    const leftAtUtc = new Date().toISOString();
    const { error: updateError } = await supabaseClient
      .from('wiki_race_lobby_players')
      .update({ left_at_utc: leftAtUtc })
      .eq('id', targetPlayer.id)
      .is('left_at_utc', null);

    if (updateError) {
      throw updateError;
    }

    const nextPlayers = existingPlayers.map((row) => (
      row.id === targetPlayer.id
        ? { ...row, left_at_utc: leftAtUtc }
        : row
    ));

    await publishLobbyEvent({
      lobbyCode,
      event: 'player_left',
      payload: {
        sessionId: targetSessionId,
        actorSessionId: sessionId,
        reason: 'kicked',
        hostSessionId: lobbyRow.host_session_id
      }
    }).catch(() => {});
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(formatLobbySnapshot(lobbyRow, nextPlayers));
  } catch (err) {
    return res.status(err?.status || 502).json({
      error: 'Failed to kick player',
      detail: err?.message || null
    });
  }
}
