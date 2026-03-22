import {
  createStore,
  createInitialGameState,
  getRunState,
  getSoloState,
  getMultiplayerState
} from './state.js';
import { createRenderer } from './render.js';
import { createTimer, formatElapsedMs } from './timer.js';
import { createHistoryController } from './history.js';
import {
  createMultiplayerLobby,
  getRaceStart,
  getRandomVitalTarget,
  getMultiplayerSnapshot,
  joinMultiplayerLobby,
  kickMultiplayerPlayer,
  leaveMultiplayerLobby,
  persistDailyRun,
  persistRunSeed,
  postWinningRun,
  startMultiplayerLobby,
  submitMultiplayerRoundResult
} from './api-client.js';
import { getRandomStartPage, getWikiPageByPath, getWikiPageByTitle } from './mw-browser-client.js';
import { createTargetPreviewController } from './target-preview.js';
import { createLobbyRealtimeClient, createLobbySnapshotPoller } from './realtime-client.js';
import { applyMultiplayerSnapshot } from './multiplayer-state.js';
import { getWikiRaceClientConfig } from './config.js';

const LOTTIE_WEB_CDN = 'https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js';
const SESSION_ID_STORAGE_KEY = 'wiki-race-session-id-v1';
const MULTIPLAYER_NICKNAME_STORAGE_KEY = 'wiki-race-multiplayer-nickname-v1';
const SEEDED_KEY_PATTERN = /^[a-f0-9]{24}$/i;
const RANDOM_VITAL_TARGET_MAX_ATTEMPTS = 20;
const AGI_TARGET_TITLE = 'Artificial general intelligence';
let lottieLoadPromise = null;

function isFullscreenActive() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

function loadLottieWeb() {
  if (window.lottie) return Promise.resolve(window.lottie);
  if (lottieLoadPromise) return lottieLoadPromise;

  lottieLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = LOTTIE_WEB_CDN;
    script.async = true;
    script.onload = () => resolve(window.lottie || null);
    script.onerror = () => reject(new Error('Failed to load lottie-web'));
    document.head.appendChild(script);
  });

  return lottieLoadPromise;
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function createWinConfetti(rootEl) {
  const confettiSrc = rootEl?.dataset?.confettiSrc || '';
  if (!confettiSrc || prefersReducedMotion()) {
    return {
      reset() {},
      prime() {},
      play() {}
    };
  }

  const container = document.createElement('div');
  container.className = 'wiki-race-confetti';
  rootEl.appendChild(container);

  let animation = null;
  let animationReadyPromise = null;
  let hasPlayedForRun = false;

  async function ensureAnimation() {
    if (animationReadyPromise) return animationReadyPromise;
    const lottie = await loadLottieWeb();
    if (!lottie) throw new Error('lottie-web unavailable');
    animation = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      path: confettiSrc,
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid slice'
      }
    });
    animation.setSpeed(0.6);
    animationReadyPromise = new Promise((resolve, reject) => {
      function onLoaded() {
        animation.removeEventListener('DOMLoaded', onLoaded);
        animation.removeEventListener('data_failed', onFailed);
        resolve(animation);
      }
      function onFailed() {
        animation.removeEventListener('DOMLoaded', onLoaded);
        animation.removeEventListener('data_failed', onFailed);
        reject(new Error('Failed to load confetti animation JSON'));
      }
      animation.addEventListener('DOMLoaded', onLoaded);
      animation.addEventListener('data_failed', onFailed);
    });
    animation.addEventListener('complete', () => {
      container.classList.remove('is-active');
    });
    return animationReadyPromise;
  }

  return {
    reset() {
      hasPlayedForRun = false;
      container.classList.remove('is-active');
      if (animation) animation.stop();
    },
    async prime() {
      try {
        const anim = await ensureAnimation();
        anim.goToAndStop(0, true);
      } catch (_err) {
        // Ignore warmup failures; game remains playable.
      }
    },
    async play() {
      if (hasPlayedForRun) return;
      hasPlayedForRun = true;
      try {
        const anim = await ensureAnimation();
        container.classList.add('is-active');
        requestAnimationFrame(() => {
          anim.goToAndPlay(0, true);
        });
      } catch (_err) {
        container.classList.remove('is-active');
      }
    }
  };
}

async function requestElementFullscreen(el) {
  if (!el) return false;
  try {
    if (el.requestFullscreen) {
      await el.requestFullscreen();
      return true;
    }
    if (el.webkitRequestFullscreen) {
      await Promise.resolve(el.webkitRequestFullscreen());
      return true;
    }
  } catch (_err) {
    return false;
  }
  return false;
}

async function exitAnyFullscreen() {
  try {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
      return true;
    }
    if (document.webkitExitFullscreen) {
      await Promise.resolve(document.webkitExitFullscreen());
      return true;
    }
  } catch (_err) {
    return false;
  }
  return false;
}

function normalizePathFromHref(href) {
  try {
    const url = new URL(href, window.location.origin);
    if (url.hostname === 'en.wikipedia.org' && url.pathname.startsWith('/wiki/')) {
      return url.pathname;
    }
    if (url.origin === window.location.origin && url.pathname.startsWith('/wiki/')) {
      return url.pathname;
    }
    return null;
  } catch (_err) {
    return null;
  }
}

