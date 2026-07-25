import { apiFetch, setApiBase } from './api.js';
import { bindAuthEvents, isAuthError, lockJournal, unlockJournal } from './auth.js';
import { app, $all } from './dom.js';
import { bindEntryEvents, loadDraft, renderDaily } from './entry.js';
import { bindSettingsEvents, renderSettings } from './settings.js';
import { bindSummaryEvents, renderSummary } from './summary.js';
import { monthKey, state } from './state.js';
import { bindBeforeUnload, confirmDiscardIfNeeded, setStatus } from './ui.js';

const calendarActions = {
  loadDraft,
  setView
};
const settingsActions = {
  renderDaily
};

function setView(view) {
  if (view !== state.activeView && state.activeView === 'daily' && !confirmDiscardIfNeeded()) return;
  state.activeView = view;
  state.dirty = false;
  $all('.journal-tab').forEach(tab => {
    const isActive = tab.dataset.view === view;
    tab.classList.toggle('is-active', isActive);
  });
  $all('.journal-view').forEach(panel => {
    panel.classList.toggle('is-active', panel.dataset.panel === view);
  });
  if (view === 'summary') renderSummary(calendarActions);
  if (view === 'settings') renderSettings(settingsActions);
}

function bindAppEvents() {
  $all('.journal-tab').forEach(tab => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  });
  bindEntryEvents({ showSummary: () => setView('summary') });
  bindSummaryEvents(calendarActions);
  bindSettingsEvents(settingsActions);
  bindAuthEvents({ onLogin: loadJournal });
  bindBeforeUnload();
}

async function loadJournal() {
  setStatus('Loading journal...');
  try {
    const result = await apiFetch(`/api/journal/bootstrap?dayKey=${encodeURIComponent(state.selectedDay)}`);
    unlockJournal();
    state.habits = result.habits || [];
    state.entries = result.entries || [];
    loadDraft(result.dayKey || state.selectedDay);
    state.summaryMonth = monthKey(state.selectedDay);
    renderSummary(calendarActions);
    setStatus('');
  } catch (err) {
    if (isAuthError(err)) {
      lockJournal();
      return;
    }
    setStatus(err.message, true);
    renderDaily();
    renderSummary(calendarActions);
  }
}

function init() {
  if (!app) return;
  setApiBase(app);
  bindAppEvents();
  lockJournal();
}

init();
