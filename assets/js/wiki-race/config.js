const DEFAULT_PUBLIC_SUPABASE_URL = 'https://lljbzkmtshufnzfnzawp.supabase.co';
const DEFAULT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable__Y3HQW_LNT-unIUWoM5WLA_ygGy43uv';

function parseBoolean(value, defaultValue = false) {
  if (value == null) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

export function getWikiRaceRoot() {
  return document.getElementById('wiki-race-app');
}

export function getWikiRaceClientConfig() {
  const root = getWikiRaceRoot();
  const apiBase = root?.dataset?.apiBase?.trim()
    || (typeof window !== 'undefined' && typeof window.WIKI_RACE_API_BASE === 'string'
      ? window.WIKI_RACE_API_BASE.trim()
      : '');
  const supabaseUrl = root?.dataset?.supabaseUrl?.trim() || DEFAULT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = root?.dataset?.supabaseAnonKey?.trim() || DEFAULT_PUBLIC_SUPABASE_ANON_KEY;

  return {
    apiBase,
    supabaseUrl,
    supabaseAnonKey,
    multiplayerEnabled: parseBoolean(root?.dataset?.multiplayerEnabled, true),
    realtimeEnabled: parseBoolean(root?.dataset?.realtimeEnabled, true),
    realtimeFallbackPollingEnabled: parseBoolean(root?.dataset?.realtimeFallbackPollingEnabled, true)
  };
}