function buildUiState(gameState, elapsedMs, historyController, toolbarState = {}, uiMeta = {}) {
  const runState = getRunState(gameState);
  const multiplayerState = getMultiplayerState(gameState);
  const allowedLinkPaths = runState.currentPage?.linkIndex?.map((link) => link.path) || [];
  const selectedMode = String(toolbarState.selectedMode || 'agi').trim() || 'agi';
  const seedInputValue = String(toolbarState.seedInputValue || '');
  const runSeedLabel = String(runState.runSeedLabel || '--');
  const isSeededMode = selectedMode === 'seeded';
  const isRandomMode = selectedMode === 'random_vital';
  const playMode = String(uiMeta.playMode || 'solo');
  const resultsBySessionId = new Map((multiplayerState.results || []).map((row) => [row.sessionId, row]));
  const connectionStatus = String(multiplayerState.realtime?.channelStatus || 'idle');
  const connectionLabels = {
    idle: 'Offline',
    subscribing: 'Connecting',
    subscribed: 'Live',
    stale: 'Stale',
    disconnected: 'Polling',
    closed: 'Closed',
    disabled: 'Disabled',
    error: 'Error'
  };
  const lobbyCode = multiplayerState.lobby?.code || null;
  const countdownValue = uiMeta.multiplayerCountdownValue;
  const hasJoinedMultiplayerLobby = Boolean(lobbyCode);
  const multiplayerRoundStarted = Boolean(multiplayerState.round);
  const multiplayerLobbyStatusLabel = Number.isFinite(countdownValue) && countdownValue > 0
    ? `starting in ${countdownValue}`
    : (multiplayerState.round
      ? (multiplayerState.round.endedAtUtc ? 'round finished' : 'round running')
      : 'lobby open');
  const multiplayerPlayers = (multiplayerState.players || []).map((player) => ({
    ...player,
    isSelf: player.sessionId === gameState.session?.sessionId,
    resultStatus: resultsBySessionId.get(player.sessionId)?.status || null,
    resultLabel: (() => {
      const result = resultsBySessionId.get(player.sessionId);
      if (!result) return multiplayerState.round ? 'Waiting' : '-';
      if (result.status === 'completed') {
        return `${formatElapsedMs(result.durationMs || 0)} • ${result.clickCount} clicks`;
      }
      if (result.status === 'abandoned') return 'Gave up';
      if (result.status === 'timeout') return 'Timed out';
      return result.status;
    })(),
    timeLabel: (() => {
      const result = resultsBySessionId.get(player.sessionId);
      if (!result) return '';
      if (result.status === 'completed') return formatElapsedMs(result.durationMs || 0);
      if (result.status === 'abandoned' || result.status === 'timeout') return 'abandon';
      return '';
    })(),
    clicksLabel: (() => {
      const result = resultsBySessionId.get(player.sessionId);
      if (!result) return '';
      if (result.status === 'completed') return String(result.clickCount);
      if (result.status === 'abandoned' || result.status === 'timeout') return 'abandon';
      return '';
    })()
  }));
  const canShowSeedField = isSeededMode
    ? !['loading_start', 'running'].includes(runState.status)
    : (isRandomMode && runSeedLabel !== '--' && runSeedLabel !== 'agi');
  return {
    playMode,
    selectedMode,
    status: runState.status,
    phase: gameState.phase,
    isArticleLoading: Boolean(gameState.ui?.isArticleLoading),
    clickCount: runState.clickCount,
    runSeedLabel,
    elapsedMs,
    canGoBack: historyController.canGoBack(),
    currentPageTitle: runState.currentPage?.displayTitle || null,
    articleHtml: runState.currentPage?.html || null,
    routeTitles: runState.route.map((step) => step.title),
    allowedLinkPaths,
    seedFieldValue: isSeededMode ? seedInputValue : (canShowSeedField ? runSeedLabel : ''),
    showSeedField: canShowSeedField,
    isSeedFieldEditable: isSeededMode,
    canCopySeedField: isRandomMode && canShowSeedField,
    toolbarErrorMessage: gameState.errorMessage || null,
    canStart: !toolbarState.isStartRequestPending
      && !(selectedMode === 'seeded' && !toolbarState.isSeedInputValid),
    disableModeSelection: Boolean(toolbarState.isStartRequestPending),
    multiplayerNicknameValue: String(uiMeta.multiplayerNicknameValue || ''),
    multiplayerLobbyCodeValue: String(uiMeta.multiplayerLobbyCodeValue || ''),
    multiplayerErrorMessage: String(uiMeta.multiplayerErrorMessage || ''),
    debugMode: Boolean(uiMeta.debugMode),
    hasJoinedMultiplayerLobby,
    multiplayerShareCode: lobbyCode,
    multiplayerConnectionStatus: connectionStatus,
    multiplayerConnectionStatusLabel: connectionLabels[connectionStatus] || 'Offline',
    multiplayerPlayers,
    canKickPlayers: Boolean(multiplayerState.isHost),
    canStartMultiplayerCountdown: Boolean(multiplayerState.isHost),
    multiplayerRoundStarted,
    multiplayerLobbyStatusLabel,
    multiplayerLeaderboard: multiplayerState.leaderboard || []
  };
}

function utcDateKey(d = new Date()) {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isAllowedCurrentPageLink(currentPage, path) {
  if (!currentPage?.linkIndex?.length) return false;
  return currentPage.linkIndex.some((link) => link.path === path);
}

function isTargetPageMatch(pagePayload, targetPage) {
  if (!pagePayload?.page || !targetPage) return false;
  const targetPath = targetPage.path;
  const currentPath = pagePayload.page.path;
  if (targetPath && currentPath && targetPath === currentPath) return true;

  const targetNorm = targetPage.normalizedTitle;
  const currentNorm = pagePayload.page.normalizedTitle;
  return Boolean(targetNorm && currentNorm && targetNorm === currentNorm);
}

async function copyTextToClipboard(text) {
  const value = String(text || '').trim();
  if (!value) return false;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_err) {
    // Fall through to the legacy copy path.
  }

  const fallbackInput = document.createElement('input');
  fallbackInput.type = 'text';
  fallbackInput.value = value;
  fallbackInput.setAttribute('readonly', 'readonly');
  fallbackInput.style.position = 'absolute';
  fallbackInput.style.left = '-9999px';
  document.body.appendChild(fallbackInput);
  fallbackInput.select();
  fallbackInput.setSelectionRange(0, value.length);

  try {
    return document.execCommand('copy');
  } catch (_err) {
    return false;
  } finally {
    fallbackInput.remove();
  }
}

// utility function to generate a UUIDv4 string for client-generated run/session IDs, 
// with fallback for older browsers without crypto support.
function createClientRunId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function getOrCreateSessionId() {
  const fallback = createClientRunId();
  try {
    const existing = localStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (existing) return existing;
    localStorage.setItem(SESSION_ID_STORAGE_KEY, fallback);
    return fallback;
  } catch (_err) {
    return fallback;
  }
}

