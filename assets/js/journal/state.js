export function todayKey() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export function dateKey(date) {
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return copy.toISOString().slice(0, 10);
}

export function monthKey(dayKey) {
  return String(dayKey).slice(0, 7);
}

export function createEmptyDraft(dayKey) {
  return {
    dayKey,
    mood: 4,
    energy: 4,
    exerciseIntensity: 0,
    habitIds: [],
    reflection: ''
  };
}

export const state = {
  apiBase: '',
  activeView: 'daily',
  selectedDay: todayKey(),
  summaryMonth: monthKey(todayKey()),
  summarySelectedDay: todayKey(),
  summaryCalendarMode: 'none',
  habits: [],
  entries: [],
  draft: createEmptyDraft(todayKey()),
  dirty: false,
  saving: false
};

export function entryForDay(dayKey) {
  return state.entries.find(entry => entry.dayKey === dayKey) || null;
}

export function activeHabitsForDay(dayKey) {
  const entry = entryForDay(dayKey);
  const historicalIds = new Set(entry?.habitIds || []);
  return state.habits.filter(habit => !habit.isArchived || historicalIds.has(habit.id));
}

export function updateEntryInState(entry) {
  const index = state.entries.findIndex(item => item.dayKey === entry.dayKey);
  if (index >= 0) state.entries.splice(index, 1, entry);
  else state.entries.push(entry);
  state.entries.sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}
