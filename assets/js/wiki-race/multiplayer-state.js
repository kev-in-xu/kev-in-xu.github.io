import {
  createInitialMultiplayerState,
  createInitialRunState,
  getMultiplayerState,
  getRunState
} from './state.js';

// Extension of state.js that adds multiplayerState
// Returns: a new game state with multiplayer snapshot applied, 
//          and run state updated based on multiplayer round and results.
export function applyMultiplayerSnapshot(gameState, snapshot, { sessionId = null } = {}) {
  const multiplayerState = getMultiplayerState(gameState);
  const runState = getRunState(gameState);
  const players = Array.isArray(snapshot?.players) ? snapshot.players : [];
  const round = snapshot?.round || null;
  const lobby = snapshot?.lobby || null;
  const results = Array.isArray(snapshot?.results) ? snapshot.results : [];
  const currentSessionId = String(sessionId || gameState?.session?.sessionId || '').trim() || null;
  const localResult = currentSessionId
    ? results.find((row) => row?.sessionId === currentSessionId) || null
    : null;
  const nextRunStatus = round
    ? (localResult?.status === 'completed'
      ? 'won'
      : (localResult?.status === 'abandoned' || localResult?.status === 'timeout'
        ? 'abandoned'
        : (round.endedAtUtc ? 'idle' : 'running')))
    : 'idle';
  const isNewRound = Boolean(round?.id && round.id !== multiplayerState.round?.id);

  return {
    ...gameState,
    mode: 'multiplayer',
    phase: round
      ? (round.endedAtUtc ? 'results' : 'running')
      : 'lobby',
    run: round ? {
      ...(isNewRound ? createInitialRunState() : runState),
      dateKey: null,
      startPage: round.startPage || null,
      targetPage: round.endPage || null,
      runSeedLabel: round.seedHash || '--',
      status: nextRunStatus
    } : {
      ...createInitialRunState(),
      runSeedLabel: '--'
    },
    multiplayer: {
      ...multiplayerState,
      lobby,
      players,
      round,
      results,
      leaderboard: Array.isArray(snapshot?.leaderboard) ? snapshot.leaderboard : [],
      isHost: Boolean(currentSessionId && lobby?.hostSessionId === currentSessionId),
      realtime: {
        ...multiplayerState.realtime,
        lastSnapshotAtUtc: new Date().toISOString()
      }
    },
    errorMessage: null
  };
}

export function clearMultiplayerSessionState(gameState) {
  return {
    ...gameState,
    mode: 'solo',
    phase: 'idle',
    run: createInitialRunState(),
    multiplayer: createInitialMultiplayerState(),
    errorMessage: null
  };
}
