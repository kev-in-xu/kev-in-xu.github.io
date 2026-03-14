import { toWikiPageRefFromTitleOrPath } from '../_mw.js';
import { formatLobbySnapshot } from './_shared.js';

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
  const seedRow = roundRow?.seed_hash
    ? await getSeedRow(supabaseClient, roundRow.seed_hash)
    : null;
  const resultRows = roundRow
    ? await getRoundResults(supabaseClient, roundRow.id)
    : [];

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
