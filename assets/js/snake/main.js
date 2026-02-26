import { createSnakeCore, State } from './core.js';
import { attachSnakeInput } from './input.js';
import { createSnakeRenderer } from './render.js';
import { initSnakeLeaderboard } from './leaderboard.js';

const GRID_W = 15;
const GRID_H = 15;
const CELL = 20;
const CANVAS_WIDTH = GRID_W * CELL;
const CANVAS_HEIGHT = GRID_H * CELL;

const TICK_MS_START = 150;
const TICK_MS_MIN = 60;
const SPEEDUP_EVERY = 3;
const SPEEDUP_DELTA = 0.05;

const BEST_KEY = 'snake-best-v1';
const BEST_SUBMITTED_KEY = 'snake-best-submitted-v1';

const COLORS = {
  bg: '#111',
  grid: '#1b1b1b',
  head: '#15a521ff',
  body: '#137f29ff',
  apple: '#ef4444',
  text: '#e5e7eb',
  fade: 'rgba(0,0,0,0.25)'
};

function bootstrapSnake() {
  const canvas = document.getElementById('game');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;

  const ui = {
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    speed: document.getElementById('speed'),
    pauseBtn: document.getElementById('pause-btn'),
    restartBtn: document.getElementById('restart-btn')
  };
  const isTouchUi = Boolean(
    window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0
  );

  let leaderboard = null;
  let pageScrollLocked = false;
  const prevBodyOverflow = document.body.style.overflow;
  const prevHtmlOverflow = document.documentElement.style.overflow;

  function setPageScrollLocked(locked) {
    if (pageScrollLocked === locked) return;
    pageScrollLocked = locked;
    document.body.style.overflow = locked ? 'hidden' : prevBodyOverflow;
    document.documentElement.style.overflow = locked ? 'hidden' : prevHtmlOverflow;
  }

  const game = createSnakeCore({
    gridW: GRID_W,
    gridH: GRID_H,
    tickMsStart: TICK_MS_START,
    tickMsMin: TICK_MS_MIN,
    speedupEvery: SPEEDUP_EVERY,
    speedupDelta: SPEEDUP_DELTA,
    bestKey: BEST_KEY,
    onBestScoreChange(score) {
      leaderboard?.handleBestScoreChange(score);
    }
  });

  const renderer = createSnakeRenderer({
    canvas,
    ctx,
    ui,
    gridW: GRID_W,
    gridH: GRID_H,
    cell: CELL,
    tickMsStart: TICK_MS_START,
    colors: COLORS
  });

  window.SnakeGame = window.SnakeGame || {};
  window.SnakeGame.getBestScore = () => game.getBestScore();

  ui.pauseBtn?.addEventListener('click', () => {
    game.togglePause();
  });

  // for tracking time between frames and game ticks
  let last = 0;
  let acc = 0;

  function handleRestart() {
    game.restart();
    acc = 0;
    renderer.draw(game.getSnapshot());
  }

  ui.restartBtn?.addEventListener('click', handleRestart);

  attachSnakeInput({ canvas, game, onRestart: handleRestart });

  leaderboard = initSnakeLeaderboard({
    getBestScore: () => game.getBestScore(),
    bestStorageKey: BEST_KEY,
    submittedStorageKey: BEST_SUBMITTED_KEY
  });
  leaderboard.handleBestScoreChange(game.getBestScore());

  function loop(t) {
    requestAnimationFrame(loop);

    if (last === 0) last = t;
    const dt = t - last;
    last = t;

    const gameState = game.getState();
    setPageScrollLocked(isTouchUi && gameState === State.RUN);

    if (gameState === State.RUN) {
      acc += dt; // how much time has accumulated since the last tick
      while (acc >= game.getTickMs()) { // loops so we can catch up if we drop frames
        acc -= game.getTickMs(); // only subtract one tick's worth of time
        game.step();
        if (game.getState() !== State.RUN) break;
      }
    }

    renderer.draw(game.getSnapshot());
  }

  renderer.draw(game.getSnapshot());
  setPageScrollLocked(false);
  requestAnimationFrame(loop);
}

bootstrapSnake();
