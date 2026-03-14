import { applyWikiApiCors, handleCorsPreflight } from '../_cors.js';
import { isWikiRaceMultiplayerEnabled } from '../_flags.js';
import {
  buildLobbyExpiryIso,
  createEntityId,
  formatLobbySnapshot,
  generateLobbyCode,
  isPostgresUniqueViolation,
  normalizeNickname,
  normalizeSessionId,
  readJsonBody
} from '../multiplayer/_shared.js';
import { getSupabaseServiceClient } from '../_supabase.js';

const MAX_CREATE_ATTEMPTS = 12;

function badRequest(res, message, detail) {
  return res.status(400).json({ error: message, detail });
}

// Inserts a new lobby row into the lobby db.
// Inserts host player row into lobby_players db.
// Returns the lobby snapshot if both inserts succeed.
async function createLobbyWithHost({ supabaseClient, sessionId, nickname }) {
  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt += 1) {
    const createdAtUtc = new Date().toISOString();
    const lobbyId = createEntityId();
    const lobbyCode = generateLobbyCode();
    const expiresAtUtc = buildLobbyExpiryIso(new Date(createdAtUtc));

    const lobbyRow = {
      id: lobbyId,
      lobby_code: lobbyCode,
      status: 'open',
      host_session_id: sessionId,
      created_at_utc: createdAtUtc,
      expires_at_utc: expiresAtUtc
    };

    const { error: lobbyInsertError } = await supabaseClient
      .from('wiki_race_lobbies')
      .insert(lobbyRow);

    if (lobbyInsertError) {
      if (isPostgresUniqueViolation(lobbyInsertError)) {
        continue;
      }
      throw lobbyInsertError;
    }

    const playerRow = {
      id: createEntityId(),
      lobby_id: lobbyId,
      session_id: sessionId,
      nickname,
      joined_at_utc: createdAtUtc,
      left_at_utc: null,
      is_host: true
    };

    const { error: playerInsertError } = await supabaseClient
      .from('wiki_race_lobby_players')
      .insert(playerRow);

    if (!playerInsertError) {
      return formatLobbySnapshot(lobbyRow, [playerRow]);
    }

    await supabaseClient
      .from('wiki_race_lobbies')
      .delete()
      .eq('id', lobbyId);

    throw playerInsertError;
  }

  const error = new Error('Failed to allocate a unique lobby code');
  error.status = 503;
  throw error;
}

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  applyWikiApiCors(req, res);

  if (!isWikiRaceMultiplayerEnabled()) {
    return res.status(503).json({ error: 'Multiplayer is disabled' });
  }

  if (req.method && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseClient = await getSupabaseServiceClient();
  if (!supabaseClient) {
    return res.status(503).json({ error: 'Multiplayer storage is not configured' });
  }

  const body = readJsonBody(req);
  if (!body) return badRequest(res, 'Invalid JSON body');

  const sessionId = normalizeSessionId(body.sessionId);
  const nickname = normalizeNickname(body.nickname);

  if (!sessionId) return badRequest(res, 'Invalid sessionId');
  if (!nickname) return badRequest(res, 'Invalid nickname');

  try {
    const snapshot = await createLobbyWithHost({
      supabaseClient,
      sessionId,
      nickname
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(snapshot);
  } catch (err) {
    return res.status(err?.status || 502).json({
      error: 'Failed to create lobby',
      detail: err?.message || null
    });
  }
}
