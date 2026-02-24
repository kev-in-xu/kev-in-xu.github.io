export function createHistoryController() {
  const snapshots = [];
  let ignoreNextPop = false;

  function reset() {
    snapshots.length = 0;
    ignoreNextPop = false;
  }

  function pushSnapshot(snapshot) {
    snapshots.push(snapshot);
    window.history.pushState({ wikiRaceIdx: snapshots.length - 1 }, '', window.location.pathname + window.location.search);
  }

  function canGoBack() {
    return snapshots.length > 0;
  }

  function popSnapshot() {
    return snapshots.pop() ?? null;
  }

  function goBackViaBrowser() {
    if (!canGoBack()) return;
    ignoreNextPop = true;
    window.history.back();
  }

  function consumeIgnoreNextPop() {
    const value = ignoreNextPop;
    ignoreNextPop = false;
    return value;
  }

  return {
    reset,
    pushSnapshot,
    canGoBack,
    popSnapshot,
    goBackViaBrowser,
    consumeIgnoreNextPop
  };
}
