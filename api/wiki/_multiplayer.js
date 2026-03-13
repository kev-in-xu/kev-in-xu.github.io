import { randomBytes, randomUUID } from 'node:crypto';

export const LOBBY_CODE_PATTERN = /^[A-Z0-9]{6}$/;
export const LOBBY_CODE_INPUT_PATTERN = /^[A-Za-z0-9]{6}$/;
export const NICKNAME_PATTERN = /^[A-Za-z]{3,10}$/;
export const MAX_PLAYERS_PER_LOBBY = 6;
export const LOBBY_TTL_HOURS = 24;
export const ROUND_MAX_DURATION_SECONDS = 600;
const LOBBY_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (_err) {
      return null;
    }
  }
  return null;
}

export function toNonEmptyString(value) {
  const text = String(value || '').trim();
  return text || null;
}

export function normalizeLobbyCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!LOBBY_CODE_INPUT_PATTERN.test(code)) return null;
  return code;
}

export function normalizeNickname(value) {
  const nickname = String(value || '').trim();
  if (!NICKNAME_PATTERN.test(nickname)) return null;
  return nickname;
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

export function normalizeSessionId(value) {
  const sessionId = toNonEmptyString(value);
  if (!sessionId || !isUuid(sessionId)) return null;
  return sessionId;
}

export function generateLobbyCode() {
  const bytes = randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += LOBBY_CODE_ALPHABET[bytes[i] % LOBBY_CODE_ALPHABET.length];
  }
  return code;
}

export function createEntityId() {
  if (typeof randomUUID === 'function') {
    return randomUUID();
  }
  return [
    randomBytes(4).toString('hex'),
    randomBytes(2).toString('hex'),
    `4${randomBytes(2).toString('hex').slice(1)}`,
    ((8 + (randomBytes(1)[0] % 4)).toString(16) + randomBytes(2).toString('hex')).slice(0, 4),
    randomBytes(6).toString('hex')
  ].join('-');
}

export function buildLobbyExpiryIso(now = new Date()) {
  const expiresAtMs = now.getTime() + (LOBBY_TTL_HOURS * 60 * 60 * 1000);
  return new Date(expiresAtMs).toISOString();
}

export function isPostgresUniqueViolation(error) {
  return String(error?.code || '').trim() === '23505';
}

export function isLobbyExpired(lobbyRow, now = new Date()) {
  const expiresAt = Date.parse(String(lobbyRow?.expires_at_utc || ''));
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt <= now.getTime();
}

export function formatLobbySnapshot(lobbyRow, playerRows = []) {
  const activePlayers = playerRows
    .filter((row) => !row?.left_at_utc)
    .sort((a, b) => Date.parse(a.joined_at_utc || 0) - Date.parse(b.joined_at_utc || 0));

  return {
    lobby: {
      id: lobbyRow.id,
      code: lobbyRow.lobby_code,
      status: lobbyRow.status,
      hostSessionId: lobbyRow.host_session_id,
      createdAtUtc: lobbyRow.created_at_utc,
      expiresAtUtc: lobbyRow.expires_at_utc,
      maxPlayers: MAX_PLAYERS_PER_LOBBY
    },
    players: activePlayers.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      nickname: row.nickname,
      joinedAtUtc: row.joined_at_utc,
      isHost: Boolean(row.is_host)
    }))
  };
}
