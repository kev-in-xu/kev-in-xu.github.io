const DIRS = {
  ArrowUp: { x: 0, y: -1 },
  KeyW: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  KeyS: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  KeyA: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyD: { x: 1, y: 0 }
};

const SWIPE_MIN_PX = 20;

export function attachSnakeInput({ canvas, game, onRestart = null }) {
  if (!canvas || !game) return { destroy() {} };

  let touchStartX = null;
  let touchStartY = null;
  const nonPassive = { passive: false };

  function clearTouch() {
    touchStartX = null;
    touchStartY = null;
  }

  function getSwipeCode(dx, dy) {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < SWIPE_MIN_PX) return null;
    return ax > ay
      ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft')
      : (dy > 0 ? 'ArrowDown' : 'ArrowUp');
  }

  function pushInput(code) {
    const nextDir = DIRS[code];
    if (!nextDir) return;
    game.queueDirection(nextDir);
  }

  function onKeyDown(e) {
    if (e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'KeyP') {
      game.togglePause();
      return;
    }
    if (e.code === 'KeyR') {
      game.restart();
      if (typeof onRestart === 'function') onRestart();
      return;
    }
    pushInput(e.code);
  }

  function onTouchStart(e) {
    const t = e.changedTouches[0];
    if (!t) return;
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    e.preventDefault();
  }

  function onTouchMove(e) {
    e.preventDefault();
  }

  function onTouchEnd(e) {
    const t = e.changedTouches[0];
    if (!t || touchStartX == null || touchStartY == null) return;

    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const swipeCode = getSwipeCode(dx, dy);
    clearTouch();

    if (!swipeCode) {
      game.start();
      e.preventDefault();
      return;
    }

    pushInput(swipeCode);
    e.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('touchstart', onTouchStart, nonPassive);
  canvas.addEventListener('touchmove', onTouchMove, nonPassive);
  canvas.addEventListener('touchend', onTouchEnd, nonPassive);
  canvas.addEventListener('touchcancel', clearTouch);

  return {
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('touchstart', onTouchStart, nonPassive);
      canvas.removeEventListener('touchmove', onTouchMove, nonPassive);
      canvas.removeEventListener('touchend', onTouchEnd, nonPassive);
      canvas.removeEventListener('touchcancel', clearTouch);
    },
    pushInput
  };
}
