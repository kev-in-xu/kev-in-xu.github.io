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

export function createInitialGameState() {
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
    },
    errorMessage: null,
    ui: {
      isArticleLoading: false
    }
  };
}
