---
layout: single
title: Wiki Race (Internet)
permalink: /projects/wiki-race/
author_profile: false
---

<link rel="stylesheet" href="/assets/css/wiki-race.css">

<div id="wiki-race-app" class="wiki-race-app" data-target-title="Internet">
  <div class="wiki-race-shell">
    <header class="wiki-race-header">
      <h1 class="wiki-race-title">Wiki Race: Internet</h1>
      <p class="wiki-race-subtitle">Reach <strong>Internet</strong> in the fewest moves. Daily challenge resets at 00:00 UTC.</p>
    </header>

    <section class="wiki-race-toolbar" aria-label="Game controls">
      <button type="button" class="wiki-race-btn" data-action="start">Start</button>
      <button type="button" class="wiki-race-btn" data-action="back" disabled>Back</button>
      <button type="button" class="wiki-race-btn wiki-race-btn-danger" data-action="abandon" disabled>Abandon</button>
      <div class="wiki-race-stats" aria-live="polite">
        <span>Timer: <span data-field="timer">00:00.000</span></span>
        <span>Clicks: <span data-field="clicks">0</span></span>
      </div>
    </section>

    <section class="wiki-race-status" data-region="status" aria-live="polite">
      Click <strong>Start</strong> to reveal today&apos;s article.
    </section>

    <section class="wiki-race-main">
      <article class="wiki-race-article" data-region="article" aria-label="Article content">
        <p class="wiki-race-placeholder">Article content will appear here after you start.</p>
      </article>

      <aside class="wiki-race-sidebar" aria-label="Route history">
        <h2>Route</h2>
        <div class="wiki-race-route" data-region="route">-</div>
      </aside>
    </section>
  </div>
</div>

<noscript>This page requires JavaScript to play.</noscript>

<script type="module" src="/assets/js/wiki-race/app.js"></script>
