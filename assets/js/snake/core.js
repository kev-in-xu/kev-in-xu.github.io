export const State = Object.freeze({
  START: 'start',
  RUN: 'run',
  PAUSE: 'pause',
  OVER: 'over'
});

const DEFAULT_BEST_KEY = 'snake-best-v1';

const rnd = (n) => Math.floor(Math.random() * n);
const eq = (a, b) => a.x === b.x && a.y === b.y;

export function placeApple(snake, gridW, gridH) {
  while (true) {
    const p = { x: rnd(gridW), y: rnd(gridH) };
    if (!snake.some((s) => eq(s, p))) return p;
  }
}

export function isOpposite(a, b) {
  return a.x === -b.x && a.y === -b.y;
}

export function createSnakeCore({
  gridW,
  gridH,
  tickMsStart,
  tickMsMin,
  speedupEvery,
  speedupDelta,
  bestKey = DEFAULT_BEST_KEY,
  storage = window.localStorage,
  onBestScoreChange = null
}) {
  let state;
  let snake;
  let dir;
  let inputQueue;
  let apple;
  let score;
  let tickMs;
  let eaten;
  let bestScore = Number(storage.getItem(bestKey) || 0);

  function notifyBestChange() {
    if (typeof onBestScoreChange === 'function') onBestScoreChange(bestScore);
  }

  function reset() {
    state = State.START;
    const start = { x: Math.floor(gridW / 2), y: Math.floor(gridH / 2) };
    snake = [start, { x: start.x - 1, y: start.y }, { x: start.x - 2, y: start.y }];
    dir = { x: 1, y: 0 };
    inputQueue = [];
    apple = placeApple(snake, gridW, gridH);
    score = 0;
    tickMs = tickMsStart;
    eaten = 0;
  }

  function queueDirection(nextDir) {
    if (!nextDir) return;
    const last = inputQueue[inputQueue.length - 1] || dir;
    if (isOpposite(nextDir, last)) return;
    if (inputQueue.length < 2) inputQueue.push(nextDir);
    if (state === State.START) state = State.RUN;
  }

  function togglePause() {
    if (state === State.RUN) {
      state = State.PAUSE;
      return;
    }
    if (state === State.PAUSE) state = State.RUN;
  }

  function restart() {
    reset();
  }

  function start() {
    if (state === State.START) state = State.RUN;
  }

  function step() {
    if (state !== State.RUN) return;

    if (inputQueue.length) {
      const next = inputQueue.shift();
      if (!isOpposite(next, dir)) dir = next;
    }

    const head = snake[0];
    const nh = { x: head.x + dir.x, y: head.y + dir.y };

    if (nh.x < 0 || nh.x >= gridW || nh.y < 0 || nh.y >= gridH) {
      state = State.OVER;
      return;
    }

    const eating = eq(nh, apple);
    const bodyToCheck = eating ? snake : snake.slice(0, snake.length - 1);
    if (bodyToCheck.some((s) => eq(s, nh))) {
      state = State.OVER;
      return;
    }

    snake.unshift(nh);
    if (eating) {
      score += 1;
      eaten += 1;
      apple = placeApple(snake, gridW, gridH);

      if (eaten % speedupEvery === 0) {
        tickMs = Math.max(tickMsMin, Math.round(tickMs * (1 - speedupDelta)));
      }

      if (score > bestScore) {
        bestScore = score;
        storage.setItem(bestKey, String(bestScore));
        notifyBestChange();
      }
    } else {
      snake.pop();
    }
  }

  function getSnapshot() {
    return {
      state,
      snake,
      apple,
      score,
      bestScore,
      tickMs
    };
  }

  function getState() {
    return state;
  }

  function getTickMs() {
    return tickMs;
  }

  function getBestScore() {
    return bestScore;
  }

  reset();

  return {
    reset,
    restart,
    start,
    step,
    queueDirection,
    togglePause,
    getSnapshot,
    getState,
    getTickMs,
    getBestScore
  };
}
