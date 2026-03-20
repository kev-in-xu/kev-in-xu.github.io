/**
 * This module provides utilities for parsing and managing feature flags
 */

function parseBooleanFlag(value, defaultValue = false) {
  if (value == null) return defaultValue;

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

export function isWikiRaceSeedStoreEnabled() {
  return parseBooleanFlag(process.env.WIKI_RACE_SEED_STORE_ENABLED, true);
}

export function isWikiRaceMultiplayerEnabled() {
  return parseBooleanFlag(process.env.WIKI_RACE_MULTIPLAYER_ENABLED, false);
}

export function isWikiRaceRealtimeEnabled() {
  return parseBooleanFlag(process.env.WIKI_RACE_REALTIME_ENABLED, true);
}
