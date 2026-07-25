import { ENERGY_LABELS, EXERCISE_LABELS, MOOD_LABELS, WEEKDAYS } from './constants.js';
import { $, $all } from './dom.js';
import { confirmDiscardIfNeeded } from './ui.js';
import { activeHabitsForDay, createEmptyDraft, dateKey, entryForDay, monthKey, state } from './state.js';

const SUMMARY_MODES = ['none', 'mood', 'energy', 'exercise'];
const EMPTY_DAY_COLOR = '#e6e6e6';
const NEUTRAL_DAY_COLOR = '#ffffff';
const TREND_SERIES = [
  {
    label: 'Mood',
    color: '#2f80ed',
    max: 6,
    value: entry => entry.mood,
    text: value => MOOD_LABELS[value - 1]
  },
  {
    label: 'Energy',
    color: '#f2994a',
    max: 6,
    value: entry => entry.energy ?? 4,
    text: value => ENERGY_LABELS[value - 1]
  },
  {
    label: 'Exercise',
    color: '#34a853',
    max: 3,
    value: entry => entry.exerciseIntensity,
    text: value => EXERCISE_LABELS[value]
  }
];

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map(ch => ch + ch).join('')
    : normalized;
  const int = Number.parseInt(value, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

function mixHex(startHex, endHex, ratio) {
  const start = hexToRgb(startHex);
  const end = hexToRgb(endHex);
  return rgbToHex({
    r: start.r + (end.r - start.r) * ratio,
    g: start.g + (end.g - start.g) * ratio,
    b: start.b + (end.b - start.b) * ratio
  });
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const normalize = value => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * normalize(r) + 0.7152 * normalize(g) + 0.0722 * normalize(b);
}

function contrastTextColor(hex) {
  return luminance(hex) > 0.55 ? '#1f1f1f' : '#fff';
}

function getCalendarPalette(mode, entry) {
  if (!entry) {
    return { bg: EMPTY_DAY_COLOR, fg: '#7d7d7d' };
  }

  switch (mode) {
    case 'mood': {
      const ratio = (entry.mood - 1) / 5;
      const bg = mixHex('#d64545', '#34a853', ratio);
      return { bg, fg: contrastTextColor(bg) };
    }
    case 'energy': {
      const ratio = ((entry.energy ?? 4) - 1) / 5;
      const bg = mixHex('#2f80ed', '#f2c94c', ratio);
      return { bg, fg: contrastTextColor(bg) };
    }
    case 'exercise': {
      const ratio = entry.exerciseIntensity / 3;
      const bg = mixHex('#ffffff', '#f2994a', ratio);
      return { bg, fg: contrastTextColor(bg) };
    }
    case 'none':
    default:
      return { bg: NEUTRAL_DAY_COLOR, fg: '#222' };
  }
}

function renderTrendChart(entries) {
  const region = $('[data-region="trend-chart"]');
  region.innerHTML = '';
  const monthEntries = [...entries].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  if (monthEntries.length === 0) {
    region.textContent = 'No saved entries yet.';
    return;
  }

  const width = 640;
  const height = 220;
  const padding = { top: 14, right: 16, bottom: 34, left: 16 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xForIndex = index => padding.left + (monthEntries.length === 1 ? plotWidth / 2 : (index / (monthEntries.length - 1)) * plotWidth);
  const yForValue = (value, max) => padding.top + plotHeight - (value / max) * plotHeight;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Mood, energy, and exercise trends for recent saved entries');

  for (let i = 0; i <= 3; i += 1) {
    const y = padding.top + (plotHeight / 3) * i;
    const grid = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    grid.setAttribute('class', 'journal-line-chart-grid');
    grid.setAttribute('x1', String(padding.left));
    grid.setAttribute('x2', String(width - padding.right));
    grid.setAttribute('y1', String(y));
    grid.setAttribute('y2', String(y));
    svg.append(grid);
  }

  TREND_SERIES.forEach(series => {
    const points = monthEntries.map((entry, index) => {
      const value = series.value(entry);
      return `${xForIndex(index)},${yForValue(value, series.max)}`;
    }).join(' ');

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('class', 'journal-line-chart-series');
    line.setAttribute('points', points);
    line.setAttribute('stroke', series.color);
    svg.append(line);

    monthEntries.forEach((entry, index) => {
      const value = series.value(entry);
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('class', 'journal-line-chart-dot');
      dot.setAttribute('cx', String(xForIndex(index)));
      dot.setAttribute('cy', String(yForValue(value, series.max)));
      dot.setAttribute('r', '4');
      dot.setAttribute('fill', series.color);

      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${entry.dayKey.slice(5)} ${series.label}: ${series.text(value)}`;
      dot.append(title);
      svg.append(dot);
    });
  });

  const labelStride = Math.ceil(monthEntries.length / 10);
  monthEntries.forEach((entry, index) => {
    if (index % labelStride !== 0) return;
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'journal-line-chart-label');
    label.setAttribute('x', String(xForIndex(index)));
    label.setAttribute('y', String(height - 10));
    label.textContent = entry.dayKey.slice(5);
    svg.append(label);
  });

  region.append(svg);
  const note = document.createElement('p');
  note.className = 'journal-chart-note';
  note.textContent = 'Each line is scaled to its own range.';
  region.append(note);
}

function renderHabitTotals(entries) {
  const region = $('[data-region="habit-totals"]');
  region.innerHTML = '';
  const counts = new Map();
  entries.forEach(entry => entry.habitIds.forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
  if (counts.size === 0) {
    region.textContent = 'No completed habits yet.';
    return;
  }
  const table = document.createElement('div');
  table.className = 'journal-habit-stats';

  const header = document.createElement('div');
  header.className = 'journal-habit-stats-row journal-habit-stats-head';

  const habitHeader = document.createElement('span');
  habitHeader.textContent = 'Habit';

  const countHeader = document.createElement('span');
  countHeader.textContent = 'Count';

  header.append(habitHeader, countHeader);
  table.append(header);

  state.habits.forEach(habit => {
    if (!counts.has(habit.id)) return;
    const row = document.createElement('div');
    row.className = 'journal-habit-stats-row';

    const name = document.createElement('span');
    name.className = 'journal-habit-stats-name';
    name.textContent = habit.name;

    const count = document.createElement('span');
    count.className = 'journal-habit-stats-count';
    count.textContent = String(counts.get(habit.id));

    row.append(name, count);
    table.append(row);
  });

  region.append(table);
}

function formatSummaryDay(dayKey) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(`${dayKey}T00:00:00`));
}

function renderDayDetail({ loadDraft, setView } = {}) {
  const region = $('[data-region="day-detail"]');
  const entry = entryForDay(state.summarySelectedDay);
  const draft = entry || createEmptyDraft(state.summarySelectedDay);
  const completedHabits = new Set(entry?.habitIds || []);
  const habits = activeHabitsForDay(state.summarySelectedDay);

  region.innerHTML = '';

  const card = document.createElement('section');
  card.className = 'journal-day-detail';

  const header = document.createElement('div');
  header.className = 'journal-day-detail-head';

  const title = document.createElement('h3');
  title.textContent = formatSummaryDay(state.summarySelectedDay);

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'journal-button journal-day-detail-edit';
  edit.textContent = 'Edit';
  edit.addEventListener('click', () => {
    if (!loadDraft || !setView || !confirmDiscardIfNeeded()) return;
    loadDraft(state.summarySelectedDay);
    setView('daily');
  });

  header.append(title, edit);
  card.append(header);

  const sliders = document.createElement('div');
  sliders.className = 'journal-day-detail-sliders';

  const sliderSpecs = [
    { label: 'Mood', value: draft.mood, min: 1, max: 6, text: MOOD_LABELS[draft.mood - 1] },
    { label: 'Energy', value: draft.energy, min: 1, max: 6, text: ENERGY_LABELS[draft.energy - 1] },
    { label: 'Exercise', value: draft.exerciseIntensity, min: 0, max: 3, text: EXERCISE_LABELS[draft.exerciseIntensity] }
  ];

  sliderSpecs.forEach(spec => {
    const row = document.createElement('div');
    row.className = 'journal-day-detail-slider';

    const line = document.createElement('div');
    line.className = 'journal-day-detail-slider-head';

    const label = document.createElement('span');
    label.textContent = spec.label;

    const value = document.createElement('strong');
    value.textContent = spec.text;

    line.append(label, value);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = '1';
    input.value = String(spec.value);
    input.disabled = true;

    row.append(line, input);
    sliders.append(row);
  });

  card.append(sliders);

  const habitSection = document.createElement('div');
  habitSection.className = 'journal-day-detail-habits';

  const habitHeading = document.createElement('div');
  habitHeading.className = 'journal-day-detail-section-title';

  const habitTitle = document.createElement('span');
  habitTitle.textContent = 'Habit stats';

  const habitCount = document.createElement('strong');
  habitCount.textContent = `${completedHabits.size} completed`;

  habitHeading.append(habitTitle, habitCount);
  habitSection.append(habitHeading);

  if (habits.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'journal-day-detail-empty';
    empty.textContent = 'No habits configured.';
    habitSection.append(empty);
  } else if (completedHabits.size === 0) {
    const empty = document.createElement('p');
    empty.className = 'journal-day-detail-empty';
    empty.textContent = 'No habits completed.';
    habitSection.append(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'journal-day-detail-list';
    habits.forEach(habit => {
      if (!completedHabits.has(habit.id)) return;
      const row = document.createElement('div');
      row.className = 'journal-day-detail-row';

      const name = document.createElement('span');
      name.textContent = habit.name;

      const status = document.createElement('span');
      status.textContent = '1';

      row.append(name, status);
      list.append(row);
    });
    habitSection.append(list);
  }

  card.append(habitSection);

  const reflection = entry?.reflection?.trim();
  if (reflection) {
    const reflectionSection = document.createElement('div');
    reflectionSection.className = 'journal-day-detail-reflection';

    const reflectionTitle = document.createElement('span');
    reflectionTitle.className = 'journal-day-detail-section-label';
    reflectionTitle.textContent = 'Reflection';

    const reflectionText = document.createElement('p');
    reflectionText.textContent = reflection;

    reflectionSection.append(reflectionTitle, reflectionText);
    card.append(reflectionSection);
  }

  region.append(card);
}

function monthBounds(key) {
  const [year, month] = key.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  return { first, last };
}

function renderHabitFilter() {
  const select = $('[data-field="habit-filter"]');
  const current = select.value || '';
  select.innerHTML = '<option value="">All entries</option>';
  state.habits.forEach(habit => {
    const option = document.createElement('option');
    option.value = habit.id;
    option.textContent = habit.name;
    select.append(option);
  });
  select.value = [...select.options].some(option => option.value === current) ? current : '';
}

export function renderCalendar({ loadDraft, setView } = {}) {
  const region = $('[data-region="calendar"]');
  const filterId = $('[data-field="habit-filter"]').value;
  const { first, last } = monthBounds(state.summaryMonth);
  const firstCell = new Date(first);
  firstCell.setDate(first.getDate() - first.getDay());
  region.innerHTML = '';
  WEEKDAYS.forEach(day => {
    const header = document.createElement('div');
    header.className = 'journal-calendar-header';
    header.textContent = day;
    region.append(header);
  });

  for (let i = 0; i < 42; i += 1) {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + i);
    const key = dateKey(date);
    const entry = entryForDay(key);
    const inMonth = date >= first && date <= last;
    const matches = Boolean(entry) && (!filterId || entry.habitIds.includes(filterId));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'journal-day';
    button.classList.toggle('is-muted', !inMonth);
    button.classList.toggle('is-matched', matches);
    button.classList.toggle('is-selected', key === state.summarySelectedDay);
    button.classList.toggle('is-empty', !entry);
    const palette = getCalendarPalette(state.summaryCalendarMode, entry);
    button.style.setProperty('--day-bg', palette.bg);
    button.style.setProperty('--day-fg', palette.fg);
    button.innerHTML = `<span class="journal-day-number">${date.getDate()}</span>`;
    button.setAttribute('aria-label', `${formatSummaryDay(key)}${entry ? ', has journal entry' : ', no journal entry'}`);
    button.addEventListener('click', () => {
      state.summarySelectedDay = key;
      renderSummary({ loadDraft, setView });
    });
    region.append(button);
  }
}

export function renderSummary(calendarActions) {
  const monthEntries = state.entries.filter(entry => monthKey(entry.dayKey) === state.summaryMonth);
  const [year, month] = state.summaryMonth.split('-').map(Number);
  const activeMode = SUMMARY_MODES.includes(state.summaryCalendarMode) ? state.summaryCalendarMode : 'none';
  state.summaryCalendarMode = activeMode;
  $('[data-field="summary-month"]').textContent = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric'
  }).format(new Date(year, month - 1, 1));
  $all('.journal-segmented-control-button').forEach(button => {
    const isActive = button.dataset.mode === activeMode;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  renderHabitFilter();
  renderTrendChart(monthEntries);
  renderHabitTotals(monthEntries);
  renderCalendar(calendarActions);
  renderDayDetail(calendarActions);
}

export function bindSummaryEvents(calendarActions) {
  $('.journal-segmented-control').addEventListener('click', event => {
    const button = event.target.closest('[data-action="set-summary-mode"]');
    if (!button) return;
    const nextMode = button.dataset.mode || 'none';
    if (!SUMMARY_MODES.includes(nextMode)) return;
    state.summaryCalendarMode = nextMode;
    renderSummary(calendarActions);
  });
  $('[data-action="previous-month"]').addEventListener('click', () => {
    const [year, month] = state.summaryMonth.split('-').map(Number);
    state.summaryMonth = dateKey(new Date(year, month - 2, 1)).slice(0, 7);
    renderSummary(calendarActions);
  });
  $('[data-action="next-month"]').addEventListener('click', () => {
    const [year, month] = state.summaryMonth.split('-').map(Number);
    state.summaryMonth = dateKey(new Date(year, month, 1)).slice(0, 7);
    renderSummary(calendarActions);
  });
  $('[data-field="habit-filter"]').addEventListener('change', () => renderCalendar(calendarActions));

  let touchStartX = null;
  $('[data-region="calendar"]').addEventListener('touchstart', event => {
    touchStartX = event.changedTouches?.[0]?.clientX ?? null;
  }, { passive: true });
  $('[data-region="calendar"]').addEventListener('touchend', event => {
    if (touchStartX == null) return;
    const touchEndX = event.changedTouches?.[0]?.clientX ?? touchStartX;
    const delta = touchEndX - touchStartX;
    touchStartX = null;
    if (Math.abs(delta) < 50) return;
    const [year, month] = state.summaryMonth.split('-').map(Number);
    state.summaryMonth = dateKey(new Date(year, month + (delta > 0 ? -2 : 0), 1)).slice(0, 7);
    renderSummary(calendarActions);
  }, { passive: true });
}
