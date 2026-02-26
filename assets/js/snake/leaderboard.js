const SUPABASE_URL = 'https://lljbzkmtshufnzfnzawp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsamJ6a210c2h1Zm56Zm56YXdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MTM1NDksImV4cCI6MjA3ODI4OTU0OX0.F-ARDzmDyzgLl49CWroQupwO6mbttQxgvxIxup92fv0';
const DEFAULT_COLOR = '#15a521';
const SUBMIT_LOCK_MESSAGE = "You've already submitted this best score. Beat it to submit again.";

export function initSnakeLeaderboard({
  getBestScore = () => 0,
  bestStorageKey = 'snake-best-v1',
  submittedStorageKey = 'snake-best-submitted-v1'
} = {}) {
  const ui = {
    list: document.getElementById('lb-list'),
    form: document.getElementById('lb-form'),
    initials: document.getElementById('lb-initials'),
    color: document.getElementById('lb-color'),
    msg: document.getElementById('lb-msg'),
    submitBtn: document.querySelector('#lb-form button[type="submit"]')
  };

  if (!ui.form || !ui.list || !ui.msg || !ui.color) {
    return {
      handleBestScoreChange() {},
      loadLeaderboard: async () => {}
    };
  }

  ui.color.value = DEFAULT_COLOR;

  if (!window.supabase?.createClient) {
    ui.msg.textContent = 'Leaderboard unavailable (Supabase not loaded).';
    return {
      handleBestScoreChange() {},
      loadLeaderboard: async () => {}
    };
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const getStoredBest = () => Number(localStorage.getItem(bestStorageKey) || 0);
  const getSubmittedScore = () => Number(localStorage.getItem(submittedStorageKey) || 0);
  const setMessage = (text) => {
    ui.msg.textContent = text;
  };

  function syncSubmitLock(currentBest = getStoredBest()) {
    const submitted = getSubmittedScore();
    const shouldLock = Number.isFinite(currentBest) && currentBest > 0 && submitted >= currentBest;
    if (ui.submitBtn) ui.submitBtn.disabled = shouldLock;
    if (shouldLock) {
      setMessage(SUBMIT_LOCK_MESSAGE);
    } else if (ui.msg.textContent === SUBMIT_LOCK_MESSAGE) {
      setMessage('');
    }
    return shouldLock;
  }

  async function loadLeaderboard() {
    ui.list.innerHTML = '<li>Loading…</li>';
    const { data, error } = await sb
      .from('scores')
      .select('initials, color, score, created_at')
      .order('score', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(10);

    if (error) {
      ui.list.innerHTML = `<li>Failed to load: ${error.message}</li>`;
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    ui.list.innerHTML = '';
    rows.forEach((row) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = row.initials;
      name.style.fontWeight = '700';
      if (row.color) name.style.color = row.color;
      li.appendChild(name);
      li.append(` — ${row.score}`);
      ui.list.appendChild(li);
    });

    if (rows.length === 0) {
      ui.list.innerHTML = '<li>No scores yet — be the first!</li>';
    }
  }

  function validateInitials(s) {
    return /^[A-Za-z]{2}$/.test(s);
  }

  function validateHex(color) {
    return /^#[0-9A-Fa-f]{6}$/.test(color);
  }

  async function onSubmit(e) {
    e.preventDefault();

    const initials = ui.initials.value.trim().toUpperCase();
    const color = ui.color.value;
    const score = Number(getBestScore()) || 0;

    if (!validateInitials(initials)) {
      setMessage('Please enter two letters (A–Z).');
      return;
    }
    if (!validateHex(color)) {
      setMessage('Pick a valid color.');
      return;
    }
    if (!Number.isFinite(score) || score <= 0) {
      setMessage('Play a round and set a best score before submitting.');
      return;
    }
    if (syncSubmitLock(score)) {
      setMessage(SUBMIT_LOCK_MESSAGE);
      return;
    }

    const { error } = await sb.from('scores').insert([{ initials, color, score }]);
    if (error) {
      setMessage(`Submit failed: ${error.message}`);
      return;
    }

    localStorage.setItem(submittedStorageKey, String(score));
    syncSubmitLock(score);
    setMessage('Score submitted!');
    ui.form.reset();
    ui.color.value = DEFAULT_COLOR;
    await loadLeaderboard();
  }

  ui.form.addEventListener('submit', onSubmit);
  syncSubmitLock();
  loadLeaderboard();

  return {
    syncSubmitLock,
    handleBestScoreChange(score) {
      syncSubmitLock(Number(score) || 0);
    },
    loadLeaderboard
  };
}
