import { applyWikiApiCors, handleCorsPreflight } from '../../_cors.js';
import { isWikiRaceMultiplayerEnabled } from '../../_flags.js';
import { publishLobbyEvent } from '../../multiplayer/_realtime.js';
import {
  buildLobbySnapshotResponse,
  ensureRoundTimeoutResolved,
  finalizeRoundIfComplete,
  getRoundById
} from '../../multiplayer/_snapshot.js';
import {
  createEntityId,
  getLobbyPlayers,
  isLobbyExpired,
  markLobbyExpired,
  normalizeSessionId,
  readJsonBody
} from '../../multiplayer/_shared.js';
import { getSupabaseServiceClient } from '../../_supabase.js';

const VALID_RESULT_STATUSES = new Set(['completed', 'abandoned', 'timeout']);

function badRequest(res, message, detail) {
  return res.status(400).json({ error: message, detail });
}

function parseRoundStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return VALID_RESULT_STATUSES.has(status) ? status : null;
}

function parseNonNegativeInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return null;
  return Math.floor(num);
}

async function getLobbyById(supabaseClient, lobbyId) {
  const { data, error } = await supabaseClient
    .from('wiki_race_lobbies')
    .select('id, lobby_code, status, host_session_id, created_at_utc, expires_at_utc')
    .eq('id', lobbyId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
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

  const roundId = String(req.query?.id || '').trim();
  if (!roundId) return badRequest(res, 'Invalid round id');

  const body = readJsonBody(req);
  if (!body) return badRequest(res, 'Invalid JSON body');

  const sessionId = normalizeSessionId(body.sessionId);
  const status = parseRoundStatus(body.status);
  const durationMsRaw = body.durationMs;
  const durationMs = durationMsRaw == null ? null : parseNonNegativeInt(durationMsRaw);
  const clickCount = parseNonNegativeInt(body.clickCount);

  if (!sessionId) return badRequest(res, 'Invalid sessionId');
  if (!status) return badRequest(res, 'Invalid status');
  if (clickCount == null) return badRequest(res, 'Invalid clickCount');
  if (status === 'completed' && durationMs == null) {
    return badRequest(res, 'Completed results require durationMs');
  }
  if (status !== 'completed' && durationMs != null) {
    return badRequest(res, `${status} results must not include durationMs`);
  }

  try {
    const roundRow = await getRoundById(supabaseClient, roundId);
    if (!roundRow) {
      return res.status(404).json({ error: 'Round not found' });
    }

    const lobbyRow = await getLobbyById(supabaseClient, roundRow.lobby_id);
    if (!lobbyRow) {
      return res.status(404).json({ error: 'Lobby not found for round' });
    }

    if (isLobbyExpired(lobbyRow)) {
      await markLobbyExpired(supabaseClient, lobbyRow.id);
      return res.status(410).json({ error: 'Lobby expired' });
    }

    const playerRows = await getLobbyPlayers(supabaseClient, lobbyRow.id);
    const activePlayers = playerRows.filter((row) => !row.left_at_utc);
    const submittingPlayer = activePlayers.find((row) => row.session_id === sessionId);
    if (!submittingPlayer) {
      return res.status(403).json({ error: 'Session is not an active player in this lobby' });
    }

    await ensureRoundTimeoutResolved(supabaseClient, lobbyRow, playerRows, roundRow);
    if (roundRow.ended_at_utc) {
      const existingSnapshot = await buildLobbySnapshotResponse(supabaseClient, lobbyRow, playerRows);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(existingSnapshot);
    }

    const submittedAtUtc = new Date().toISOString();

    const { data: existingResultRows, error: existingResultError } = await supabaseClient
      .from('wiki_race_round_results')
      .select('id')
      .eq('round_id', roundId)
      .eq('session_id', sessionId)
      .limit(1);

    if (existingResultError) throw existingResultError;

    const resultRow = {
      id: existingResultRows?.[0]?.id || createEntityId(),
      round_id: roundId,
      session_id: sessionId,
      nickname: submittingPlayer.nickname,
      status,
      duration_ms: status === 'completed' ? durationMs : null,
      click_count: clickCount,
      submitted_at_utc: submittedAtUtc,
      source: 'client_reported'
    };

    const { error: upsertError } = await supabaseClient
      .from('wiki_race_round_results')
      .upsert(resultRow, {
        onConflict: 'round_id,session_id'
      });

    if (upsertError) throw upsertError;

    await finalizeRoundIfComplete(supabaseClient, lobbyRow, playerRows, roundRow);
    const didEndRound = Boolean(roundRow.ended_at_utc);

    await publishLobbyEvent({
      lobbyCode: lobbyRow.lobby_code,
      event: status === 'completed' ? 'player_finished' : 'player_abandoned',
      payload: {
        roundId,
        sessionId,
        status,
        durationMs: status === 'completed' ? durationMs : null,
        clickCount
      }
    }).catch(() => {});
    await publishLobbyEvent({
      lobbyCode: lobbyRow.lobby_code,
      event: 'leaderboard_updated',
      payload: {
        roundId
      }
    }).catch(() => {});
    if (didEndRound) {
      await publishLobbyEvent({
        lobbyCode: lobbyRow.lobby_code,
        event: 'race_ended',
        payload: {
          roundId
        }
      }).catch(() => {});
    }

    const snapshot = await buildLobbySnapshotResponse(supabaseClient, lobbyRow, playerRows);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(snapshot);
  } catch (err) {
    return res.status(err?.status || 502).json({
      error: 'Failed to submit round result',
      detail: err?.message || null
    });
  }
}
