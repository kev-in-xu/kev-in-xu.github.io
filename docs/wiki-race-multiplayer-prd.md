# Wiki Race Multiplayer PRD (MVP)

## Document Info
- Owner: Kevin Xu
- Product: Wiki Race
- Status: Draft (implementation-oriented)
- Last Updated: March 11, 2026

## 1. Purpose
Ship multiplayer custom races with low-latency shared outcomes on free-tier infrastructure (Supabase + Vercel), while keeping implementation small and cost-controlled.

This PRD also defines a prerequisite Phase 0: race seed generation and persistence for random races, to be implemented before multiplayer.

## 2. Goals
1. Players can share the same start and end page in a lobby-based custom race.
2. Players see race-critical status updates live (at minimum: who has finished/abandoned and final leaderboard).
3. Cross-user update latency target is under 500ms in normal conditions.
4. MVP operates within about $10/month budget and supports up to 50 concurrent users.

## 3. Non-Goals (MVP)
1. Daily race multiplayer.
2. Verified path validation and anti-cheat guarantees (trusted client completion for MVP).
3. Reconnect/session recovery to in-progress state (refresh/drop returns user to home page for MVP).
4. Moderation/reporting flows.
5. Nickname uniqueness enforcement.

## 4. MVP Requirements (Locked)

### 4.1 Game Mode and Lobby
1. Support custom races only.
2. Lobby code is public, alphanumeric, 6 characters.
3. Max 6 players per lobby.
4. Late join is not allowed once a round has started.
5. Host controls round start countdown.
6. Lobby expires after 24 hours; expired lobby codes can be reused.

### 4.2 Host Behavior
1. Host can kick players before round start.
2. Host can start round.
3. If host leaves:
   1. If no other players remain, lobby is abandoned.
   2. If others remain, oldest connected player becomes new host.
4. Host handoff applies both before and after round start.

### 4.3 Race Outcome
1. Finish states:
   1. `completed`: target page reached and timer stopped.
   2. `abandoned`: manual abandon or timeout.
2. Round timeout is 10 minutes; any player not finished by then is auto-abandoned.
3. Ties are allowed when final durations are identical.
4. Win-condition rules must remain flexible for future updates.

### 4.4 Identity and Validation
1. Anonymous nicknames only.
2. Duplicate nicknames allowed (session ID is authoritative).
3. Input validation:
   1. Lobby code: `^[A-Za-z0-9]{6}$`
   2. Nickname: alphabetical only, length 3-10 (`^[A-Za-z]{3,10}$`)
4. Page titles are not manually entered in MVP.

### 4.5 Event and Traffic Limits
1. Maximum race events per user per round: 5.
2. Primary updates include join/leave/start/finish/abandon/end only.

## 5. Architecture Decision (Option 2)
Use **Supabase Realtime as primary** with **snapshot polling fallback** when realtime becomes stale/disconnected.

### 5.1 Why Option 2
1. Keeps infra and ops simple on free tiers.
2. Provides better reliability than realtime-only.
3. Avoids cost and complexity of a dedicated always-on live server.

### 5.2 High-Level Components
1. Frontend: existing Vercel-hosted Wiki Race client.
2. API layer: Vercel serverless endpoints for lobby/round actions.
3. Database: Supabase Postgres for authoritative lobby/round/result state.
4. Realtime: Supabase Realtime channels subscribed by lobby.
5. Fallback: client snapshot polling endpoint at low frequency on stale/disconnect.

### 5.3 Realtime + Polling Behavior
1. Client subscribes to lobby channel after join.
2. Server writes authoritative state to Postgres.
3. Realtime broadcasts updates to all lobby clients.
4. Client monitors channel health:
   1. If no update/heartbeat over threshold, mark channel stale.
   2. While stale, poll snapshot every 2-5 seconds.
   3. On healthy realtime recovery, stop fallback polling.
5. UI always renders latest state by server timestamp/version, not arrival order.

## 6. Latency and Reliability Targets
1. Target: finish/abandon events visible to other players in under 500ms (p50, normal network).
2. Functional reliability target: leaderboard converges correctly even with out-of-order realtime events.
3. No reconnect recovery in MVP: refresh/network drop returns player to home page and loses in-progress race state.

## 7. Data Model (Postgres/Supabase)

## 7.1 Phase 0 Tables (Seed System - Implement First)
1. `wiki_race_random_seeds`
   1. `seed_hash` (text, unique, indexed)
   2. `start_path` (text, required)
   3. `end_path` (text, required)
   4. `start_title` (text)
   5. `end_title` (text)
   6. `created_at_utc` (timestamptz, default now)
   7. `metadata_json` (jsonb, optional)

Unique constraints:
1. Unique on `seed_hash`
2. Optional additional unique on `(start_path, end_path)` if strict pair uniqueness is desired.

## 7.2 Multiplayer Tables
1. `wiki_race_lobbies`
   1. `id` (uuid, pk)
   2. `lobby_code` (char(6), indexed)
   3. `status` (`open|running|ended|abandoned|expired`)
   4. `host_session_id` (text)
   5. `created_at_utc` (timestamptz)
   6. `expires_at_utc` (timestamptz)
2. `wiki_race_lobby_players`
   1. `id` (uuid, pk)
   2. `lobby_id` (uuid, fk)
   3. `session_id` (text)
   4. `nickname` (text)
   5. `joined_at_utc` (timestamptz)
   6. `left_at_utc` (timestamptz, nullable)
   7. `is_host` (boolean)
