import { ENERGY_LABELS, EXERCISE_LABELS, MOOD_LABELS } from './constants.js';
import { apiFetch } from './api.js';
import { $ } from './dom.js';
import {
  activeHabitsForDay,
  createEmptyDraft,
  entryForDay,
  state,
  todayKey,
  updateEntryInState
} from './state.js';
import { confirmDiscardIfNeeded, markDirty, setStatus } from './ui.js';

function parseDayKey(dayKey) {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDailyEntryDate(dayKey) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(parseDayKey(dayKey));
}

export function loadDraft(dayKey) {
  const entry = entryForDay(dayKey);
  state.selectedDay = dayKey;
  state.draft = entry
    ? {
        dayKey,
        mood: entry.mood,
        energy: entry.energy ?? 4,
        exerciseIntensity: entry.exerciseIntensity,
        habitIds: [...entry.habitIds],
        reflection: entry.reflection || ''
      }
    : createEmptyDraft(dayKey);
  state.dirty = false;
  renderDaily();
}

export function renderDaily() {
  $('[data-field="day"]').value = state.selectedDay;
  $('[data-field="day"]').max = todayKey();
  $('[data-field="day-label"]').textContent = formatDailyEntryDate(state.selectedDay);
  $('[data-field="mood"]').value = String(state.draft.mood);
  $('[data-field="mood-label"]').textContent = MOOD_LABELS[state.draft.mood - 1];
  $('[data-field="energy"]').value = String(state.draft.energy);
  $('[data-field="energy-label"]').textContent = ENERGY_LABELS[state.draft.energy - 1];
  $('[data-field="exercise"]').value = String(state.draft.exerciseIntensity);
  $('[data-field="exercise-label"]').textContent = EXERCISE_LABELS[state.draft.exerciseIntensity];
  $('[data-field="reflection"]').value = state.draft.reflection;

  const habitWrap = $('[data-region="daily-habits"]');
  habitWrap.innerHTML = '';
  activeHabitsForDay(state.selectedDay).forEach(habit => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'journal-habit-toggle';
    button.classList.toggle('is-selected', state.draft.habitIds.includes(habit.id));
    button.textContent = habit.name;
    button.dataset.habitId = habit.id;
    button.addEventListener('click', () => {
      const selected = new Set(state.draft.habitIds);
      selected.has(habit.id) ? selected.delete(habit.id) : selected.add(habit.id);
      state.draft.habitIds = [...selected];
      markDirty();
      renderDaily();
    });
    habitWrap.append(button);
  });

  const saveButton = $('[data-action="finish-update"]');
  saveButton.disabled = state.saving;
  saveButton.textContent = state.saving ? 'Journal Updated' : 'Finish Update';
}

async function saveDraft(event, onSaved) {
  event.preventDefault();
  state.saving = true;
  renderDaily();
  setStatus('');

  try {
    const result = await apiFetch(`/api/journal/entries/${state.selectedDay}`, {
      method: 'PUT',
      body: JSON.stringify({
        mood: state.draft.mood,
        energy: state.draft.energy,
        exerciseIntensity: state.draft.exerciseIntensity,
        habitIds: state.draft.habitIds,
        reflection: state.draft.reflection
      })
    });
    updateEntryInState(result.entry);
    state.dirty = false;
    setStatus('Journal Updated');
    window.setTimeout(() => {
      state.saving = false;
      onSaved();
      renderDaily();
    }, 700);
  } catch (err) {
    state.saving = false;
    setStatus(err.message, true);
    renderDaily();
  }
}

export function bindEntryEvents({ showSummary }) {
  const dayInput = $('[data-field="day"]');
  const mobileDateInput = window.matchMedia('(max-width: 720px)');
  const syncDateInputAccessibility = () => {
    const isMobile = mobileDateInput.matches;
    dayInput.tabIndex = isMobile ? 0 : -1;
    dayInput.setAttribute('aria-hidden', String(!isMobile));
  };
  syncDateInputAccessibility();
  mobileDateInput.addEventListener('change', syncDateInputAccessibility);

  const openDayPicker = () => {
    if (typeof dayInput.showPicker === 'function') dayInput.showPicker();
    else dayInput.click();
  };

  $('[data-action="open-day-picker"]').addEventListener('click', () => {
    if (!confirmDiscardIfNeeded()) return;
    openDayPicker();
  });
  dayInput.addEventListener('change', () => {
    const dayKey = dayInput.value;
    if (!dayKey) return;
    if (dayKey > todayKey()) {
      setStatus('Choose today or a past date.', true);
      dayInput.value = state.selectedDay;
      return;
    }
    loadDraft(dayKey);
  });
  $('[data-field="mood"]').addEventListener('input', event => {
    state.draft.mood = Number(event.target.value);
    markDirty();
    renderDaily();
  });
  $('[data-field="energy"]').addEventListener('input', event => {
    state.draft.energy = Number(event.target.value);
    markDirty();
    renderDaily();
  });
  $('[data-field="exercise"]').addEventListener('input', event => {
    state.draft.exerciseIntensity = Number(event.target.value);
    markDirty();
    renderDaily();
  });
  $('[data-field="reflection"]').addEventListener('input', event => {
    state.draft.reflection = event.target.value;
    markDirty();
  });
  $('[data-form="daily"]').addEventListener('submit', event => saveDraft(event, showSummary));
}
