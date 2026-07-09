import { apiFetch, setAuthToken } from './api.js';
import { app, $ } from './dom.js';
import { setStatus } from './ui.js';

export function lockJournal(message = 'Enter the journal password.') {
  app.classList.add('is-locked');
  setStatus(message, message !== 'Enter the journal password.');
}

export function unlockJournal() {
  app.classList.remove('is-locked');
}

export function isAuthError(err) {
  return err?.status === 401;
}

export function bindAuthEvents({ onLogin }) {
  $('[data-form="auth"]').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('[data-field="password"]');
    const password = input.value;
    setStatus('Checking password...');

    try {
      const result = await apiFetch('/api/journal/login', {
        method: 'POST',
        body: JSON.stringify({ password })
      });
      if (!result.token) throw new Error('Login response did not include a session token');
      setAuthToken(result.token);
      input.value = '';
      unlockJournal();
      await onLogin();
    } catch (err) {
      lockJournal(err.message);
      input.focus();
    }
  });
}
