let blobPutImpl = null;
let supabaseClient = null;

const memoryCache = new Map();
const DAILY_START_PREFIX = 'wiki-race:daily-start:';

async function loadBlob() {
  if (blobPutImpl) return true;
  try {
    const mod = await import('@vercel/blob');
    blobPutImpl = mod.put || null;
    return Boolean(blobPutImpl);
  } catch (_err) {
    return false;
  }
}

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

function keyToDailyDate(key) {
  if (!String(key).startsWith(DAILY_START_PREFIX)) return null;
  return String(key).slice(DAILY_START_PREFIX.length);
}

async function supabaseGetJson(key) {
  const dateKey = keyToDailyDate(key);
  if (!dateKey) return null;
  if (!(await loadSupabase())) return null;

  const { data, error } = await supabaseClient
    .from('wiki_race_daily_start')
    .select('payload_json')
    .eq('date_key', dateKey)
    .maybeSingle();

  if (error) throw error;
  return data?.payload_json ?? null;
}

async function supabaseSetJson(key, value) {
  const dateKey = keyToDailyDate(key);
  if (!dateKey) return false;
  if (!(await loadSupabase())) return false;

  const startPage = value?.startPage || {};
  const target = value?.target || {};
  const row = {
    date_key: dateKey,
    start_title: startPage.title || null,
    start_normalized_title: startPage.normalizedTitle || null,
    start_path: startPage.path || null,
    start_url: startPage.url || null,
    start_page_id: startPage.pageId ?? null,
    generation_attempts: value?.generationAttempts ?? null,
    generated_at_utc: value?.generatedAtUtc || new Date().toISOString(),
    target_title: target.title || 'Artificial general intelligence',
    payload_json: value
  };

  const { error } = await supabaseClient
    .from('wiki_race_daily_start')
    .upsert(row, { onConflict: 'date_key' });
  if (error) throw error;
  return true;
}

export async function cacheGetJson(key) {
  const supaValue = await supabaseGetJson(key);
  if (supaValue != null) return supaValue;
  return memoryCache.get(key) ?? null;
}

export async function cacheSetJson(key, value, options = {}) {
  void options;
  if (await loadSupabase()) {
    return supabaseSetJson(key, value);
  }
  memoryCache.set(key, value);
  return true;
}

export async function blobPutJson(path, jsonValue) {
  if (!(await loadBlob())) return null;
  const payload = JSON.stringify(jsonValue, null, 2);
  return blobPutImpl(path, payload, {
    access: 'public',
    contentType: 'application/json'
  });
}

export async function detectCacheBackends() {
  const hasSupabase = await loadSupabase();
  const hasBlob = await loadBlob();
  return {
    primary: hasSupabase ? 'supabase' : 'memory',
    supabase: hasSupabase,
    blob: hasBlob
  };
}
