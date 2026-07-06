import { apiFetch } from './api.js';
import { $ } from './dom.js';
import { state } from './state.js';
import { setStatus } from './ui.js';

export function renderSettings({ renderDaily } = {}) {
  const region = $('[data-region="settings-habits"]');
  region.innerHTML = '';
  state.habits.forEach(habit => {
    const row = document.createElement('div');
    row.className = 'journal-settings-row';
    const input = document.createElement('input');
    input.className = 'journal-settings-name';
    input.value = habit.name;
    input.setAttribute('aria-label', `Rename ${habit.name}`);
    const actions = document.createElement('div');
    actions.className = 'journal-settings-actions';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'journal-button';
    save.textContent = 'Rename';
    save.addEventListener('click', () => updateHabit(habit.id, { name: input.value }, { renderDaily }));
    const archive = document.createElement('button');
    archive.type = 'button';
    archive.className = 'journal-button';
    archive.textContent = habit.isArchived ? 'Restore' : 'Archive';
    archive.addEventListener('click', () => updateHabit(habit.id, { isArchived: !habit.isArchived }, { renderDaily }));
    actions.append(save, archive);
    row.append(input, actions);
    region.append(row);
  });
}

async function updateHabit(id, updates, actions) {
  try {
    const result = await apiFetch(`/api/journal/habits/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
    state.habits = result.habits;
    actions.renderDaily();
    renderSettings(actions);
    setStatus('Habit settings saved');
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function addHabit(event, actions) {
  event.preventDefault();
  const input = $('[data-field="new-habit-name"]');
  try {
    const result = await apiFetch('/api/journal/habits', {
      method: 'POST',
      body: JSON.stringify({ name: input.value })
    });
    input.value = '';
    state.habits = result.habits;
    actions.renderDaily();
    renderSettings(actions);
    setStatus('Habit added');
  } catch (err) {
    setStatus(err.message, true);
  }
}

export function bindSettingsEvents(actions) {
  $('[data-form="add-habit"]').addEventListener('submit', event => addHabit(event, actions));
}
