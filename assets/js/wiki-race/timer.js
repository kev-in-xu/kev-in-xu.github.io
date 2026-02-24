export function formatElapsedMs(ms) {
  const safe = Math.max(0, Math.floor(ms || 0));
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = safe % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function createTimer(onTick) {
  let startAt = null;
  let stopAt = null;
  let rafId = null;

  function tick() {
    if (startAt == null) return;
    const now = stopAt ?? performance.now();
    onTick(now - startAt);
    if (stopAt == null) rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (startAt != null) return;
    startAt = performance.now();
    stopAt = null;
    if (rafId == null) rafId = requestAnimationFrame(tick);
  }

  function stop() {
    if (startAt == null || stopAt != null) return getElapsedMs();
    stopAt = performance.now();
    onTick(stopAt - startAt);
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    return stopAt - startAt;
  }

  function reset() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    startAt = null;
    stopAt = null;
    onTick(0);
  }

  function getElapsedMs() {
    if (startAt == null) return 0;
    return (stopAt ?? performance.now()) - startAt;
  }

  return { start, stop, reset, getElapsedMs };
}
