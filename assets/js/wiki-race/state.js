export function createStore(initialState) {
  let state = structuredClone(initialState);
  const listeners = new Set();

  function getState() {
    return state;
  }

  function setState(partial) {
    state = { ...state, ...partial };
    listeners.forEach((listener) => listener(state));
    return state;
  }

  function updateState(updater) {
    state = updater(state);
    listeners.forEach((listener) => listener(state));
    return state;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    getState,
    setState,
    updateState,
    subscribe
  };
}

export function createInitialRunState() {
  return {
    status: 'idle',
    dateKey: null,
    targetPage: null,
    startPage: null,
    currentPage: null,
    clickCount: 0,
    runSeedLabel: 'agi',
    timerStartedAtPerfMs: null,
    timerStoppedAtPerfMs: null,
    route: [],
    history: {
      stack: [],
      cursor: -1
    }
  };
}

export function createInitialSoloState() {
  return {
    selectedMode: 'agi',
    activeRunId: null,
    seedHash: null
  };
}

export function createInitialMultiplayerState() {
  return {
    lobby: null,
    players: [],
    round: null,
    results: [],
    leaderboard: [],
    isHost: false,
    realtime: {
      channelStatus: 'idle',
      lastEventAtUtc: null,
      lastSnapshotAtUtc: null,
      isPolling: false
    }
  };
}

export function createInitialGameState() {
  return {
    mode: 'solo',
    phase: 'idle',
    session: {
      sessionId: null,
      nickname: null
    },
    run: createInitialRunState(),
    solo: createInitialSoloState(),
    multiplayer: createInitialMultiplayerState(),
    errorMessage: null,
    ui: {
      isArticleLoading: false
    }
  };
}

export function getRunState(gameState) {
  return gameState?.run || createInitialRunState();
}

export function getSoloState(gameState) {
  return gameState?.solo || createInitialSoloState();
}

export function getMultiplayerState(gameState) {
  return gameState?.multiplayer || createInitialMultiplayerState();
}
