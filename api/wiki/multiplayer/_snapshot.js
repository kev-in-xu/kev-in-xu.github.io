import { toWikiPageRefFromTitleOrPath } from '../_mw.js';
import { createEntityId, formatLobbySnapshot } from './_shared.js';

function compareLeaderboardRows(a, b) {
  const aCompleted = a.status === 'completed';
  const bCompleted = b.status === 'completed';
  if (aCompleted !== bCompleted) return aCompleted ? -1 : 1;

  if (aCompleted && bCompleted) {
    const durationDelta = Number(a.duration_ms || 0) - Number(b.duration_ms || 0);
    if (durationDelta !== 0) return durationDelta;
  }

  const submittedDelta = Date.parse(a.submitted_at_utc || 0) - Date.parse(b.submitted_at_utc || 0);
  if (submittedDelta !== 0) return submittedDelta;

  return String(a.session_id || '').localeCompare(String(b.session_id || ''));
}

export function buildLeaderboard(resultRows = []) {
  const sortedRows = [...resultRows].sort(compareLeaderboardRows);
  let previousCompletedDuration = null;
  let previousPlacement = 0;

  return sortedRows.map((row, index) => {
    const isCompleted = row.status === 'completed';
    let placement = index + 1;
    let isTie = false;

    if (isCompleted && previousCompletedDuration != null && row.duration_ms === previousCompletedDuration) {
      placement = previousPlacement;
      isTie = true;
    }

    if (isCompleted) {
      previousCompletedDuration = row.duration_ms;
      previousPlacement = placement;
    }

    return {
      placement,
      isTie,
      sessionId: row.session_id,
      nickname: row.nickname,
      status: row.status,
      durationMs: row.duration_ms,
      clickCount: row.click_count,
      submittedAtUtc: row.submitted_at_utc,
      source: row.source
    };
  });
}