3. `wiki_race_rounds`
   1. `id` (uuid, pk)
   2. `lobby_id` (uuid, fk)
   3. `seed_hash` (text, fk to seed table)
   4. `start_path` (text)
   5. `end_path` (text)
   6. `started_at_utc` (timestamptz)
   7. `ended_at_utc` (timestamptz, nullable)
   8. `max_duration_seconds` (int, default 600)
4. `wiki_race_round_results`
   1. `id` (uuid, pk)
   2. `round_id` (uuid, fk)
   3. `session_id` (text)
   4. `nickname` (text)
   5. `status` (`completed|abandoned|timeout`)
   6. `duration_ms` (int, nullable for abandoned/timeout)
   7. `click_count` (int)
   8. `submitted_at_utc` (timestamptz)
   9. `source` (`client_reported`)

## 8. API and Event Contracts (MVP)

### 8.1 API Endpoints
1. `POST /api/wiki/lobbies`
   1. Creates lobby with 6-char code, 24h TTL, host assignment.
2. `POST /api/wiki/lobbies/:code/join`
   1. Joins lobby if `status=open`, not full, not expired.
3. `POST /api/wiki/lobbies/:code/kick`
   1. Host-only, pre-start only.
4. `POST /api/wiki/lobbies/:code/start`
   1. Host-only, locks lobby join, creates round from generated seed pair.
5. `POST /api/wiki/rounds/:id/finish`
   1. Client-reported completion or abandon submission.
6. `GET /api/wiki/lobbies/:code/snapshot`
   1. Returns authoritative state for fallback polling.

### 8.2 Realtime Event Types
1. `player_joined`
2. `player_left`
3. `host_changed`
4. `race_started`
5. `player_finished`
6. `player_abandoned`
7. `race_ended`
8. `leaderboard_updated`

Ordering note:
1. Clients do not depend on strict event ordering for interaction.
2. Final leaderboard is derived from DB state and a deterministic sort, not event arrival order.

## 9. Leaderboard Rules (MVP)
1. Accept trusted client submissions.
2. Ranking:
   1. `completed` players first, sorted by `duration_ms` ascending.
   2. Ties remain ties if equal duration.
   3. `abandoned/timeout` listed after completed players.
3. Round ends when:
   1. All players have submitted final state, or
   2. 10-minute round timer expires.

## 10. Seed System (Phase 0, Priority Before Multiplayer)
1. Generate random start and end pages.
2. Create deterministic seed input from canonical pair (for example `start_path + "|" + end_path` plus random nonce).
3. Compute `seed_hash`.
4. Attempt insert into `wiki_race_random_seeds`.
5. On uniqueness conflict, regenerate nonce/hash and retry.
6. If pair/hash unseen, upsert new row.
7. If collision on hash, generate a new hash before storing.
8. Multiplayer round creation reads from this seed system.

Success criteria for Phase 0:
1. Random race always has a stored seed hash.
2. Duplicate hash conflicts are handled automatically.
3. Seed lookup is queryable for replay/analysis.

## 11. Security and Input Constraints
1. Enforce server-side validation for lobby codes and nicknames.
2. Ignore client attempts to override start/end pages in multiplayer.
3. Use session IDs as primary player identity key.
4. Keep PII minimal (no email/auth in MVP).

## 12. Cost and Scale Guardrails
1. Budget target: <= $10/month.
2. Expected max concurrency: 50 users.
3. Hard limits:
   1. 6 players/lobby
   2. 10 minutes/round
   3. 5 events/user/round
4. Keep payloads lean (no route stream, no current-page streaming in MVP).

## 13. Metrics and Monitoring (MVP)
1. Lobby create/join success rate.
2. Realtime subscription success/failure rate.
3. Realtime-to-render event latency.
4. Snapshot polling fallback activation rate.
5. Race completion vs abandon rate.
6. Leaderboard convergence errors (if any).

## 14. Rollout Plan
1. Phase 0: Ship seed generation + persistence first.
2. Phase 1: Ship lobby lifecycle and host controls behind feature flag.
3. Phase 2: Enable realtime events + polling fallback.
4. Phase 3: Small beta rollout, monitor cost/latency/errors.
5. Phase 4: Expand availability if SLO/cost remain stable.

Feature flags (initial):
1. `wikiRaceSeedStoreEnabled`
2. `wikiRaceMultiplayerEnabled`
3. `wikiRaceRealtimeFallbackPollingEnabled`

## 15. Explicit TODO Backlog
1. Add verified path checking and anti-cheat.
2. Add reconnect/resume behavior.
3. Add nickname collision UX.
4. Add abuse controls and rate limits.
5. Add dispute review flow for suspicious client submissions.
6. Decide retention policy and archival strategy for historical rounds.

## 16. Acceptance Criteria
1. Players in same lobby always receive identical start/end pages.
2. Join is blocked after round start.
3. Host reassignment works deterministically on host leave.
4. Finish/abandon updates propagate live to other players and converge via fallback polling if realtime degrades.
5. Round force-ends at 10 minutes and marks unfinished players as timeout/abandoned.
6. Leaderboard is deterministic and tie-safe.
7. Random race seed rows are persisted with uniqueness handling before multiplayer rollout.
