import { applyWikiApiCors, handleCorsPreflight } from '../../_cors.js';
import { isWikiRaceMultiplayerEnabled } from '../../_flags.js';
import { buildLobbySnapshotResponse } from '../../multiplayer/_snapshot.js';
import {
  getLobbyByCode,
  getLobbyPlayers,
  isLobbyExpired,
  markLobbyExpired,
  normalizeLobbyCode
} from '../../multiplayer/_shared.js';
import { getSupabaseServiceClient } from '../../_supabase.js';

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  applyWikiApiCors(req, res);

  if (!isWikiRaceMultiplayerEnabled()) {
    return res.status(503).json({ error: 'Multiplayer is disabled' });
  }

  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseClient = await getSupabaseServiceClient();
  if (!supabaseClient) {
    return res.status(503).json({ error: 'Multiplayer storage is not configured' });
  }

  const lobbyCode = normalizeLobbyCode(req.query?.code);
  if (!lobbyCode) {
    return res.status(400).json({ error: 'Invalid lobby code' });
  }

  try {
    const lobbyRow = await getLobbyByCode(supabaseClient, lobbyCode);
    if (!lobbyRow) {
      return res.status(404).json({ error: 'Lobby not found' });
    }

    if (isLobbyExpired(lobbyRow)) {
      await markLobbyExpired(supabaseClient, lobbyRow.id);
      return res.status(410).json({ error: 'Lobby expired' });
    }

    const playerRows = await getLobbyPlayers(supabaseClient, lobbyRow.id);
    const snapshot = await buildLobbySnapshotResponse(supabaseClient, lobbyRow, playerRows);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(snapshot);
  } catch (err) {
    return res.status(err?.status || 502).json({
      error: 'Failed to load lobby snapshot',
      detail: err?.message || null
    });
  }
}