export async function getLatestLobbyRound(supabaseClient, lobbyId) {
  const { data, error } = await supabaseClient
    .from('wiki_race_rounds')
    .select('id, lobby_id, seed_hash, start_path, end_path, started_at_utc, ended_at_utc, max_duration_seconds')
    .eq('lobby_id', lobbyId)
    .order('started_at_utc', { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

export async function getRoundById(supabaseClient, roundId) {
  const { data, error } = await supabaseClient
    .from('wiki_race_rounds')
    .select('id, lobby_id, seed_hash, start_path, end_path, started_at_utc, ended_at_utc, max_duration_seconds')
    .eq('id', roundId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getSeedRow(supabaseClient, seedHash) {
  if (!seedHash) return null;
  const { data, error } = await supabaseClient
    .from('wiki_race_random_seeds')
    .select('seed_hash, start_title, end_title, start_path, end_path')
    .eq('seed_hash', seedHash)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

// Gets all per-user result for a given round
export async function getRoundResults(supabaseClient, roundId) {
  if (!roundId) return [];
  const { data, error } = await supabaseClient
    .from('wiki_race_round_results')
    .select('id, round_id, session_id, nickname, status, duration_ms, click_count, submitted_at_utc, source')
    .eq('round_id', roundId)
    .order('submitted_at_utc', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Gets current player list by parsing player and round rows and matching by start time
export function getRoundParticipants(playerRows = [], roundRow) {
  if (!roundRow?.started_at_utc) return [];
  const startedAtMs = Date.parse(roundRow.started_at_utc);
  if (!Number.isFinite(startedAtMs)) return [];

  return playerRows.filter((row) => {
    const joinedAtMs = Date.parse(row.joined_at_utc || '');
    const leftAtMs = row.left_at_utc ? Date.parse(row.left_at_utc) : null;
    // if joined after round started, or left before round started, then not a participant in this round
    if (!Number.isFinite(joinedAtMs) || joinedAtMs > startedAtMs) return false;
    if (leftAtMs != null && Number.isFinite(leftAtMs) && leftAtMs <= startedAtMs) return false;
    return true;
  });
}


export async function finalizeRoundIfComplete(supabaseClient, lobbyRow, playerRows, roundRow, { resultRows = null } = {}) {
  if (!roundRow || roundRow.ended_at_utc) { // if round already ended, just return results without modifying anything
    return { resultRows: resultRows || [] };
  }

  // nextresultrows is either passed in (e.g. after a new submission) or fetched fresh from db (e.g. after a timeout)
  const nextResultRows = resultRows || await getRoundResults(supabaseClient, roundRow.id);
  const participants = getRoundParticipants(playerRows, roundRow); // list of participants in a round
  const participantSessionIds = new Set(participants.map((row) => row.session_id));
  const submittedSessionIds = new Set( // session ids that have submitted a result, regardless of completion or timeout status
    nextResultRows
      .map((row) => row.session_id)
      .filter((sessionId) => participantSessionIds.has(sessionId))
  );

  // if there are still participants who haven't submitted results, just return current results
  if (participants.length === 0 || submittedSessionIds.size < participants.length) {
    return { resultRows: nextResultRows };
  }

  // otherwise update round and lobby status
  const endedAtUtc = new Date().toISOString();
  const { error: roundUpdateError } = await supabaseClient
    .from('wiki_race_rounds')
    .update({ ended_at_utc: endedAtUtc }) // update round status to ended
    .eq('id', roundRow.id)
    .is('ended_at_utc', null);
  if (roundUpdateError) throw roundUpdateError;
  roundRow.ended_at_utc = endedAtUtc;

  if (lobbyRow.status === 'running') {
    const { error: lobbyUpdateError } = await supabaseClient
      .from('wiki_race_lobbies')
      .update({ status: 'ended' }) // update lobby status to completed
      .eq('id', lobbyRow.id)
      .eq('status', 'running');
    if (lobbyUpdateError) throw lobbyUpdateError;
    lobbyRow.status = 'ended';
  }

  return { resultRows: nextResultRows };
}


export async function ensureRoundTimeoutResolved(supabaseClient, lobbyRow, playerRows, roundRow) {
  if (!roundRow?.started_at_utc || roundRow.ended_at_utc) {
    return { resultRows: roundRow ? await getRoundResults(supabaseClient, roundRow.id) : [] };
  }

  const startedAtMs = Date.parse(roundRow.started_at_utc);
  const timeoutAtMs = startedAtMs + (Number(roundRow.max_duration_seconds || 0) * 1000);
  if (!Number.isFinite(timeoutAtMs) || Date.now() < timeoutAtMs) {
    return { resultRows: await getRoundResults(supabaseClient, roundRow.id) };
  }

  let resultRows = await getRoundResults(supabaseClient, roundRow.id);
  const submittedSessionIds = new Set(resultRows.map((row) => row.session_id));
  const missingParticipants = getRoundParticipants(playerRows, roundRow)
    .filter((row) => !submittedSessionIds.has(row.session_id));

  if (missingParticipants.length > 0) {
    const submittedAtUtc = new Date().toISOString();
    const timeoutRows = missingParticipants.map((row) => ({
      id: createEntityId(),
      round_id: roundRow.id,
      session_id: row.session_id,
      nickname: row.nickname,
      status: 'timeout',
      duration_ms: null,
      click_count: 0,
      submitted_at_utc: submittedAtUtc,
      source: 'server_timeout'
    }));

    const { error: upsertError } = await supabaseClient
      .from('wiki_race_round_results')
      .upsert(timeoutRows, {
        onConflict: 'round_id,session_id'
      });
    if (upsertError) throw upsertError;

    resultRows = await getRoundResults(supabaseClient, roundRow.id);
  }

  return finalizeRoundIfComplete(supabaseClient, lobbyRow, playerRows, roundRow, { resultRows });
}

export function formatRoundSnapshot(roundRow, seedRow) {
  if (!roundRow) return null;

  const startPage = toWikiPageRefFromTitleOrPath({
    title: seedRow?.start_title,
    path: seedRow?.start_path || roundRow.start_path
  });
  const endPage = toWikiPageRefFromTitleOrPath({
    title: seedRow?.end_title,
    path: seedRow?.end_path || roundRow.end_path
  });

  return {
    id: roundRow.id,
    seedHash: roundRow.seed_hash,
    startedAtUtc: roundRow.started_at_utc,
    endedAtUtc: roundRow.ended_at_utc,
    maxDurationSeconds: roundRow.max_duration_seconds,
    startPage,
    endPage
  };
}

export async function buildLobbySnapshotResponse(supabaseClient, lobbyRow, playerRows) {
  const players = Array.isArray(playerRows) ? playerRows : [];
  const roundRow = await getLatestLobbyRound(supabaseClient, lobbyRow.id);
  const { resultRows } = await ensureRoundTimeoutResolved(supabaseClient, lobbyRow, players, roundRow);
  const seedRow = roundRow?.seed_hash
    ? await getSeedRow(supabaseClient, roundRow.seed_hash)
    : null;

  return {
    ...formatLobbySnapshot(lobbyRow, players),
    round: formatRoundSnapshot(roundRow, seedRow),
    results: resultRows.map((row) => ({
      id: row.id,
      roundId: row.round_id,
      sessionId: row.session_id,
      nickname: row.nickname,
      status: row.status,
      durationMs: row.duration_ms,
      clickCount: row.click_count,
      submittedAtUtc: row.submitted_at_utc,
      source: row.source
    })),
    leaderboard: buildLeaderboard(resultRows)
  };
}
