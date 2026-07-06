import { UNSAVED_MESSAGE } from './constants.js';
import { $ } from './dom.js';
import { state } from './state.js';

export function setStatus(message, isError = false) {
  const el = $('[data-region="status"]');
  el.hidden = !message;
  el.textContent = message || '';
  el.style.borderColor = isError ? '#a33' : '';
}

export function markDirty() {
  if (state.saving) return;
  state.dirty = true;
}

export function confirmDiscardIfNeeded() {
  return !state.dirty || window.confirm(UNSAVED_MESSAGE);
}

export function bindBeforeUnload() {
  window.addEventListener('beforeunload', event => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = UNSAVED_MESSAGE;
  });
}
