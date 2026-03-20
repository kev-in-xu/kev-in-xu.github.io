import { applyWikiApiCors, handleCorsPreflight } from '../../_cors.js';
import { isWikiRaceMultiplayerEnabled } from '../../_flags.js';
import { areSameWikiPageRefs, normalizeWikiPageRef } from '../../_page-ref.js';
import { publishLobbyEvent } from '../../multiplayer/_realtime.js';
import { createAndPersistRunSeed } from '../../_seed-store.js';
import {
  ROUND_MAX_DURATION_SECONDS,
  createEntityId,
  formatLobbySnapshot,
  getLobbyByCode,
  getLobbyPlayers,
  isLobbyExpired,
  isPostgresUniqueViolation,
  markLobbyExpired,
  normalizeLobbyCode,
  normalizeSessionId,
  readJsonBody
} from '../../multiplayer/_shared.js';
import { getSupabaseServiceClient } from '../../_supabase.js';

function badRequest(res, message, detail) {
  return res.status(400).json({ error: message, detail });
}

function utcDateKey(d = new Date()) {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatStartResponse(lobbyRow, playerRows, roundRow, race) {
  return {
    ...formatLobbySnapshot(lobbyRow, playerRows),
    round: {
      id: roundRow.id,
      seedHash: roundRow.seed_hash,
      startedAtUtc: roundRow.started_at_utc,
      maxDurationSeconds: roundRow.max_duration_seconds,
      startPage: race.startPage,
      endPage: race.endPage
    }
  };
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
  if (!sessionId) return badRequest(res, 'Invalid sessionId');
  const startPage = normalizeWikiPageRef(body.startPage);
  const endPage = normalizeWikiPageRef(body.endPage);
  if (!startPage) return badRequest(res, 'Invalid startPage');
  if (!endPage) return badRequest(res, 'Invalid endPage');
  if (areSameWikiPageRefs(startPage, endPage)) {
    return badRequest(res, 'startPage and endPage must be different');
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
      return res.status(403).json({ error: 'Only the host can start the race' });
    }

    const existingPlayers = await getLobbyPlayers(supabaseClient, lobbyRow.id);
    const activePlayers = existingPlayers.filter((row) => !row.left_at_utc);
    const hostPlayer = activePlayers.find((row) => row.session_id === sessionId && row.is_host);
    if (!hostPlayer) {
      return res.status(409).json({ error: 'Host is not active in lobby' });
    }

    const seedResult = await createAndPersistRunSeed({
      startPage,
      endPage,
      dateKey: utcDateKey()
    });

    const startedAtUtc = new Date().toISOString();
    const { data: updatedLobbies, error: lobbyUpdateError } = await supabaseClient
      .from('wiki_race_lobbies')
      .update({ status: 'running' })
      .eq('id', lobbyRow.id)
      .eq('status', 'open')
      .eq('host_session_id', sessionId)
      .select('id, lobby_code, status, host_session_id, created_at_utc, expires_at_utc');

    if (lobbyUpdateError) {
      throw lobbyUpdateError;
    }

    const updatedLobbyRow = updatedLobbies?.[0] || null;
    if (!updatedLobbyRow) {
      return res.status(409).json({ error: 'Lobby already started' });
    }

    const roundRow = {
      id: createEntityId(),
      lobby_id: lobbyRow.id,
      seed_hash: seedResult.seedHash,
      start_path: startPage.path,
      end_path: endPage.path,
      started_at_utc: startedAtUtc,
      ended_at_utc: null,
      max_duration_seconds: ROUND_MAX_DURATION_SECONDS
    };

    const { error: roundInsertError } = await supabaseClient
      .from('wiki_race_rounds')
      .insert(roundRow);

    if (roundInsertError) {
      await supabaseClient
        .from('wiki_race_lobbies')
        .update({ status: 'open' })
        .eq('id', lobbyRow.id)
        .eq('status', 'running');

      if (isPostgresUniqueViolation(roundInsertError)) {
        return res.status(409).json({ error: 'Round already active for lobby' });
      }

      throw roundInsertError;
    }

    await publishLobbyEvent({
      lobbyCode,
      event: 'race_started',
      payload: {
        roundId: roundRow.id,
        seedHash: roundRow.seed_hash,
        hostSessionId: sessionId
      }
    }).catch(() => {});
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(
      formatStartResponse(updatedLobbyRow, existingPlayers, roundRow, { startPage, endPage })
    );
  } catch (err) {
    return res.status(err?.status || 502).json({
      error: 'Failed to start race',
      detail: err?.message || err?.detail || null
    });
  }
}
