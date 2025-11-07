---
layout: single
title: Snake
permalink: /projects/snake/
author_profile: true
---

<!--
How to use on GitHub Pages (Jekyll + Minimal Mistakes):
1) Save this file as `games/snake.html` in your repo.
2) Commit & push. Visit https://<your-username>.github.io/games/snake/
3) No external assets required. Everything is in this one file.

Learning notes are sprinkled throughout as comments.
-->
Game logic originally coded in Python. Now implemented in HTML5 Canvas + JS.

How to play: Use <b>Arrow Keys</b> or <b>WASD</b> to move. Press <b>P</b> to pause/resume. Press <b>R</b> to restart.

<style>
  /* Page layout */
  .snake-wrapper { display:flex; gap:1.5rem; align-items:flex-start; flex-wrap:wrap; }
  .panel { max-width: 520px; }
  canvas { border:1px solid #333; background:#111; image-rendering: pixelated; }
  .stat { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  .btn { cursor:pointer; padding:0.5rem 0.75rem; border:1px solid #444; background:#1f1f1f; color:#eee; border-radius:8px; }
  .btn:hover { background:#2a2a2a; }
</style>

<div class="snake-wrapper">
  <div class="panel">
    <canvas id="game" aria-label="Snake game canvas" role="img"></canvas>
    <div style="margin-top:0.75rem; display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
      <span class="stat">Score: <span id="score">0</span></span>
      <span class="stat">Best: <span id="best">0</span></span>
      <span class="stat">Speed: <span id="speed">1.00x</span></span>
    </div>
  </div>

  <div class="panel">
    <h3>Learning notes</h3>
    <ol>
      <li>This is an <b>HTML5 Canvas</b> game. The canvas is a 2D grid we paint every frame.</li>
      <li>We keep an <code>inputQueue</code> (max length 2) so quick key presses aren’t lost—mirrors your Python version.</li>
      <li>The game loop uses <code>requestAnimationFrame</code> plus a fixed tick rate ("accumulator" pattern) so rendering is smooth.</li>
      <li>All logic is grid-based; rendering scales each grid cell to pixels.</li>
    </ol>
  </div>
</div>

{% raw %}
<script>
(() => {
  // ===== Game configuration =====
  // Grid settings
  const GRID_W = 15;     // grid columns
  const GRID_H = 15;     // grid rows
  const CELL   = 20;     // pixel size of a grid cell
  const CANVAS_WIDTH = GRID_W * CELL;  // calculate canvas width
  const CANVAS_HEIGHT = GRID_H * CELL; // calculate canvas height
  
  // Speed settings
  const TICK_MS_START = 150; // base speed (lower = faster)
  const TICK_MS_MIN   = 60;  // cap the minimum tick for difficulty ramp
  const SPEEDUP_EVERY = 3;   // every N apples eaten, speed up a bit
  const SPEEDUP_DELTA = 8;   // ms removed per speedup step

  // Colors
  const COLORS = {
    bg:   '#111',
    grid: '#1b1b1b',
    head: '#15a521ff', // green
    body: '#137f29ff',
    apple:'#ef4444', // red
    text: '#e5e7eb',
    fade: 'rgba(0,0,0,0.25)'
  };

  // ===== Canvas setup =====
  const canvas = document.getElementById('game');
  canvas.width = CANVAS_WIDTH;   // Set canvas size programmatically
  canvas.height = CANVAS_HEIGHT; // Set canvas size programmatically
  const ctx = canvas.getContext('2d');
  const ui = {
    score: document.getElementById('score'),
    best:  document.getElementById('best'),
    speed: document.getElementById('speed'),
  };

  // Persisted best score
  const BEST_KEY = 'snake-best-v1';
  let bestScore = Number(localStorage.getItem(BEST_KEY) || 0);
  ui.best.textContent = String(bestScore);

  // ===== Helpers =====
  const rnd = (n) => Math.floor(Math.random() * n);
  const eq  = (a,b) => a.x === b.x && a.y === b.y;

  function placeApple(snake) {
    // Pick a random empty cell
    while (true) {
      const p = { x: rnd(GRID_W), y: rnd(GRID_H) };
      if (!snake.some(s => eq(s,p))) return p;
    }
  }

  // Opposite direction check to avoid instant reverse into yourself
  function isOpposite(a, b) { return a.x === -b.x && a.y === -b.y; }

  // ===== Game State =====
  const State = {
    START: 'start',
    RUN:   'run',
    PAUSE: 'pause',
    OVER:  'over',
  };

  let state, snake, dir, inputQueue, apple, score, tickMs, eaten;
  function reset() {
    state = State.START;
    const start = { x: Math.floor(GRID_W/2), y: Math.floor(GRID_H/2) };
    snake = [start, {x:start.x-1,y:start.y}, {x:start.x-2,y:start.y}];
    dir = { x:1, y:0 }; // moving right
    inputQueue = [];
    apple = placeApple(snake);
    score = 0;
    tickMs = TICK_MS_START;
    eaten = 0;
    updateUI();
    draw();
  }

  function updateUI() {
    ui.score.textContent = String(score);
    const speedRatio = (TICK_MS_START / tickMs).toFixed(2);
    ui.speed.textContent = `${speedRatio}x`;
  }

  // ===== Input handling with a length-2 queue (like your Python set_input_queue) =====
  const DIRS = {
    ArrowUp:    {x:0,y:-1}, KeyW:{x:0,y:-1},
    ArrowDown:  {x:0,y: 1}, KeyS:{x:0,y: 1},
    ArrowLeft:  {x:-1,y:0}, KeyA:{x:-1,y:0},
    ArrowRight: {x: 1,y:0}, KeyD:{x: 1,y:0},
  };

  function pushInput(code) {
    const nd = DIRS[code];
    if (!nd) return;
    // Allow queuing up to 2 inputs; ignore if opposite of the last enqueued or current
    const last = inputQueue[inputQueue.length-1] || dir;
    if (isOpposite(nd, last)) return; // optional restriction
    if (inputQueue.length < 2) inputQueue.push(nd);

    if (state === State.START) state = State.RUN; // first input starts the game
  }

  window.addEventListener('keydown', (e) => {
    // Prevent scrolling for arrow keys
    if (e.code.startsWith('Arrow')) {
        e.preventDefault();
    }
    
    if (e.code === 'KeyP') {
        if (state === State.RUN) state = State.PAUSE; else if (state === State.PAUSE) state = State.RUN; return;
    }
    if (e.code === 'KeyR') { reset(); return; }
    pushInput(e.code);
  });

  // ===== Core step =====
  function step() {
    // apply queued input if present
    if (inputQueue.length) {
      const next = inputQueue.shift();
      if (!isOpposite(next, dir)) dir = next; // final guard
    }

    const head = snake[0];
    const nh = { x: head.x + dir.x, y: head.y + dir.y }; // new head

    // walls -> game over
    if (nh.x < 0 || nh.x >= GRID_W || nh.y < 0 || nh.y >= GRID_H) {
      state = State.OVER; return;
    }

    const eating = eq(nh, apple); // new head on apple

    // self collision: allow moving into the tail IF not eating (tail will move away)
    const bodyToCheck = eating ? snake : snake.slice(0, snake.length - 1);
    if (bodyToCheck.some(s => eq(s, nh))) { state = State.OVER; return; }

    // move
    snake.unshift(nh); // add new head
    if (eating) {
      score += 1; eaten += 1; apple = placeApple(snake);
      // speed up periodically
      if (eaten % SPEEDUP_EVERY === 0) {
        tickMs = Math.max(TICK_MS_MIN, tickMs - SPEEDUP_DELTA);
      }
      if (score > bestScore) { bestScore = score; localStorage.setItem(BEST_KEY, String(bestScore)); ui.best.textContent = String(bestScore); }
    } else {
      snake.pop(); // remove tail
    }

    updateUI();
  }

  // ===== Rendering =====
  function drawGrid() {
    ctx.fillStyle = COLORS.bg; ctx.fillRect(0,0,canvas.width, canvas.height);
    ctx.fillStyle = COLORS.grid;
    for (let y=0; y<GRID_H; y++) {
      for (let x=0; x<GRID_W; x++) {
        ctx.fillRect(x*CELL, y*CELL, 1, 1); // subtle grid dots
      }
    }
  }

  function drawSnake() {
    // draw body
    ctx.fillStyle = COLORS.body;
    for (let i=snake.length-1; i>=1; i--) {
      const s = snake[i];
      ctx.fillRect(s.x*CELL, s.y*CELL, CELL, CELL);
    }
    // draw head
    ctx.fillStyle = COLORS.head;
    const h = snake[0];
    ctx.fillRect(h.x*CELL, h.y*CELL, CELL, CELL);
  }

  function drawApple() {
    ctx.fillStyle = COLORS.apple;
    ctx.beginPath();
    const cx = apple.x*CELL + CELL/2, cy = apple.y*CELL + CELL/2;
    ctx.arc(cx, cy, CELL*0.4, 0, Math.PI*2);
    ctx.fill();
  }

  function drawOverlay(text, sub) {
    ctx.fillStyle = COLORS.fade; ctx.fillRect(0,0,canvas.width, canvas.height);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.fillText(text, canvas.width/2, canvas.height/2 - 10);
    ctx.font = '14px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    if (sub) ctx.fillText(sub, canvas.width/2, canvas.height/2 + 20);
  }

  function draw() {
    drawGrid();
    drawSnake();
    drawApple();

    if (state === State.START) {
      drawOverlay('Press WASD or Arrow Keys to Start', 'P = Pause, R = Restart');
    } else if (state === State.PAUSE) {
      drawOverlay('Paused', 'Press P to resume');
    } else if (state === State.OVER) {
      drawOverlay('Game Over', 'Press R to restart');
    }
  }

  // ===== Main loop with a fixed update tick =====
  let last = 0, acc = 0;
  function loop(t) {
    requestAnimationFrame(loop);
    if (last === 0) last = t;
    const dt = t - last; last = t;

    if (state === State.RUN) {
      acc += dt;
      while (acc >= tickMs) { acc -= tickMs; step(); }
    }

    draw();
  }

  // Boot
  reset();
  requestAnimationFrame(loop);
})();
/*
To dos:
- Add high score sharing
- Change speedup to percentage rathe than flat time decrease
- 



*/
</script>
{% endraw %}
