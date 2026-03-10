let supabaseClient = null;

const memoryCache = new Map();
const DAILY_START_PREFIX = 'wiki-race:daily-start:';
const PAGE_PREFIX = 'wiki-race:page:';

/**
 * Creates and caches a Supabase service client.
 */
async function loadSupabase() {
  if (supabaseClient) return true;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;

  try {
    const mod = await import('@supabase/supabase-js');
    supabaseClient = mod.createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Extracts the YYYY-MM-DD date segment from a daily-start full cache key.
 */
function keyToDailyDate(key) {
  if (!String(key).startsWith(DAILY_START_PREFIX)) return null;
  const suffix = String(key).slice(DAILY_START_PREFIX.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(suffix)) return null;
  return suffix;
}

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

// Helper to convert a Supabase table row into a page reference object
function toPageRefFromRow(prefix, row) {
  const title = row?.[`${prefix}_title`] || null;
  const normalizedTitle = row?.[`${prefix}_normalized_title`] || null;
  const path = row?.[`${prefix}_path`] || null;
  const url = row?.[`${prefix}_url`] || null;
  const pageId = row?.[`${prefix}_page_id`] ?? null;
  if (!title && !normalizedTitle && !path && !url && pageId == null) return null;
  return {
    title: title || normalizedTitle?.replace(/_/g, ' ') || '',
    normalizedTitle: normalizedTitle || '',
    path: path || '',
    url: url || '',
    pageId
  };
}

/**
 * Reads a daily-start payload from Supabase storage.
 * Output: cached JSON payload or `null`.
 */
async function supabaseGetJson(key) {
  const dateKey = keyToDailyDate(key);
  if (!dateKey) return null;
  if (!(await loadSupabase())) return null;

  const { data, error } = await supabaseClient
    .from('wiki_race_daily_start')
    .select('date_key, start_title, start_normalized_title, start_path, start_url, start_page_id, end_title, end_normalized_title, end_path, end_url, end_page_id, generation_attempts, generated_at_utc, start_payload_json, end_payload_json')
    .eq('date_key', dateKey)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const startPage = toPageRefFromRow('start', data);
  const endPage = toPageRefFromRow('end', data);
  return {
    dateKey: data.date_key,
    startPage,
    endPage,
    generatedAtUtc: data.generated_at_utc || null,
    generationAttempts: data.generation_attempts ?? null,
    startPayload: data.start_payload_json || null,
    endPayload: data.end_payload_json || null
  };
}

/**
 * Upserts a daily-start payload into Supabase storage.
 * Input: full daily-start cache key and payload object.
 * Output: Boolean success indicator.
 * Logic: maps payload fields to relational row columns and upserts by `date_key`.
 */
async function supabaseSetJson(key, value) {
  const dateKey = keyToDailyDate(key);
  if (!dateKey) return false;
  if (!(await loadSupabase())) return false;

  const startPage = value?.startPage || {};
  const endPage = value?.endPage || {};
  const row = {
    date_key: dateKey,
    start_title: startPage.title || null,
    start_normalized_title: startPage.normalizedTitle || null,
    start_path: startPage.path || null,
    start_url: startPage.url || null,
    start_page_id: startPage.pageId ?? null,
    end_title: endPage.title || null,
    end_normalized_title: endPage.normalizedTitle || null,
    end_path: endPage.path || null,
    end_url: endPage.url || null,
    end_page_id: endPage.pageId ?? null,
    generation_attempts: value?.generationAttempts ?? null,
    generated_at_utc: value?.generatedAtUtc || new Date().toISOString(),
    start_payload_json: value?.startPayload || null,
    end_payload_json: value?.endPayload || null
  };

  const { error } = await supabaseClient
    .from('wiki_race_daily_start')
    .upsert(row, { onConflict: 'date_key' });
  if (error) throw error;
  return true;
}

/**
 * Gets JSON from cache (either Supabase or in-memory).
 * Input: cache key string.
 */
export async function cacheGetJson(key) {
  const supaValue = await supabaseGetJson(key);
  if (supaValue != null) return supaValue;
  return memoryCache.get(key) ?? null;
}

/**
 * Sets JSON in cache with Supabase-first fallback to in-memory cache.
 * Input: cache key, value, and optional options object.
 * Output: Boolean success indicator.
 */
export async function cacheSetJson(key, value, options = {}) {
  void options;
  if (await loadSupabase()) {
    return supabaseSetJson(key, value);
  }
  memoryCache.set(key, value);
  return true;
}

/**
 * Detects active cache backends for diagnostics and response metadata.
 * Output: object containing the selected primary backend.
 */
export async function detectCacheBackends() {
  return {
    primary: (await loadSupabase()) ? 'supabase' : 'memory'
  };
}

/**
 * Reads a cached wiki page payload from Supabase by normalized key.
 * Logic: queries `wiki_race_page_cache` row and returns `payload_json`.
 */
async function supabaseGetPagePayload(normalizedKey) {
  if (!normalizedKey) return null;
  if (!(await loadSupabase())) return null;

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
  if (!(await loadSupabase())) return false;

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

  if (await loadSupabase()) {
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
