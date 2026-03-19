import { applyWikiApiCors, handleCorsPreflight } from '../../_cors.js';
import { isWikiRaceMultiplayerEnabled } from '../../_flags.js';
import { publishLobbyEvent } from '../../multiplayer/_realtime.js';
import {
  buildLobbySnapshotResponse,
  ensureRoundTimeoutResolved,
  finalizeRoundIfComplete,
  getRoundParticipants,
  getRoundResults
} from '../../multiplayer/_snapshot.js';
import {
  createEntityId,
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

function parseNonNegativeInt(value, fallback = 0) {
  if (value == null) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.floor(num);
}

async function getActiveRoundForLobby(supabaseClient, lobbyId) {
  const { data, error } = await supabaseClient
    .from('wiki_race_rounds')
    .select('id, lobby_id, seed_hash, start_path, end_path, started_at_utc, ended_at_utc, max_duration_seconds')
    .eq('lobby_id', lobbyId)
    .is('ended_at_utc', null)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function assignNewHost(supabaseClient, lobbyRow, remainingActivePlayers) {
  const nextHost = [...remainingActivePlayers]
    .sort((a, b) => Date.parse(a.joined_at_utc || 0) - Date.parse(b.joined_at_utc || 0))[0];

  if (!nextHost) return null;

  const { error: demoteError } = await supabaseClient
    .from('wiki_race_lobby_players')
    .update({ is_host: false })
    .eq('lobby_id', lobbyRow.id)
    .eq('is_host', true);
  if (demoteError) throw demoteError;

  const { error: promoteError } = await supabaseClient
    .from('wiki_race_lobby_players')
    .update({ is_host: true })
    .eq('id', nextHost.id);
  if (promoteError) throw promoteError;

  const { error: lobbyUpdateError } = await supabaseClient
    .from('wiki_race_lobbies')
    .update({ host_session_id: nextHost.session_id })
    .eq('id', lobbyRow.id);
  if (lobbyUpdateError) throw lobbyUpdateError;

  lobbyRow.host_session_id = nextHost.session_id;
  return nextHost.session_id;
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
  const clickCount = parseNonNegativeInt(body.clickCount, 0);
  if (!sessionId) return badRequest(res, 'Invalid sessionId');
  if (clickCount == null) return badRequest(res, 'Invalid clickCount');

  try {
    const lobbyRow = await getLobbyByCode(supabaseClient, lobbyCode);
    if (!lobbyRow) {
      return res.status(404).json({ error: 'Lobby not found' });
    }

    if (isLobbyExpired(lobbyRow)) {
      await markLobbyExpired(supabaseClient, lobbyRow.id);
      return res.status(410).json({ error: 'Lobby expired' });
    }

    const playerRows = await getLobbyPlayers(supabaseClient, lobbyRow.id);
    const activePlayers = playerRows.filter((row) => !row.left_at_utc);
    const leavingPlayer = activePlayers.find((row) => row.session_id === sessionId);
    if (!leavingPlayer) {
      return res.status(404).json({ error: 'Player not found in lobby' });
    }

    const activeRound = await getActiveRoundForLobby(supabaseClient, lobbyRow.id);
    if (activeRound) {
      await ensureRoundTimeoutResolved(supabaseClient, lobbyRow, playerRows, activeRound);
    }

    const leftAtUtc = new Date().toISOString();
    const { error: leaveUpdateError } = await supabaseClient
      .from('wiki_race_lobby_players')
      .update({ left_at_utc: leftAtUtc, is_host: false })
      .eq('id', leavingPlayer.id)
      .is('left_at_utc', null);
    if (leaveUpdateError) throw leaveUpdateError;

    const nextPlayerRows = playerRows.map((row) => (
      row.id === leavingPlayer.id
        ? { ...row, left_at_utc: leftAtUtc, is_host: false }
        : row
    ));
    const remainingActivePlayers = nextPlayerRows.filter((row) => !row.left_at_utc);
    let didSubmitAbandon = false;
    let didEndRound = false;

    if (activeRound && !activeRound.ended_at_utc) {
      const participants = getRoundParticipants(nextPlayerRows, activeRound);
      const leavingWasParticipant = participants.some((row) => row.session_id === sessionId);
      if (leavingWasParticipant) {
        const resultRows = await getRoundResults(supabaseClient, activeRound.id);
        const alreadySubmitted = resultRows.some((row) => row.session_id === sessionId);

        if (!alreadySubmitted) {
          const abandonRow = {
            id: createEntityId(),
            round_id: activeRound.id,
            session_id: sessionId,
            nickname: leavingPlayer.nickname,
            status: 'abandoned',
            duration_ms: null,
            click_count: clickCount,
            submitted_at_utc: leftAtUtc,
            source: 'client_reported'
          };

          const { error: abandonError } = await supabaseClient
            .from('wiki_race_round_results')
            .upsert(abandonRow, {
              onConflict: 'round_id,session_id'
            });
          if (abandonError) throw abandonError;
          didSubmitAbandon = true;
        }

        await finalizeRoundIfComplete(supabaseClient, lobbyRow, nextPlayerRows, activeRound);
        didEndRound = Boolean(activeRound.ended_at_utc);
      }
    }

    if (remainingActivePlayers.length === 0) {
      const { error: lobbyUpdateError } = await supabaseClient
        .from('wiki_race_lobbies')
        .update({ status: 'abandoned' })
        .eq('id', lobbyRow.id);
      if (lobbyUpdateError) throw lobbyUpdateError;
      lobbyRow.status = 'abandoned';
    } else if (leavingPlayer.is_host) {
      await assignNewHost(supabaseClient, lobbyRow, remainingActivePlayers);
      for (const row of nextPlayerRows) {
        row.is_host = row.session_id === lobbyRow.host_session_id && !row.left_at_utc;
      }
    }

    await publishLobbyEvent({
      lobbyCode,
      event: 'player_left',
      payload: {
        sessionId,
        reason: 'left',
        hostSessionId: lobbyRow.host_session_id
      }
    }).catch(() => {});
    if (leavingPlayer.is_host && remainingActivePlayers.length > 0) {
      await publishLobbyEvent({
        lobbyCode,
        event: 'host_changed',
        payload: {
          sessionId: lobbyRow.host_session_id
        }
      }).catch(() => {});
    }
    if (didSubmitAbandon) {
      await publishLobbyEvent({
        lobbyCode,
        event: 'player_abandoned',
        payload: {
          roundId: activeRound?.id || null,
          sessionId,
          clickCount
        }
      }).catch(() => {});
      await publishLobbyEvent({
        lobbyCode,
        event: 'leaderboard_updated',
        payload: {
          roundId: activeRound?.id || null
        }
      }).catch(() => {});
    }
    if (didEndRound) {
      await publishLobbyEvent({
        lobbyCode,
        event: 'race_ended',
        payload: {
          roundId: activeRound?.id || null
        }
      }).catch(() => {});
    }
    const snapshot = await buildLobbySnapshotResponse(supabaseClient, lobbyRow, nextPlayerRows);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(snapshot);
  } catch (err) {
    return res.status(err?.status || 502).json({
      error: 'Failed to leave lobby',
      detail: err?.message || null
    });
  }
}
