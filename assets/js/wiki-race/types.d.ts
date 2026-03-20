export type GameStatus = 'idle' | 'loading_start' | 'running' | 'won' | 'abandoned' | 'error';
export type GameMode = 'solo' | 'multiplayer';
export type GamePhase = 'idle' | 'lobby' | 'countdown' | 'running' | 'results' | 'error';
export type MultiplayerRealtimeStatus =
  | 'idle'
  | 'subscribing'
  | 'subscribed'
  | 'stale'
  | 'disconnected'
  | 'closed'
  | 'disabled'
  | 'error';

export interface WikiPageRef {
  title: string;
  normalizedTitle: string;
  path: string;
  url: string;
  pageId?: number;
}

export interface ValidLinkRef {
  href: string;
  path: string;
  title: string;
  normalizedTitle: string;
  text: string;
}

export interface RaceStartResponse {
  dateKey: string;
  startPage: WikiPageRef;
  endPage: WikiPageRef;
  seedSource: 'supabase' | 'memory' | 'generated';
  seedHash?: string | null;
}

export interface WikiPagePayload {
  page: WikiPageRef;
  canonicalPath: string;
  displayTitle: string;
  html: string;
  linkIndex: ValidLinkRef[];
  metrics: {
    validOutboundLinkCount: number;
    hasCategories: boolean;
  };
  flags: {
    isDisambiguation: boolean;
    isListLike: boolean;
    isStubLike: boolean;
    isDeadEnd: boolean;
  };
  fetchedAtUtc: string;
  cache: {
    source: 'cache' | 'fresh';
    key?: string;
    revid?: number;
  };
  redirect: {
    followed: boolean;
    fromTitle?: string;
    toTitle?: string;
  };
}

export interface RunState {
  status: GameStatus;
  dateKey: string | null;
  startPage: WikiPageRef | null;
  targetPage: WikiPageRef | null;
  currentPage: WikiPagePayload | null;
  clickCount: number;
  runSeedLabel: string;
  timerStartedAtPerfMs: number | null;
  timerStoppedAtPerfMs: number | null;
  route: Array<{
    title: string;
    path: string;
    url: string;
    moveType: string;
    clickCountAfterStep: number;
    redirectFollowed: boolean;
  }>;
  history: {
    stack: unknown[];
    cursor: number;
  };
}

export interface SoloState {
  selectedMode: 'agi' | 'random_vital' | 'seeded';
  activeRunId: string | null;
  seedHash: string | null;
}

export interface MultiplayerState {
  lobby: MultiplayerLobbySnapshot | null;
  players: MultiplayerPlayerSnapshot[];
  round: MultiplayerRoundSnapshot | null;
  results: MultiplayerRoundResult[];
  leaderboard: MultiplayerLeaderboardRow[];
  isHost: boolean;
  realtime: {
    channelStatus: MultiplayerRealtimeStatus;
    lastEventAtUtc: string | null;
    lastSnapshotAtUtc: string | null;
    isPolling: boolean;
  };
}

export interface MultiplayerLobbySnapshot {
  id: string;
  code: string;
  status: 'open' | 'running' | 'ended' | 'abandoned' | 'expired';
  hostSessionId: string;
  createdAtUtc: string;
  expiresAtUtc: string;
  maxPlayers: number;
}

export interface MultiplayerPlayerSnapshot {
  id: string;
  sessionId: string;
  nickname: string;
  joinedAtUtc: string;
  isHost: boolean;
}

export interface MultiplayerRoundSnapshot {
  id: string;
  seedHash: string | null;
  startedAtUtc: string | null;
  endedAtUtc: string | null;
  maxDurationSeconds: number;
  startPage: WikiPageRef | null;
  endPage: WikiPageRef | null;
}

export interface MultiplayerRoundResult {
  id: string;
  roundId: string;
  sessionId: string;
  nickname: string;
  status: 'completed' | 'abandoned' | 'timeout';
  durationMs: number | null;
  clickCount: number;
  submittedAtUtc: string;
  source: string;
}

export interface MultiplayerLeaderboardRow {
  placement: number;
  isTie: boolean;
  sessionId: string;
  nickname: string;
  status: 'completed' | 'abandoned' | 'timeout';
  durationMs: number | null;
  clickCount: number;
  submittedAtUtc: string;
  source: string;
}

export interface MultiplayerLobbyResponse {
  lobby: MultiplayerLobbySnapshot;
  players: MultiplayerPlayerSnapshot[];
  round: MultiplayerRoundSnapshot | null;
  results: MultiplayerRoundResult[];
  leaderboard: MultiplayerLeaderboardRow[];
}

export interface MultiplayerRealtimeEventPayload {
  lobbyCode: string;
  event: string;
  occurredAtUtc: string;
  roundId?: string;
  seedHash?: string;
  sessionId?: string;
  nickname?: string;
  hostSessionId?: string;
  status?: 'completed' | 'abandoned' | 'timeout';
  durationMs?: number | null;
  clickCount?: number;
}

export interface GameState {
  mode: GameMode;
  phase: GamePhase;
  session: {
    sessionId: string | null;
    nickname: string | null;
  };
  run: RunState;
  solo: SoloState;
  multiplayer: MultiplayerState;
  errorMessage: string | null;
  ui: {
    isArticleLoading: boolean;
  };
}
