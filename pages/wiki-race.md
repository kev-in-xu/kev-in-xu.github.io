---
layout: single-full
title: Race to AGI (wiki game)
permalink: /projects/wiki-race
author_profile: false
classes:
  - wide
  - wiki-race-page
---

<link rel="stylesheet" href="/assets/css/wiki-race.css">
<link rel="stylesheet" href="https://en.wikipedia.org/w/load.php?lang=en&modules=mediawiki.skinning.content&only=styles&skin=vector">
<link rel="stylesheet" href="https://en.wikipedia.org/w/load.php?lang=en&modules=mediawiki.skinning.content.parsoid&only=styles&skin=vector">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="preload" as="script" href="https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js" crossorigin>
<link rel="preload" as="fetch" href="/assets/animations/wiki-race-win-confetti.json?v=1">

<script>
  (function () {
    // QA override: append ?mwSource=browser (or ?mwSource=backend) to this page URL.
    var isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (isLocalhost) window.WIKI_RACE_API_BASE = 'http://localhost:3000';
  })();
</script>

<div id="wiki-race-app" class="wiki-race-app" data-target-title="Artificial general intelligence" data-api-base="https://kev-in-xu-github-io.vercel.app" data-mw-source="browser" data-confetti-src="/assets/animations/wiki-race-win-confetti.json?v=1">
  <div class="wiki-race-shell">
    <header class="wiki-race-header">
      <p class="wiki-race-subtitle" data-region="mode-subtitle">
        Reach the wikipedia page for <a href="https://en.wikipedia.org/wiki/Artificial_general_intelligence" target="_blank" rel="noopener noreferrer">artificial general intelligence</a> using as few article links as possible. Daily challenge resets at 00:00 UTC.
      </p>
    </header>

    <section class="wiki-race-toolbar" aria-label="Game controls">
      <label class="wiki-race-mode-select" for="wiki-race-mode">
        <span class="wiki-race-mode-text">Game Mode:</span>
        <select id="wiki-race-mode" class="wiki-race-mode-control" data-field="game-mode" aria-label="Select game mode">
          <option value="agi">AGI</option>
          <option value="random_vital">Random</option>
          <option value="seeded">Seeded</option>
        </select>
      </label>
      <label class="wiki-race-seed-input" data-region="seeded-input" for="wiki-race-seed-key" hidden>
        <span class="wiki-race-mode-text">Seed:</span>
        <input
          id="wiki-race-seed-key"
          class="wiki-race-seed-control"
          type="text"
          inputmode="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          maxlength="24"
          placeholder="Enter run seed to play"
          data-field="seeded-key"
          aria-label="Enter a 24-character seed key">
      </label>
      <button type="button" class="wiki-race-btn" data-action="start">Start</button>
      <button type="button" class="wiki-race-btn" data-action="back" disabled>Back</button>
      <button type="button" class="wiki-race-btn wiki-race-btn-danger" data-action="abandon" disabled>Give Up</button>
      <button type="button" class="wiki-race-btn" data-action="fullscreen">Fullscreen</button>
      <p class="wiki-race-toolbar-error" data-region="toolbar-error" hidden aria-live="polite"></p>
      <div class="wiki-race-stats" aria-live="polite">
        <span class="wiki-race-stat">Timer: <span data-field="timer">00:00.000</span></span>
        <span class="wiki-race-stat">Clicks: <span data-field="clicks">0</span></span>
      </div>
    </section>

    <section class="wiki-race-route-panel" aria-label="Route history">
      <h2>Route</h2>
      <div class="wiki-race-route" data-region="route">-</div>
    </section>

    <section class="wiki-race-main">
      <aside class="wiki-race-toc-panel" data-region="toc-panel" aria-label="Article table of contents">
        <nav class="vector-toc vector-toc-pinned" data-region="toc" aria-label="Contents">
          <div class="vector-toc-heading">
            <h2>Contents</h2>
          </div>
          <div class="vector-toc-contents">
            <p class="wiki-race-toc-placeholder">Section links appear after you start.</p>
          </div>
        </nav>
      </aside>
      <article class="wiki-race-article" data-region="article" aria-label="Article content">
        <p class="wiki-race-placeholder">Article content will appear here after you start.</p>
      </article>
    </section>
  </div>
</div>

<noscript>This page requires JavaScript to play.</noscript>

<script type="module" src="/assets/js/wiki-race/app.js"></script>
