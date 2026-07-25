---
layout: single-full
title: Habit Journal
permalink: /journal/
author_profile: false
classes:
  - wide
  - journal-page
---

<link rel="stylesheet" href="/assets/css/journal.css">

<div id="habit-journal-app" class="journal-app is-locked" data-api-base="https://journal-api-ashy.vercel.app">
  <section class="journal-auth" data-region="auth" aria-label="Journal login">
    <form class="journal-auth-form" data-form="auth">
      <label class="journal-field" for="journal-password">
        <span>Password</span>
        <input id="journal-password" type="password" autocomplete="current-password" data-field="password">
      </label>
      <button type="submit" class="journal-button journal-button-primary">Unlock Journal</button>
    </form>
  </section>

  <nav class="journal-tabs" aria-label="Journal views">
    <button type="button" class="journal-tab is-active" data-view="daily">Daily</button>
    <button type="button" class="journal-tab" data-view="summary">Summary</button>
    <button type="button" class="journal-tab" data-view="settings">Settings</button>
  </nav>

  <p class="journal-status" data-region="status" hidden></p>

  <section class="journal-view is-active" data-panel="daily" aria-label="Daily check-in">
    <form class="journal-daily-form" data-form="daily">
      <div class="journal-toolbar journal-toolbar-daily">
        <div class="journal-date-line">
          <span class="journal-date-prefix">Daily Entry for</span>
          <button type="button" class="journal-date-button" data-action="open-day-picker" aria-label="Choose a different journal date">
            <span data-field="day-label"></span>
            <span class="journal-date-arrow" aria-hidden="true">▼</span>
          </button>
        </div>
        <input id="journal-day" name="day" type="date" data-field="day" class="journal-date-input" aria-label="Choose a different journal date" tabindex="-1">
      </div>

      <div class="journal-grid">
        <section class="journal-panel" aria-labelledby="journal-mood-heading">
          <div class="journal-panel-head">
            <h2 id="journal-mood-heading">Mood 🙂</h2>
            <strong data-field="mood-label">good</strong>
          </div>
          <div class="journal-slider-row">
            <input type="range" min="1" max="6" step="1" value="4" data-field="mood" aria-label="Mood">
          </div>
        </section>

        <section class="journal-panel" aria-labelledby="journal-energy-heading">
          <div class="journal-panel-head">
            <h2 id="journal-energy-heading">Energy ⚡</h2>
            <strong data-field="energy-label">steady</strong>
          </div>
          <div class="journal-slider-row">
            <input type="range" min="1" max="6" step="1" value="4" data-field="energy" aria-label="Energy level">
          </div>
        </section>

        <section class="journal-panel" aria-labelledby="journal-exercise-heading">
          <div class="journal-panel-head">
            <h2 id="journal-exercise-heading">Exercise 🏃</h2>
            <strong data-field="exercise-label">none</strong>
          </div>
          <div class="journal-slider-row">
            <input type="range" min="0" max="3" step="1" value="0" data-field="exercise" aria-label="Exercise intensity">
          </div>
        </section>
      </div>

      <section class="journal-panel" aria-labelledby="journal-habits-heading">
        <h2 id="journal-habits-heading">Habits</h2>
        <div class="journal-habit-toggles" data-region="daily-habits"></div>
      </section>

      <section class="journal-panel" aria-labelledby="journal-reflection-heading">
        <h2 id="journal-reflection-heading">Reflection</h2>
        <textarea data-field="reflection" rows="5" maxlength="1200" placeholder="Short reflection"></textarea>
      </section>

      <div class="journal-actions">
        <button type="submit" class="journal-button journal-button-primary" data-action="finish-update">Finish Update</button>
      </div>
    </form>
  </section>

  <section class="journal-view" data-panel="summary" aria-label="Summary dashboard">
    <div class="journal-toolbar">
      <div class="journal-month-controls">
        <button type="button" class="journal-icon-button" data-action="previous-month" aria-label="Previous month">&lt;</button>
        <strong data-field="summary-month"></strong>
        <button type="button" class="journal-icon-button" data-action="next-month" aria-label="Next month">&gt;</button>
      </div>
    </div>

    <section class="journal-panel journal-trend-panel" aria-labelledby="journal-trend-heading">
      <div class="journal-panel-head">
        <h2 id="journal-trend-heading">Trends</h2>
      </div>
      <div class="journal-trend-legend" aria-label="Trend legend">
        <span><i class="journal-trend-swatch journal-trend-swatch-mood"></i>Mood</span>
        <span><i class="journal-trend-swatch journal-trend-swatch-energy"></i>Energy</span>
        <span><i class="journal-trend-swatch journal-trend-swatch-exercise"></i>Exercise</span>
      </div>
      <div class="journal-line-chart" data-region="trend-chart"></div>
    </section>

    <details class="journal-panel journal-collapsible-panel">
      <summary class="journal-collapsible-summary">
        <h3 id="journal-habit-stats-heading">Habit Stats</h3>
      </summary>
      <div class="journal-habit-totals" data-region="habit-totals"></div>
    </details>

    <div class="journal-calendar-controls">
      <label class="journal-field journal-filter-field" for="journal-habit-filter">
        <span>Calendar filter</span>
        <select id="journal-habit-filter" data-field="habit-filter"></select>
      </label>
      <div class="journal-segmented-control" role="group" aria-label="Calendar color mode">
        <button type="button" class="journal-segmented-control-button is-active" data-action="set-summary-mode" data-mode="none">none</button>
        <button type="button" class="journal-segmented-control-button" data-action="set-summary-mode" data-mode="mood">mood</button>
        <button type="button" class="journal-segmented-control-button" data-action="set-summary-mode" data-mode="energy">energy</button>
        <button type="button" class="journal-segmented-control-button" data-action="set-summary-mode" data-mode="exercise">exercise</button>
      </div>
    </div>

    <section class="journal-panel" aria-labelledby="journal-calendar-heading">
      <h2 id="journal-calendar-heading">Calendar</h2>
      <div class="journal-calendar" data-region="calendar"></div>
    </section>

    <div class="journal-day-detail-wrap" data-region="day-detail"></div>
  </section>

  <section class="journal-view" data-panel="settings" aria-label="Habit settings">
    <form class="journal-add-habit" data-form="add-habit">
      <label class="journal-field" for="journal-new-habit">
        <span>New habit</span>
        <input id="journal-new-habit" type="text" maxlength="80" data-field="new-habit-name">
      </label>
      <button type="submit" class="journal-button">Add Habit</button>
    </form>
    <div class="journal-settings-list" data-region="settings-habits"></div>
  </section>
</div>

<noscript>This journal requires JavaScript.</noscript>

<script type="module" src="/assets/js/journal/app.js"></script>
