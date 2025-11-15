---
layout: single
title: Snake
permalink: /projects/snake/
author_profile: false
---

<!--
How to use on GitHub Pages (Jekyll + Minimal Mistakes):
1) Save this file as `games/snake.html` in your repo.
2) Commit & push. Visit https://<your-username>.github.io/games/snake/
3) No external assets required. Everything is in this one file.

Learning notes are sprinkled throughout as comments.
-->

<style>
  /* Page layout */
  .snake-wrapper { display:flex; gap:1.5rem; align-items:flex-start; flex-wrap:wrap; }
  .panel { margin: 0; }
  canvas { border:1px solid #333; background:#111; image-rendering: pixelated; }
  .stat { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  .btn { cursor:pointer; padding:0.5rem 0.75rem; border:1px solid #444; background:#1f1f1f; color:#eee; border-radius:8px; }
  .btn:hover { background:#2a2a2a; }

  @media (min-width: 900px) {
  .snake-wrapper { flex-wrap: nowrap; justify-content: center; }
  }
  @media (max-width: 899px) {
    .snake-wrapper { flex-wrap: wrap; }
  }

  /* Leaderboard */
  .leaderboard { max-width: 400px; margin: 0; padding: 1rem; border: 1px solid #ddd; border-radius: 12px; }
  .leaderboard h2 { margin: 0 0 .5rem; }
  .leaderboard ol { padding-left: 1.25rem; }
  .leaderboard form { display: grid; gap: .5rem; margin-top: 1rem; }
  .leaderboard input { padding: .4rem .5rem; border: 1px solid #ccc; border-radius: 8px; }
  .leaderboard input[type="color"] { padding: 8px; height: 2.4rem; cursor: pointer; }
  .leaderboard button { padding: .5rem .75rem; border: 1px solid #ccc; border-radius: 8px; cursor: pointer; }
</style>

Eat apples, not yourself

<div class="snake-wrapper">
  <div class="panel">
    <canvas id="game" aria-label="Snake game canvas" role="img"></canvas>
    <div style="display:flex; gap:0.5rem; align-items:center;">
      <span class="stat">Score: <span id="score">0</span></span>
      <span class="stat">Best: <span id="best">0</span></span>
    </div>
    <div style="margin-top:0.25rem;">
      <span class="stat">Speed: <span id="speed">1.00x</span></span>
    </div>
  </div>


  <div class="panel leaderboard">
    <h2>Top Scores</h2>
  <ol id="lb-list"></ol>

  <form id="lb-form" autocomplete="off">
    <label>Initials (2 letters): <input id="lb-initials" maxlength="2" required></label>
    <label>Pick a Color: <input type="color" id="lb-color" value="#15a521" required></label>
    <button type="submit">Submit your best score!</button>
    <small id="lb-msg" style="display:block;margin-top:.5rem;"></small>
  </form>
</div>
</div>
<br>

<div class="panel">
  <h3>Notes</h3>
  <ul>
    <li>Game logic originally coded in Python. Now implemented in HTML5 Canvas + JS.</li>
    <li>Leaderboard implemented using Supabase.</li>
    <li><code>inputQueue</code> of length 2 allows "pre-moving" even if keys were pressed before the clock tick.</li>
  </ul>
</div>

{% raw %}


<!-- Supabase JS (v2) -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
  // --- CONFIG: replace with your values ---
  const SUPABASE_URL = "https://lljbzkmtshufnzfnzawp.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsamJ6a210c2h1Zm56Zm56YXdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MTM1NDksImV4cCI6MjA3ODI4OTU0OX0.F-ARDzmDyzgLl49CWroQupwO6mbttQxgvxIxup92fv0";
  // --------------------------------------
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const colorInput = document.getElementById('lb-color');
  const DEFAULT_COLOR = '#15a521';
  colorInput.value = DEFAULT_COLOR;
  const BEST_KEY = 'snake-best-v1';
  const BEST_SUBMITTED_KEY = 'snake-best-submitted-v1';
  const submitBtn = document.querySelector('#lb-form button[type="submit"]');
  const msgEl = document.getElementById('lb-msg');
  const SUBMIT_LOCK_MESSAGE = "You've already submitted this best score. Beat it to submit again.";
  // Sync submit button state with localStorage
  const getStoredBest = () => Number(localStorage.getItem(BEST_KEY) || 0);
  const getSubmittedScore = () => Number(localStorage.getItem(BEST_SUBMITTED_KEY) || 0);
  // Disable submit if current best is already submitted
  function syncSubmitLock(currentBest = getStoredBest()) {
    const submitted = getSubmittedScore();
    const shouldLock = Number.isFinite(currentBest) && currentBest > 0 && submitted >= currentBest;
    if (submitBtn) submitBtn.disabled = shouldLock; // if the button exists?
    if (shouldLock) {
      msgEl.textContent = SUBMIT_LOCK_MESSAGE;
    } else if (msgEl.textContent === SUBMIT_LOCK_MESSAGE) {
      msgEl.textContent = "";
    }
    return shouldLock;
  }
  window.addEventListener('snake-best-changed', (evt) => {
    const newBest = Number(evt?.detail?.score) || 0; // '?' makes it so that if evt or evt.detail is undefined, it won't throw an error
    syncSubmitLock(newBest);
  });
  syncSubmitLock();
  async function loadLeaderboard() {
    const list = document.getElementById('lb-list');
    list.innerHTML = "<li>Loading…</li>";
    const { data, error } = await sb
      .from('scores')
      .select('initials, color, score, created_at')
      .order('score', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(10);
    if (error) {
      list.innerHTML = `<li>Failed to load: ${error.message}</li>`;
      return;
    }
    list.innerHTML = "";
    data.forEach((row) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = row.initials;
      name.style.fontWeight = '700'; // bold
      if (row.color) name.style.color = row.color;
      li.appendChild(name);
      li.append(` — ${row.score}`);
      list.appendChild(li);
    });
    if (data.length === 0) list.innerHTML = "<li>No scores yet — be the first!</li>";
  }
  function validateInitials(s) {
    return /^[A-Za-z]{2}$/.test(s);
  }
  function validateHex(color) {
    return /^#[0-9A-Fa-f]{6}$/.test(color);
  }
  document.getElementById('lb-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const initials = document.getElementById('lb-initials').value.trim().toUpperCase();
    const color = document.getElementById('lb-color').value;
    const score = window.SnakeGame?.getBestScore?.() ?? 0;
    if (!validateInitials(initials)) {
      msgEl.textContent = "Please enter two letters (A–Z).";
      return;
    }
    if (!validateHex(color)) {
      msgEl.textContent = "Pick a valid color.";
      return;
    }
    if (!Number.isFinite(score) || score <= 0) {
      msgEl.textContent = "Play a round and set a best score before submitting.";
      return;
    }
    if (syncSubmitLock(score)) {
      msgEl.textContent = SUBMIT_LOCK_MESSAGE;
      return;
    }
    // Insert
    const { error } = await sb.from('scores').insert([{ initials, color, score }]);
    if (error) {
      msgEl.textContent = `Submit failed: ${error.message}`;
      return;
    }
    localStorage.setItem(BEST_SUBMITTED_KEY, String(score));
    syncSubmitLock(score);
    msgEl.textContent = "Score submitted!";
    e.target.reset();
    colorInput.value = DEFAULT_COLOR;
    loadLeaderboard();
  });
  loadLeaderboard();
</script>

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
  const SPEEDUP_DELTA = 0.05;   // ms removed per speedup step

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
  window.SnakeGame = window.SnakeGame || {};
  window.SnakeGame.getBestScore = () => bestScore;
  const notifyBestChange = () => {
    window.dispatchEvent(new CustomEvent('snake-best-changed', { detail: { score: bestScore } }));
  };
  notifyBestChange();

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
        tickMs = Math.max(TICK_MS_MIN, Math.round(tickMs * 0.95));
      }
      if (score > bestScore) {
        bestScore = score;
        localStorage.setItem(BEST_KEY, String(bestScore));
        ui.best.textContent = String(bestScore);
        notifyBestChange();
      }
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
    ctx.font = 'bold 16px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.fillText(text, canvas.width/2, canvas.height/2 - 10);
    ctx.font = '13px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
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
- Add localStorage for whether best score has been submitted, and disallow resubmission
- Do not set default color for color picker and require initials and color to be set before submitting
*/
</script>
{% endraw %}
