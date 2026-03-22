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
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

<script>
  (function () {
    // QA override: append ?mwSource=browser (or ?mwSource=backend) to this page URL.
    var isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (isLocalhost) window.WIKI_RACE_API_BASE = 'http://localhost:3000';
  })();
</script>

<div id="wiki-race-app" class="wiki-race-app" data-target-title="Artificial general intelligence" data-api-base="https://kev-in-xu-github-io.vercel.app" data-mw-source="browser" data-confetti-src="/assets/animations/wiki-race-win-confetti.json?v=1" data-supabase-url="https://lljbzkmtshufnzfnzawp.supabase.co" data-supabase-anon-key="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsamJ6a210c2h1Zm56Zm56YXdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MTM1NDksImV4cCI6MjA3ODI4OTU0OX0.F-ARDzmDyzgLl49CWroQupwO6mbttQxgvxIxup92fv0" data-multiplayer-enabled="true" data-debug-mode="false" data-realtime-enabled="true" data-realtime-fallback-polling-enabled="true">
  <div class="wiki-race-shell">
    <section class="wiki-race-mode-tabs" aria-label="Play mode">
      <button type="button" class="wiki-race-tab is-active" data-action="show-solo" data-play-mode="solo" aria-pressed="true">Solo</button>
      <button type="button" class="wiki-race-tab" data-action="show-multiplayer" data-play-mode="multiplayer" aria-pressed="false">Multiplayer</button>
    </section>

    <header class="wiki-race-header">
      <p class="wiki-race-subtitle" data-region="mode-subtitle">
        Reach the wikipedia page for <a href="https://en.wikipedia.org/wiki/Artificial_general_intelligence" target="_blank" rel="noopener noreferrer">artificial general intelligence</a> using as few article links as possible. Daily challenge resets at 00:00 UTC.
      </p>
    </header>

    <section class="wiki-race-multiplayer-panel" data-region="multiplayer-panel" hidden aria-label="Multiplayer lobby">
      <div class="wiki-race-multiplayer-intro" data-region="multiplayer-home">
        <div class="wiki-race-multiplayer-fields">
          <label class="wiki-race-inline-field" for="wiki-race-nickname">
            <span class="wiki-race-mode-text">Nickname:</span>
            <input
              id="wiki-race-nickname"
              class="wiki-race-text-control"
              type="text"
              inputmode="text"
              autocomplete="nickname"
              autocapitalize="off"
              spellcheck="false"
              maxlength="10"
              size="10"
              placeholder="3-10 letters"
              data-field="multiplayer-nickname"
              aria-label="Nickname">
          </label>
          <label class="wiki-race-inline-field" for="wiki-race-lobby-code">
            <span class="wiki-race-mode-text">Lobby Code:</span>
            <input
              id="wiki-race-lobby-code"
              class="wiki-race-text-control wiki-race-code-control"
              type="text"
              inputmode="text"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              maxlength="6"
              size="6"
              placeholder="ABC123"
              data-field="multiplayer-lobby-code"
              aria-label="Lobby code">
          </label>
          <button type="button" class="wiki-race-btn" data-action="create-lobby">Create Lobby</button>
          <button type="button" class="wiki-race-btn" data-action="join-lobby">Join Lobby</button>
        </div>
      </div>

      <div class="wiki-race-lobby-shell" data-region="multiplayer-lobby" hidden>
        <div class="wiki-race-lobby-header" data-region="multiplayer-lobby-header" hidden>
          <div class="wiki-race-share-block">
            <span class="wiki-race-share-label">Lobby Code</span>
            <div class="wiki-race-share-code-wrap">
              <strong class="wiki-race-share-code" data-field="multiplayer-share-code">------</strong>
              <button type="button" class="wiki-race-btn" data-action="copy-lobby-code">Copy</button>
            </div>
          </div>
          <div class="wiki-race-status-item wiki-race-lobby-status">
            <span class="wiki-race-status-label">Status</span>
            <strong data-field="multiplayer-lobby-status">lobby open</strong>
          </div>
          <div class="wiki-race-lobby-actions">
            <button type="button" class="wiki-race-btn wiki-race-lobby-action" data-action="start-lobby-race">Start Countdown</button>
            <button type="button" class="wiki-race-btn wiki-race-btn-danger wiki-race-lobby-action" data-action="leave-lobby-inline">Leave Lobby</button>
          </div>
          <div class="wiki-race-connection-badge" data-field="multiplayer-connection-status">Offline</div>
        </div>

        <div class="wiki-race-lobby-grid">
          <section class="wiki-race-roster-panel" aria-label="Players" hidden>
            <div class="wiki-race-roster-table-wrap">
              <table class="wiki-race-roster-table">
                <tbody data-region="multiplayer-roster">
                  <tr class="wiki-race-roster-row">
                    <th scope="row" class="wiki-race-roster-row-label">Player</th>
                    <td class="wiki-race-roster-cell"></td>
                    <td class="wiki-race-roster-cell"></td>
                    <td class="wiki-race-roster-cell"></td>
                    <td class="wiki-race-roster-cell"></td>
                    <td class="wiki-race-roster-cell"></td>
                    <td class="wiki-race-roster-cell"></td>
                  </tr>
                  <tr class="wiki-race-roster-row">
                    <th scope="row" class="wiki-race-roster-row-label">Time</th>
                    <td class="wiki-race-roster-cell"></td>
                    <td class="wiki-race-roster-cell"></td>
                    <td class="wiki-race-roster-cell"></td>
                    <td class="wiki-race-roster-cell"></td>
                    <td class="wiki-race-roster-cell"></td>
                    <td class="wiki-race-roster-cell"></td>
                  </tr>
                  <tr class="wiki-race-roster-row">
                    <th scope="row" class="wiki-race-roster-row-label">Clicks</th>
                    <td class="wiki-race-roster-cell"></td>
                    <td class="wiki-race-roster-cell"></td>
                    <td class="wiki-race-roster-cell"></td>
                    <td class="wiki-race-roster-cell"></td>
                    <td class="wiki-race-roster-cell"></td>
                    <td class="wiki-race-roster-cell"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      <p class="wiki-race-toolbar-error" data-region="multiplayer-error" hidden aria-live="polite"></p>
    </section>

    <section class="wiki-race-toolbar" data-region="solo-toolbar" aria-label="Game controls">
      <div class="wiki-race-toolbar-group wiki-race-toolbar-group-solo" data-region="solo-toolbar-controls">
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
        <p class="wiki-race-toolbar-error" data-region="toolbar-error" hidden aria-live="polite"></p>
      </div>
      <div class="wiki-race-toolbar-group wiki-race-toolbar-group-shared" data-region="shared-toolbar-controls">
        <button type="button" class="wiki-race-btn" data-action="back" disabled>Back</button>
        <button type="button" class="wiki-race-btn wiki-race-btn-danger" data-action="abandon" disabled>Give Up</button>
        <button type="button" class="wiki-race-btn" data-action="fullscreen">Fullscreen</button>
        <div class="wiki-race-stats" aria-live="polite">
          <span class="wiki-race-stat">Timer: <span data-field="timer">00:00.000</span></span>
          <span class="wiki-race-stat">Clicks: <span data-field="clicks">0</span></span>
        </div>
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