async function bootstrap() {
  const root = document.getElementById('wiki-race-app');
  if (!root) return;
  const clientConfig = getWikiRaceClientConfig();
  const modeSubtitle = root.querySelector('[data-region="mode-subtitle"]');
  const store = createStore(createInitialGameState());
  const renderer = createRenderer(root);
  const historyController = createHistoryController();
  const winConfetti = createWinConfetti(root);
  const modeSelect = renderer.els.modeSelect;
  const seededInputWrap = renderer.els.seededInputWrap;
  const seededInput = renderer.els.seededInput;
  let currentTargetPage = null;
  let activeRunMeta = null;
  let startRequestPending = false;
  let startRequestToken = 0;
  let selectedMode = normalizeSelectedMode(modeSelect?.value || 'agi');
  let seedInputValue = '';
  let timer = null;
  const sessionId = getOrCreateSessionId();
  let playMode = 'solo';
  let multiplayerNicknameValue = '';
  let multiplayerLobbyCodeValue = '';
  let multiplayerErrorMessage = '';
  let multiplayerRealtimeClient = null;
  let multiplayerSnapshotPoller = null;
  let multiplayerCountdownValue = null;
  let multiplayerCountdownTimerId = null;
  let lastPreparedMultiplayerRoundId = null;
  let lastPreviewedMultiplayerRoundId = null;
  let pendingMultiplayerExitLobbyCode = null;

  store.updateState((prev) => ({
    ...prev,
    session: {
      ...prev.session,
      sessionId
    },
    solo: {
      ...prev.solo,
      selectedMode
    }
  }));
  multiplayerNicknameValue = loadStoredMultiplayerNickname();

  function phaseForRunStatus(status) {
    if (status === 'loading_start' || status === 'running') return 'running';
    if (status === 'won' || status === 'abandoned') return 'results';
    if (status === 'error') return 'error';
    return 'idle';
  }

  function getCurrentRunState() {
    return getRunState(store.getState());
  }

  function getCurrentMultiplayerState() {
    return getMultiplayerState(store.getState());
  }

  function updateRunState(updater) {
    store.updateState((prev) => {
      const nextRun = updater(getRunState(prev), prev);
      return {
        ...prev,
        phase: phaseForRunStatus(nextRun.status),
        run: nextRun
      };
    });
  }

  function updateSoloState(updater) {
    store.updateState((prev) => ({
      ...prev,
      solo: updater(getSoloState(prev), prev)
    }));
  }

  function updateMultiplayerState(updater) {
    store.updateState((prev) => ({
      ...prev,
      multiplayer: updater(getMultiplayerState(prev), prev)
    }));
  }

  function normalizeSelectedMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    if (mode === 'random_vital' || mode === 'seeded') return mode;
    return 'agi';
  }

  function sanitizeSeedKey(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-f0-9]/g, '')
      .slice(0, 24);
  }

  function sanitizeNickname(value) {
    return String(value || '')
      .replace(/[^A-Za-z]/g, '')
      .slice(0, 10);
  }

  function sanitizeLobbyCode(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);
  }

  function isValidSeedKey(value) {
    return SEEDED_KEY_PATTERN.test(String(value || ''));
  }

  function isValidNickname(value) {
    return /^[A-Za-z]{3,10}$/.test(String(value || ''));
  }

  function isValidLobbyCode(value) {
    return /^[A-Z0-9]{6}$/.test(String(value || ''));
  }

  function getSelectedMode() {
    return selectedMode;
  }

  function setMultiplayerError(message = '') {
    multiplayerErrorMessage = String(message || '').trim();
    renderUi();
  }

  function persistMultiplayerNickname(value) {
    try {
      localStorage.setItem(MULTIPLAYER_NICKNAME_STORAGE_KEY, value);
    } catch (_err) {
      // Ignore storage failures; the field remains usable for the current session.
    }
  }

  function loadStoredMultiplayerNickname() {
    try {
      return sanitizeNickname(localStorage.getItem(MULTIPLAYER_NICKNAME_STORAGE_KEY) || '');
    } catch (_err) {
      return '';
    }
  }

  function getToolbarState() {
    return {
      selectedMode,
      seedInputValue,
      isSeedInputValid: isValidSeedKey(seedInputValue),
      isStartRequestPending: startRequestPending
    };
  }

  function renderUi(elapsedMs = timer ? timer.getElapsedMs() : 0) {
    renderer.renderState(buildUiState(store.getState(), elapsedMs, historyController, getToolbarState(), {
      playMode,
      multiplayerNicknameValue,
      multiplayerLobbyCodeValue,
      multiplayerErrorMessage,
      multiplayerCountdownValue,
      debugMode: clientConfig.debugMode
    }));
    targetPreview.render();
  }

  function setArticleLoading(isLoading) {
    store.updateState((prev) => ({
      ...prev,
      ui: {
        ...prev.ui,
        isArticleLoading: Boolean(isLoading)
      }
    }));
  }

  function clearToolbarError() {
    const currentState = store.getState();
    if (!currentState.errorMessage) return;
    store.updateState((prev) => ({ ...prev, errorMessage: null }));
  }

  // create instance of controller that shows target page previews (via target-preview.js)
  const targetPreview = createTargetPreviewController({
    modeSubtitle,
    isPreviewAvailable: () => {
      if (playMode === 'solo') {
        return getCurrentRunState().status !== 'idle';
      }
      return Boolean(getCurrentMultiplayerState().round?.endPage?.title);
    },
    fetchPageByTitle: getWikiPageByTitle
  });

  // activeRunMeta holds client-generated metadata for the current run, 
  // which will be included in the payload when submitting results to the backend.
  function initializeRunMeta(mode) {
    activeRunMeta = {
      runId: createClientRunId(),
      sessionId,
      startedAtUtc: new Date().toISOString(),
      mode,
      dateKey: null,
      seedSource: null,
      seedHash: null
    };
  }

  // after game win, build a payload of run data to submit to the backend for validation and persistence.
  function buildWinningRunPayload(durationMs) {
    const gameState = store.getState();
    const runState = getRunState(gameState);
    if (!activeRunMeta || !runState.startPage || !runState.targetPage || !runState.route.length) {
      return null;
    }

    return {
      runId: activeRunMeta.runId,
      sessionId: activeRunMeta.sessionId,
      mode: activeRunMeta.mode,
      dateKey: activeRunMeta.dateKey,
      seedSource: activeRunMeta.seedSource,
      seedHash: activeRunMeta.seedHash,
      startedAtUtc: activeRunMeta.startedAtUtc,
      completedAtUtc: new Date().toISOString(),
      durationMs: Math.max(0, Math.floor(Number(durationMs) || 0)),
      clickCount: Math.max(0, Math.floor(Number(runState.clickCount) || 0)),
      startPage: runState.startPage,
      targetPage: runState.targetPage,
      route: runState.route.map((step) => ({
        title: step.title,
        path: step.path,
        url: step.url,
        moveType: step.moveType,
        clickCountAfterStep: step.clickCountAfterStep,
        redirectFollowed: Boolean(step.redirectFollowed)
      }))
    };
  }

  function stopMultiplayerCountdown() {
    if (multiplayerCountdownTimerId != null) {
      clearTimeout(multiplayerCountdownTimerId);
      multiplayerCountdownTimerId = null;
    }
    multiplayerCountdownValue = null;
  }

  async function disconnectMultiplayerRealtime() {
    if (multiplayerSnapshotPoller) {
      multiplayerSnapshotPoller.stop();
      multiplayerSnapshotPoller = null;
    }
    if (multiplayerRealtimeClient) {
      await multiplayerRealtimeClient.disconnect();
      multiplayerRealtimeClient = null;
    }
    updateMultiplayerState((prevMultiplayer) => ({
      ...prevMultiplayer,
      realtime: {
        ...prevMultiplayer.realtime,
        channelStatus: 'idle',
        isPolling: false
      }
    }));
  }

  function resetLocalMultiplayerView({ message = '' } = {}) {
    stopMultiplayerCountdown();
    lastPreparedMultiplayerRoundId = null;
    lastPreviewedMultiplayerRoundId = null;
    pendingMultiplayerExitLobbyCode = null;
    targetPreview.invalidate();
    timer.reset();
    historyController.reset();
    store.setState({
      ...createInitialGameState(),
      mode: 'solo',
      session: {
        sessionId,
        nickname: store.getState().session?.nickname || null
      },
      solo: {
        ...getSoloState(store.getState()),
        selectedMode
      }
    });
    multiplayerLobbyCodeValue = '';
    multiplayerErrorMessage = String(message || '').trim();
    syncModeSubtitle();
    renderUi(0);
  }

  async function prepareMultiplayerRound(round) {
    if (!round?.id || !round?.startPage?.title) return;
    if (lastPreparedMultiplayerRoundId === round.id && getCurrentRunState().currentPage) return;

    const countdownLength = 3;
    lastPreparedMultiplayerRoundId = round.id;
    stopMultiplayerCountdown();
    multiplayerCountdownValue = countdownLength;
    store.updateState((prev) => ({
      ...prev,
      phase: 'countdown',
      run: {
        ...getRunState(prev),
        status: 'loading_start',
        currentPage: null,
        clickCount: 0,
        route: [],
        history: {
          stack: [],
          cursor: -1
        }
      }
    }));
    renderUi(0);

    const tick = async () => {
      if (multiplayerCountdownValue == null) return;
      if (multiplayerCountdownValue > 1) {
        multiplayerCountdownValue -= 1;
        renderUi(0);
        multiplayerCountdownTimerId = window.setTimeout(tick, 1000);
        return;
      }

      stopMultiplayerCountdown();
      historyController.reset();
      timer.reset();
      try {
        await loadAndRenderStartPageByTitle(round.startPage.title, {
          moveType: 'start',
          countMove: false
        });
        timer.start();
        updateRunState((prevRun) => ({
          ...prevRun,
          status: 'running'
        }));
        store.updateState((prev) => ({
          ...prev,
          phase: 'running'
        }));
        renderUi(timer.getElapsedMs());
      } catch (err) {
        lastPreparedMultiplayerRoundId = null;
        updateRunState((prevRun) => ({
          ...prevRun,
          status: 'error'
        }));
        setMultiplayerError(err?.message || 'Failed to load multiplayer start page.');
      }
    };

    multiplayerCountdownTimerId = window.setTimeout(tick, 1000);
  }

  async function applyIncomingMultiplayerSnapshot(snapshot) {
    if (!snapshot?.lobby) return;
    const prevState = store.getState();
    if (pendingMultiplayerExitLobbyCode && snapshot.lobby.code === pendingMultiplayerExitLobbyCode) {
      return;
    }
    const currentLobbyCode = String(prevState.multiplayer?.lobby?.code || '').trim();
    const currentPlayerStillActive = Array.isArray(snapshot.players)
      && snapshot.players.some((player) => player?.sessionId === sessionId);
    if (currentLobbyCode && snapshot.lobby.code === currentLobbyCode && !currentPlayerStillActive) {
      await disconnectMultiplayerRealtime();
      resetLocalMultiplayerView({ message: 'You were removed from the lobby.' });
      return;
    }
    const nextState = applyMultiplayerSnapshot(prevState, snapshot, { sessionId });
    store.setState(nextState);
    setMultiplayerError('');
    if (snapshot.round?.id && snapshot.round.endPage?.title && snapshot.round.id !== lastPreviewedMultiplayerRoundId) {
      const previewToken = targetPreview.beginRun();
      void targetPreview.prefetch(snapshot.round.endPage, previewToken);
      lastPreviewedMultiplayerRoundId = snapshot.round.id;
    }
    if (!snapshot.round) {
      lastPreviewedMultiplayerRoundId = null;
      targetPreview.invalidate();
    }
    syncModeSubtitle();
    if (snapshot.round && !snapshot.round.endedAtUtc) {
      await prepareMultiplayerRound(snapshot.round);
      renderUi(timer.getElapsedMs());
      return;
    }
    if (snapshot.round?.endedAtUtc) {
      stopMultiplayerCountdown();
      timer.stop();
      renderUi(timer.getElapsedMs());
      return;
    }
    renderUi();
  }

  function updateRealtimeStatus(nextStatus, nextLastEventAtUtc = null) {
    updateMultiplayerState((prevMultiplayer) => ({
      ...prevMultiplayer,
      realtime: {
        ...prevMultiplayer.realtime,
        channelStatus: nextStatus,
        lastEventAtUtc: nextLastEventAtUtc ?? prevMultiplayer.realtime.lastEventAtUtc
      }
    }));
  }

  async function ensureSnapshotPoller(lobbyCode) {
    if (!multiplayerSnapshotPoller) {
      multiplayerSnapshotPoller = createLobbySnapshotPoller({
        lobbyCode,
        onSnapshot: (snapshot) => {
          void applyIncomingMultiplayerSnapshot(snapshot);
        },
        onError: (err) => {
          setMultiplayerError(err?.message || 'Failed to refresh lobby snapshot.');
        }
      });
    }
    const started = await multiplayerSnapshotPoller.start({ immediate: true });
    updateMultiplayerState((prevMultiplayer) => ({
      ...prevMultiplayer,
      realtime: {
        ...prevMultiplayer.realtime,
        isPolling: Boolean(started)
      }
    }));
  }

  async function stopSnapshotPoller() {
    if (multiplayerSnapshotPoller) {
      multiplayerSnapshotPoller.stop();
    }
    updateMultiplayerState((prevMultiplayer) => ({
      ...prevMultiplayer,
      realtime: {
        ...prevMultiplayer.realtime,
        isPolling: false
      }
    }));
  }

  async function connectMultiplayerRealtime(lobbyCode) {
    await disconnectMultiplayerRealtime();
    multiplayerRealtimeClient = createLobbyRealtimeClient({
      lobbyCode,
      onEvent: () => {
        void getMultiplayerSnapshot(lobbyCode)
          .then((snapshot) => applyIncomingMultiplayerSnapshot(snapshot))
          .catch((err) => setMultiplayerError(err?.message || 'Failed to refresh lobby snapshot.'));
      },
      onStatusChange: (payload) => {
        updateRealtimeStatus(payload?.status || 'idle', payload?.lastEventAtUtc || null);
        if (payload?.status === 'subscribed') {
          void stopSnapshotPoller();
        }
        if (payload?.status === 'stale' || payload?.status === 'disconnected') {
          void ensureSnapshotPoller(lobbyCode);
        }
        renderUi();
      },
      onError: (err) => {
        setMultiplayerError(err?.message || 'Realtime connection failed.');
      }
    });
    const connected = await multiplayerRealtimeClient.connect();
    if (!connected) {
      await ensureSnapshotPoller(lobbyCode);
    }
  }

  async function createOrJoinMultiplayer({ action }) {
    const nickname = sanitizeNickname(multiplayerNicknameValue);
    const lobbyCode = sanitizeLobbyCode(multiplayerLobbyCodeValue);
    if (!isValidNickname(nickname)) {
      setMultiplayerError('Nickname must be 3-10 letters.');
      return null;
    }
    persistMultiplayerNickname(nickname);
    multiplayerNicknameValue = nickname;
    store.updateState((prev) => ({
      ...prev,
      session: {
        ...prev.session,
        nickname
      }
    }));

    if (action === 'join' && !isValidLobbyCode(lobbyCode)) {
      setMultiplayerError('Lobby code must be 6 letters or numbers.');
      return null;
    }

    try {
      const snapshot = action === 'create'
        ? await createMultiplayerLobby({ sessionId, nickname })
        : await joinMultiplayerLobby(lobbyCode, { sessionId, nickname });
      pendingMultiplayerExitLobbyCode = null;
      playMode = 'multiplayer';
      lastPreparedMultiplayerRoundId = null;
      multiplayerLobbyCodeValue = snapshot?.lobby?.code || lobbyCode;
      await applyIncomingMultiplayerSnapshot(snapshot);
      if (snapshot?.lobby?.code) {
        await connectMultiplayerRealtime(snapshot.lobby.code);
      }
      return snapshot;
    } catch (err) {
      setMultiplayerError(err?.message || `Failed to ${action} lobby.`);
      return null;
    }
  }

  async function leaveCurrentMultiplayerLobby({ shouldConfirm = false } = {}) {
    const multiplayerState = getCurrentMultiplayerState();
    if (!multiplayerState.lobby?.code) return;
    const lobbyCode = multiplayerState.lobby.code;
    if (shouldConfirm && multiplayerState.round && !window.confirm('Leave this lobby and abandon the current multiplayer round?')) {
      return;
    }

    pendingMultiplayerExitLobbyCode = lobbyCode;
    await disconnectMultiplayerRealtime();

    try {
      await leaveMultiplayerLobby(lobbyCode, { sessionId });
    } catch (err) {
      setMultiplayerError(err?.message || 'Failed to leave lobby.');
    }

    resetLocalMultiplayerView();
  }

  function syncModeSubtitle() {
    if (!modeSubtitle) return;
    if (playMode === 'multiplayer') {
      const multiplayerState = getCurrentMultiplayerState();
      if (multiplayerState.round?.endPage?.url && multiplayerState.round?.endPage?.title) {
        const targetTitle = String(multiplayerState.round.endPage.title).trim();
        modeSubtitle.innerHTML = `Join a shared race to <a data-role="target-page-link" href="${multiplayerState.round.endPage.url}" target="_blank" rel="noopener noreferrer">${targetTitle}</a>. Lobby progress updates live and falls back to snapshot polling if realtime degrades.`;
      } else {
        modeSubtitle.innerHTML = 'Create or join a lobby to race against others.';
      }
      targetPreview.bindLinkEvents();
      return;
    }
    if (getSelectedMode() === 'random_vital') {
      if (currentTargetPage?.url && currentTargetPage?.title) {
        const targetTitle = String(currentTargetPage.title).trim();
        modeSubtitle.innerHTML = `Reach the wikipedia page for <a data-role="target-page-link" href="${currentTargetPage.url}" target="_blank" rel="noopener noreferrer">${targetTitle}</a> using as few clicks as possible. Start from a random Wikipedia article.`;
        targetPreview.bindLinkEvents();
        return;
      }
      modeSubtitle.innerHTML = 'Reach the wikipedia page for ______ using as few clicks as possible. Start from a random Wikipedia article.';
      targetPreview.bindLinkEvents();
      return;
    }
    if (getSelectedMode() === 'seeded') {
      if (currentTargetPage?.url && currentTargetPage?.title) {
        const targetTitle = String(currentTargetPage.title).trim();
        modeSubtitle.innerHTML = `Replay the seeded wikipedia race to <a data-role="target-page-link" href="${currentTargetPage.url}" target="_blank" rel="noopener noreferrer">${targetTitle}</a>. Enter a stored 24-character seed key to load the run.`;
        targetPreview.bindLinkEvents();
        return;
      }
      modeSubtitle.innerHTML = 'Enter a stored 24-character seed key to replay a saved wikipedia race.';
      targetPreview.bindLinkEvents();
      return;
    }
    modeSubtitle.innerHTML = 'Reach the wikipedia page for <a data-role="target-page-link" href="https://en.wikipedia.org/wiki/Artificial_general_intelligence" target="_blank" rel="noopener noreferrer">artificial general intelligence</a> using as few article links as possible. Daily challenge resets at 00:00 UTC.';
    targetPreview.bindLinkEvents();
  }
  syncModeSubtitle();

  function canSwitchPlayMode(nextMode) {
    if (playMode === nextMode) return true;
    const multiplayerState = getCurrentMultiplayerState();
    if (playMode === 'multiplayer' && multiplayerState.lobby?.code) {
      setMultiplayerError('Leave the current multiplayer lobby before switching tabs.');
      return false;
    }
    if (playMode === 'solo' && ['running', 'loading_start'].includes(getCurrentRunState().status)) {
      store.updateState((prev) => ({
        ...prev,
        errorMessage: 'Finish or abandon the current solo run before switching tabs.'
      }));
      renderUi();
      return false;
    }
    return true;
  }

  function setPlayMode(nextMode) {
    if (!canSwitchPlayMode(nextMode)) return;
    playMode = nextMode === 'multiplayer' ? 'multiplayer' : 'solo';
    store.updateState((prev) => ({
      ...prev,
      mode: playMode === 'multiplayer'
        ? (getMultiplayerState(prev).lobby?.code ? 'multiplayer' : prev.mode)
        : 'solo'
    }));
    if (playMode === 'solo') {
      setMultiplayerError('');
    } else {
      clearToolbarError();
    }
    syncModeSubtitle();
    renderUi();
  }

  renderer.onControl('show-solo', () => {
    setPlayMode('solo');
  });

  renderer.onControl('show-multiplayer', () => {
    setPlayMode('multiplayer');
  });

  modeSelect?.addEventListener('change', () => {
    selectedMode = normalizeSelectedMode(modeSelect.value);
    targetPreview.invalidate();
    currentTargetPage = null;
    clearToolbarError();
    const nextMode = getSelectedMode();
    store.updateState((prev) => ({
      ...prev,
      mode: 'solo',
      solo: {
        ...prev.solo,
        selectedMode: nextMode,
        seedHash: null
      },
      run: {
        ...getRunState(prev),
        runSeedLabel: nextMode === 'agi' ? 'agi' : '--'
      }
    }));
    renderUi();
    syncModeSubtitle();
  });
  seededInput?.addEventListener('input', () => {
    const nextSeed = sanitizeSeedKey(seededInput.value);
    if (nextSeed !== seededInput.value) {
      seededInput.value = nextSeed;
    }
    seedInputValue = nextSeed;
    clearToolbarError();
    renderUi();
  });
  renderer.els.multiplayerNickname?.addEventListener('input', () => {
    const nextNickname = sanitizeNickname(renderer.els.multiplayerNickname.value);
    if (nextNickname !== renderer.els.multiplayerNickname.value) {
      renderer.els.multiplayerNickname.value = nextNickname;
    }
    multiplayerNicknameValue = nextNickname;
    setMultiplayerError('');
  });
  renderer.els.multiplayerLobbyCode?.addEventListener('input', () => {
    const nextCode = sanitizeLobbyCode(renderer.els.multiplayerLobbyCode.value);
    if (nextCode !== renderer.els.multiplayerLobbyCode.value) {
      renderer.els.multiplayerLobbyCode.value = nextCode;
    }
    multiplayerLobbyCodeValue = nextCode;
    setMultiplayerError('');
  });
  seededInputWrap?.addEventListener('click', async () => {
    if (getSelectedMode() !== 'random_vital') return;
    const seedToCopy = String(getCurrentRunState().runSeedLabel || '').trim();
    if (!seedToCopy || seedToCopy === '--' || seedToCopy === 'agi') return;

    seededInput.select();
    seededInput.setSelectionRange(0, seedToCopy.length);
    const copied = await copyTextToClipboard(seedToCopy);
    seededInput.setAttribute('title', copied ? 'Copied' : 'Copy failed');
    seededInputWrap.setAttribute('title', copied ? 'Copied' : 'Copy failed');
  });
  renderer.onControl('create-lobby', () => {
    void createOrJoinMultiplayer({ action: 'create' });
  });
  renderer.onControl('join-lobby', () => {
    void createOrJoinMultiplayer({ action: 'join' });
  });
  renderer.onControl('copy-lobby-code', async () => {
    const code = getCurrentMultiplayerState().lobby?.code || '';
    if (!code) return;
    await copyTextToClipboard(code);
  });
  renderer.onControl('leave-lobby-inline', () => {
    const shouldConfirm = Boolean(getCurrentMultiplayerState().round && !getCurrentMultiplayerState().round.endedAtUtc);
    void leaveCurrentMultiplayerLobby({ shouldConfirm });
  });
  renderer.onControl('start-lobby-race', async () => {
    const multiplayerState = getCurrentMultiplayerState();
    if (!multiplayerState.lobby?.code) return;
    try {
      const racePair = await generateRandomVitalRacePair();
      const snapshot = await startMultiplayerLobby(multiplayerState.lobby.code, {
        sessionId,
        startPage: racePair.startPayload.page,
        endPage: racePair.endPayload.page
      });
      await applyIncomingMultiplayerSnapshot(snapshot);
    } catch (err) {
      setMultiplayerError(err?.message || 'Failed to start lobby race.');
    }
  });
  renderer.els.multiplayerRoster?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest?.('[data-action="kick-player"]');
    if (!button) return;
    const targetSessionId = String(button.getAttribute('data-session-id') || '').trim();
    const multiplayerState = getCurrentMultiplayerState();
    if (!multiplayerState.lobby?.code || !targetSessionId) return;
    void kickMultiplayerPlayer(multiplayerState.lobby.code, {
      sessionId,
      targetSessionId
    }).then((snapshot) => applyIncomingMultiplayerSnapshot(snapshot))
      .catch((err) => setMultiplayerError(err?.message || 'Failed to kick player.'));
  });

  function syncFullscreenButtonLabel() {
    renderer.setFullscreenToggleState(isFullscreenActive());
  }

  syncFullscreenButtonLabel();
  document.addEventListener('fullscreenchange', syncFullscreenButtonLabel);
  document.addEventListener('webkitfullscreenchange', syncFullscreenButtonLabel);

  timer = createTimer((elapsedMs) => {
    renderUi(elapsedMs);
  });

  function applyPageAsRunStep(page, { moveType = 'click', countMove = false } = {}) {
    updateRunState((prevRun) => {
      const nextClicks = countMove ? prevRun.clickCount + 1 : prevRun.clickCount;
      const nextRoute = [...prevRun.route];
      nextRoute.push({
        title: page.displayTitle,
        path: page.page.path,
        url: page.page.url,
        moveType,
        clickCountAfterStep: nextClicks,
        redirectFollowed: Boolean(page?.redirect?.followed)
      });

      return {
        ...prevRun,
        currentPage: page,
        clickCount: nextClicks,
        route: nextRoute,
        status: prevRun.status === 'loading_start' ? 'running' : prevRun.status
      };
    });
    clearToolbarError();
    return page;
  }

  async function loadAndRenderStartPageByTitle(title, { moveType = 'click', countMove = false } = {}) {
    const page = await getWikiPageByTitle(title);
    return applyPageAsRunStep(page, { moveType, countMove });
  }

  async function generateRandomVitalRacePair() {
    const startPayload = await getRandomStartPage();
    let lastTargetError = null;

    for (let attempt = 0; attempt < RANDOM_VITAL_TARGET_MAX_ATTEMPTS; attempt += 1) {
      let targetRef = null;
      try {
        const targetResponse = await getRandomVitalTarget();
        targetRef = targetResponse?.endPage || null;
      } catch (err) {
        lastTargetError = err;
        continue;
      }

      if (!targetRef?.title) continue;
      if (targetRef.path && targetRef.path === startPayload.page.path) continue;

      try {
        const endPayload = await getWikiPageByTitle(targetRef.title);
        if (!endPayload?.page?.path) continue;
        if (endPayload.page.path === startPayload.page.path) continue;
        if (endPayload.flags?.isDisambiguation) continue;
        return {
          dateKey: utcDateKey(),
          startPayload,
          endPayload
        };
      } catch (err) {
        lastTargetError = err;
      }
    }

    const error = new Error(lastTargetError?.message || 'Failed to generate random race target page');
    error.status = lastTargetError?.status || 502;
    throw error;
  }

  async function generateAgiRacePair() {
    const startPayload = await getRandomStartPage();
    const endPayload = await getWikiPageByTitle(AGI_TARGET_TITLE);
    return {
      dateKey: utcDateKey(),
      startPayload,
      endPayload
    };
  }

  function isAgiRunMissingError(err) {
    return err?.status === 404 && err?.payload?.code === 'agi_run_missing';
  }

  async function startRun() {
    const selectedMode = getSelectedMode();
    const submittedSeed = selectedMode === 'seeded' ? sanitizeSeedKey(seedInputValue) : null;
    if (selectedMode === 'seeded' && !isValidSeedKey(submittedSeed)) {
      store.updateState((prev) => ({
        ...prev,
        errorMessage: 'The seed is invalid.'
      }));
      renderUi();
      return null;
    }

    startRequestToken += 1;
    const requestToken = startRequestToken;
    const fallbackRunStatus = 'idle';
    const runPreviewToken = targetPreview.beginRun();
    startRequestPending = true;
    clearToolbarError();
    winConfetti.reset();
    historyController.reset();
    timer.reset();
    currentTargetPage = null;
    activeRunMeta = null;
    store.setState({
      ...createInitialGameState(),
      mode: 'solo',
      phase: 'running',
      session: {
        sessionId,
        nickname: store.getState().session?.nickname || null
      },
      solo: {
        ...getSoloState(store.getState()),
        selectedMode,
        activeRunId: null,
        seedHash: selectedMode === 'seeded' ? submittedSeed : null
      },
      run: {
        ...getRunState(createInitialGameState()),
        status: 'loading_start',
        runSeedLabel: selectedMode === 'agi' ? 'agi' : (selectedMode === 'seeded' ? submittedSeed : '--')
      }
    });
    renderUi(0);
    syncModeSubtitle();
    void requestElementFullscreen(root);

    try {
      let startConfig = null;
      let startPagePayload = null;

      if (selectedMode === 'random_vital') {
        const racePair = await generateRandomVitalRacePair();
        if (requestToken !== startRequestToken) return null;

        const seedResult = await persistRunSeed({
          mode: 'random_vital',
          startPage: racePair.startPayload.page,
          endPage: racePair.endPayload.page,
          dateKey: racePair.dateKey
        });
        if (requestToken !== startRequestToken) return null;

        startConfig = {
          dateKey: racePair.dateKey,
          startPage: racePair.startPayload.page,
          endPage: racePair.endPayload.page,
          seedSource: seedResult?.seedSource || null,
          seedHash: seedResult?.seedHash || null
        };
        startPagePayload = racePair.startPayload;
      } else if (selectedMode === 'agi') {
        try {
          startConfig = await getRaceStart({
            target: 'agi'
          });
        } catch (err) {
          if (!isAgiRunMissingError(err)) throw err;

          const racePair = await generateAgiRacePair();
          if (requestToken !== startRequestToken) return null;

          const seedResult = await persistRunSeed({
            mode: 'agi',
            startPage: racePair.startPayload.page,
            endPage: racePair.endPayload.page,
            dateKey: racePair.dateKey
          });
          if (requestToken !== startRequestToken) return null;

          startConfig = await persistDailyRun({
            mode: 'agi',
            dateKey: racePair.dateKey,
            seedHash: seedResult?.seedHash || null
          });
          if (requestToken !== startRequestToken) return null;

          if (startConfig?.startPage?.path === racePair.startPayload.page.path) {
            startPagePayload = racePair.startPayload;
          }
        }
      } else {
        startConfig = await getRaceStart({
          target: selectedMode,
          seed: selectedMode === 'seeded' ? submittedSeed : null
        });
      }
      if (requestToken !== startRequestToken) return null;

      initializeRunMeta(selectedMode);
      if (activeRunMeta) {
        activeRunMeta.mode = selectedMode;
        activeRunMeta.dateKey = startConfig?.dateKey || null;
        activeRunMeta.seedSource = startConfig?.seedSource || null;
        activeRunMeta.seedHash = selectedMode === 'seeded'
          ? submittedSeed
          : (startConfig?.seedHash || null);
      }
      updateSoloState((prevSolo) => ({
        ...prevSolo,
        selectedMode,
        activeRunId: activeRunMeta?.runId || null,
        seedHash: activeRunMeta?.seedHash || null
      }));
      currentTargetPage = startConfig.endPage || null;
      syncModeSubtitle();
      store.updateState((prev) => ({
        ...prev,
        run: {
          ...getRunState(prev),
          dateKey: startConfig.dateKey,
          targetPage: startConfig.endPage,
          startPage: startConfig.startPage,
          runSeedLabel: selectedMode === 'agi'
            ? 'agi'
            : (selectedMode === 'seeded' ? submittedSeed : (startConfig?.seedHash || '--')),
          status: 'loading_start'
        }
      }));
      renderUi(0);
      void targetPreview.prefetch(startConfig.endPage, runPreviewToken);

      const page = startPagePayload
        ? applyPageAsRunStep(startPagePayload, {
          moveType: 'start',
          countMove: false
        })
        : await loadAndRenderStartPageByTitle(startConfig.startPage.title, {
          moveType: 'start',
          countMove: false
        });

      timer.start();

      updateRunState((prevRun) => ({
        ...prevRun,
        status: 'running'
      }));
      renderUi(timer.getElapsedMs());
      return page;
    } catch (err) {
      if (requestToken !== startRequestToken) return null;
      const isInvalidSeedError = selectedMode === 'seeded' && (err?.status === 400 || err?.status === 404);
      const currentStatus = getCurrentRunState().status;
      store.updateState((prev) => ({
        ...prev,
        phase: isInvalidSeedError
          ? phaseForRunStatus(fallbackRunStatus)
          : (currentStatus === 'idle' || currentStatus === 'won' || currentStatus === 'abandoned' ? prev.phase : 'error'),
        run: {
          ...getRunState(prev),
          status: isInvalidSeedError
            ? fallbackRunStatus
            : (currentStatus === 'idle' || currentStatus === 'won' || currentStatus === 'abandoned'
              ? getRunState(prev).status
              : 'error')
        },
        errorMessage: isInvalidSeedError
          ? 'The seed is invalid.'
          : (err?.message || 'Failed to start the race.')
      }));
      renderUi();
      if (!isInvalidSeedError) {
        targetPreview.invalidate();
      }
      syncModeSubtitle();
      return null;
    } finally {
      if (requestToken === startRequestToken) {
        startRequestPending = false;
        renderUi();
      }
    }
  }

  async function handleArticleNav(path, source) {
    const gameState = store.getState();
    const runState = getRunState(gameState);
    if (runState.status !== 'running' || !runState.currentPage || gameState.ui?.isArticleLoading) return;

    setArticleLoading(true);
    renderUi(timer.getElapsedMs());
    const snapshot = {
      page: runState.currentPage,
      routeLength: runState.route.length,
      scrollTop: renderer.els.article.scrollTop
    };
    historyController.pushSnapshot(snapshot);

    let finalElapsedMs = null;
    try {
      const page = await getWikiPageByPath(path);
      const reachedTarget = isTargetPageMatch(page, getCurrentRunState().targetPage);
      if (reachedTarget && getCurrentRunState().status === 'running') {
        finalElapsedMs = timer.stop();
      }

      updateRunState((prevRun) => {
        const clickCount = prevRun.clickCount + 1;
        const route = [...prevRun.route, {
          title: page.displayTitle,
          path: page.page.path,
          url: page.page.url,
          moveType: source,
          clickCountAfterStep: clickCount,
          redirectFollowed: Boolean(page?.redirect?.followed)
        }];
        return {
          ...prevRun,
          currentPage: page,
          clickCount,
          route,
          status: reachedTarget ? 'won' : 'running'
        };
      });
      clearToolbarError();
      if (reachedTarget) {
        if (playMode === 'multiplayer') {
          const roundId = getCurrentMultiplayerState().round?.id;
          if (roundId) {
            void submitMultiplayerRoundResult(roundId, {
              sessionId,
              status: 'completed',
              durationMs: finalElapsedMs,
              clickCount: getCurrentRunState().clickCount
            }).then((result) => {
              if (result?.ok && result.payload) {
                return applyIncomingMultiplayerSnapshot(result.payload);
              }
              setMultiplayerError(result?.error || 'Failed to submit multiplayer result.');
              return null;
            });
          }
        } else {
          const payload = buildWinningRunPayload(finalElapsedMs);
          if (payload) {
            void postWinningRun(payload).then((result) => {
              if (!result?.ok) {
                console.warn('Failed to submit wiki race win result', {
                  mode: payload.mode,
                  runId: payload.runId,
                  seedHash: payload.seedHash || null,
                  error: result?.error || 'Unknown error',
                  status: result?.status ?? null,
                  payload: result?.payload || null
                });
              }
            });
          }
        }
        void winConfetti.play();
      }
    } catch (err) {
      updateRunState((prevRun) => ({
        ...prevRun,
        status: 'error'
      }));
      store.updateState((prev) => ({
        ...prev,
        errorMessage: err?.message || 'Page load failed. Start again.'
      }));
    } finally {
      setArticleLoading(false);
      renderUi(finalElapsedMs ?? timer.getElapsedMs());
    }
  }

  renderer.onControl('start', () => {
    renderer.els.startBtn?.scrollIntoView({
      block: 'start',
      inline: 'nearest',
      behavior: 'smooth'
    });
    void startRun();
  });

  renderer.onControl('fullscreen', async () => {
    if (isFullscreenActive()) {
      await exitAnyFullscreen();
    } else {
      await requestElementFullscreen(root);
    }
    syncFullscreenButtonLabel();
  });

  renderer.onControl('abandon', () => {
    const runState = getCurrentRunState();
    if (runState.status !== 'running') return;
    timer.stop();
    if (playMode === 'multiplayer') {
      const roundId = getCurrentMultiplayerState().round?.id;
      if (roundId) {
        void submitMultiplayerRoundResult(roundId, {
          sessionId,
          status: 'abandoned',
          clickCount: getCurrentRunState().clickCount
        }).then((result) => {
          if (result?.ok && result.payload) {
            return applyIncomingMultiplayerSnapshot(result.payload);
          }
          setMultiplayerError(result?.error || 'Failed to submit multiplayer abandon.');
          return null;
        });
      }
    } else {
      updateRunState((prevRun) => ({ ...prevRun, status: 'abandoned' }));
      renderUi();
    }
  });

  renderer.onControl('back', () => {
    const runState = getCurrentRunState();
    if (runState.status !== 'running' || !historyController.canGoBack()) return;
    historyController.goBackViaBrowser();
  });

  renderer.onArticleLinkClick((event, link) => {
    const runState = getCurrentRunState();
    const href = (link.getAttribute('href') || '').trim();
    if (href.startsWith('#')) {
      return;
    }

    if (runState.status !== 'running' || store.getState().ui?.isArticleLoading) {
      event.preventDefault();
      return;
    }

    const path = link.getAttribute('data-wiki-path') || normalizePathFromHref(href);
    if (!path) {
      event.preventDefault();
      return;
    }

    if (!isAllowedCurrentPageLink(runState.currentPage, path)) {
      event.preventDefault();
      store.updateState((prev) => ({
        ...prev,
        errorMessage: 'That link is not allowed in this game.'
      }));
      renderUi();
      return;
    }

    event.preventDefault();
    handleArticleNav(path, 'click');
  });

  window.addEventListener('popstate', () => {
    if (!historyController.consumeIgnoreNextPop()) return;

    const runState = getCurrentRunState();
    const snapshot = historyController.popSnapshot();
    if (!snapshot || runState.status !== 'running') return;

    updateRunState((prevRun) => {
      const clickCount = prevRun.clickCount + 1;
      const route = [...prevRun.route, {
        title: snapshot.page.displayTitle,
        path: snapshot.page.page.path,
        url: snapshot.page.page.url,
        moveType: 'browser_back',
        clickCountAfterStep: clickCount,
        redirectFollowed: Boolean(snapshot.page?.redirect?.followed)
      }];
      return {
        ...prevRun,
        currentPage: snapshot.page,
        clickCount,
        route
      };
    });

    renderUi();
    renderer.els.article.scrollTop = snapshot.scrollTop || 0;
  });

  renderUi(0);

  const warmConfetti = () => {
    void winConfetti.prime();
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(warmConfetti, { timeout: 1200 });
  } else {
    setTimeout(warmConfetti, 350);
  }
}

bootstrap();
