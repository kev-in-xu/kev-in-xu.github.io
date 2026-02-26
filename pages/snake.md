---
title: Snake
permalink: /projects/snake/
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
  canvas {
    display: block;
    width: min(90vw, 300px);
    height: auto;
    border:1px solid #333;
    background:#111;
    image-rendering: pixelated;
    touch-action: none;
  }
  .stat { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  .btn { cursor:pointer; padding:0.5rem 0.75rem; border:1px solid #444; background:#1f1f1f; color:#eee; border-radius:8px; }
  .btn:hover { background:#2a2a2a; }
  .snake-controls { display:flex; gap:0.5rem; margin-top:0.5rem; flex-wrap:wrap; }
  .snake-controls .btn { touch-action: manipulation; }

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
    <div class="snake-controls" aria-label="Game controls">
      <button id="pause-btn" class="btn" type="button">Pause / Resume</button>
      <button id="restart-btn" class="btn" type="button">Restart</button>
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


<!-- Supabase JS (v2) -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script type="module" src="/assets/js/snake/main.js"></script>
