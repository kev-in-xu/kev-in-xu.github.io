/**
 * This module caches wiki page payloads, using Supabase as the primary backend
 * and an in-memory Map as a fallback.
 */

import { getSupabaseServiceClient } from './_supabase.js';

const memoryCache = new Map();
const PAGE_PREFIX = 'wiki-race:page:';

/**
 * Normalizes a wiki title/path into a lowercase cache key token.
 */
function normalizePageKey(titleLike) {
  return String(titleLike || '')
    .trim()
    .replace(/^\/wiki\//i, '')
    .replace(/ /g, '_')
    .toLowerCase();
}

/**
 * Logic: Prepends page cache prefix.
 */
function pageMemoryKey(normalizedKey) {
  return `${PAGE_PREFIX}${normalizedKey}`;
}


/**
 * Reads a cached wiki page payload from Supabase by normalized key.
 * Logic: queries `wiki_race_page_cache` row and returns `payload_json`.
 */
async function supabaseGetPagePayload(normalizedKey) {
  if (!normalizedKey) return null;
  const supabaseClient = await getSupabaseServiceClient();
  if (!supabaseClient) return null;

  const { data, error } = await supabaseClient
    .from('wiki_race_page_cache')
    .select('payload_json')
    .eq('page_key', normalizedKey)
    .maybeSingle();
  if (error) throw error;
  return data?.payload_json ?? null;
}

/**
 * Upserts a wiki page payload into Supabase page cache.
 * Input: normalized page key and page payload.
 * Output: Boolean success indicator.
 * Logic: maps payload metadata fields and upserts row by `page_key`.
 */
async function supabaseSetPagePayload(normalizedKey, payload) {
  if (!normalizedKey || !payload) return false;
  const supabaseClient = await getSupabaseServiceClient();
  if (!supabaseClient) return false;

  const row = {
    page_key: normalizedKey,
    normalized_title: payload?.page?.normalizedTitle || null,
    canonical_path: payload?.canonicalPath || payload?.page?.path || null,
    page_title: payload?.page?.title || payload?.displayTitle || null,
    fetched_at_utc: payload?.fetchedAtUtc || new Date().toISOString(),
    payload_json: payload
  };

  const { error } = await supabaseClient
    .from('wiki_race_page_cache')
    .upsert(row, { onConflict: 'page_key' });
  if (error) throw error;
  return true;
}

/**
 * Retrieves a cached page payload by requested title/path.
 * Input: title-like value.
 * Output: payload object or `null`.
 * Logic: normalizes key, checks Supabase first, then memory cache alias.
 */
export async function getCachedWikiPageByTitle(titleLike) {
  const normalizedKey = normalizePageKey(titleLike);
  if (!normalizedKey) return null;

  const supaValue = await supabaseGetPagePayload(normalizedKey);
  if (supaValue != null) return supaValue;
  return memoryCache.get(pageMemoryKey(normalizedKey)) ?? null;
}

/**
 * Stores a page payload under both requested and canonical cache keys.
 * Input: requested title-like key and payload.
 * Logic: writes aliases to Supabase or memory so lookups resolve from either key.
 */
export async function setCachedWikiPage(titleLike, payload) {
  const normalizedRequestedKey = normalizePageKey(titleLike);
  const canonicalKey = normalizePageKey(payload?.page?.normalizedTitle || payload?.page?.title || '');

  if (await getSupabaseServiceClient()) {
    if (normalizedRequestedKey) await supabaseSetPagePayload(normalizedRequestedKey, payload);
    if (canonicalKey && canonicalKey !== normalizedRequestedKey) {
      await supabaseSetPagePayload(canonicalKey, payload);
    }
    return true;
  }

  if (normalizedRequestedKey) memoryCache.set(pageMemoryKey(normalizedRequestedKey), payload);
  if (canonicalKey) memoryCache.set(pageMemoryKey(canonicalKey), payload);
  return true;
}
