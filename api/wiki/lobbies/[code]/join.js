import { applyWikiApiCors, handleCorsPreflight } from '../../_cors.js';
import { isWikiRaceMultiplayerEnabled } from '../../_flags.js';
import {
  MAX_PLAYERS_PER_LOBBY,
  createEntityId,
  formatLobbySnapshot,
  getLobbyByCode,
  getLobbyPlayers,
  isLobbyExpired,
  isPostgresUniqueViolation,
  markLobbyExpired,
  normalizeLobbyCode,
  normalizeNickname,
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

  // lobbyCode comes from the URL path param, e.g. POST /api/wiki/lobbies/ABC123/join -> { code: 'ABC123' }
  const lobbyCode = normalizeLobbyCode(req.query?.code);
  if (!lobbyCode) return badRequest(res, 'Invalid lobby code');

  const body = readJsonBody(req);
  if (!body) return badRequest(res, 'Invalid JSON body');

  const sessionId = normalizeSessionId(body.sessionId);
  const nickname = normalizeNickname(body.nickname);

  if (!sessionId) return badRequest(res, 'Invalid sessionId');
  if (!nickname) return badRequest(res, 'Invalid nickname');

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

    const existingPlayers = await getLobbyPlayers(supabaseClient, lobbyRow.id);
    const activePlayers = existingPlayers.filter((row) => !row.left_at_utc);
    const existingPlayer = activePlayers.find((row) => row.session_id === sessionId);

    if (existingPlayer) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(formatLobbySnapshot(lobbyRow, existingPlayers));
    }

    if (activePlayers.length >= MAX_PLAYERS_PER_LOBBY) {
      return res.status(409).json({ error: 'Lobby is full' });
    }

    const joinedAtUtc = new Date().toISOString();
    const playerRow = {
      id: createEntityId(),
      lobby_id: lobbyRow.id,
      session_id: sessionId,
      nickname,
      joined_at_utc: joinedAtUtc,
      left_at_utc: null,
      is_host: false
    };

    const { error: insertError } = await supabaseClient
      .from('wiki_race_lobby_players')
      .insert(playerRow);

    if (insertError) {
      if (isPostgresUniqueViolation(insertError)) {
        const latestPlayers = await getLobbyPlayers(supabaseClient, lobbyRow.id);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(formatLobbySnapshot(lobbyRow, latestPlayers));
      }

      throw insertError;
    }

    const nextPlayers = [...existingPlayers, playerRow];
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(formatLobbySnapshot(lobbyRow, nextPlayers));
  } catch (err) {
    return res.status(err?.status || 502).json({
      error: 'Failed to join lobby',
      detail: err?.message || null
    });
  }
}
