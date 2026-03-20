/**
 * This module persists canonical wiki race pair rows and daily-run mappings.
 */

import { createHash, randomBytes } from 'node:crypto';
import { isWikiRaceSeedStoreEnabled } from './_flags.js';
import { getSupabaseServiceClient } from './_supabase.js';

const MAX_SEED_INSERT_ATTEMPTS = 8;
const SEED_HASH_PATTERN = /^[a-f0-9]{24}$/i;
const DAILY_MODE_PATTERN = /^[a-z0-9_]{1,40}$/;
const RUN_SEED_TABLE = 'wiki_race_random_seeds';
const DAILY_RUN_TABLE = 'wiki_race_daily_runs';

function normalizePath(pathLike) {
  const value = String(pathLike || '').trim();
  if (!value || !value.startsWith('/wiki/')) return null;
  return value;
}

function normalizeTitle(titleLike) {
  const value = String(titleLike || '').trim();
  return value || null;
}

function normalizeDateKey(dateKeyLike) {
  const value = String(dateKeyLike || '').trim();
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeMode(modeLike) {
  const value = String(modeLike || '').trim().toLowerCase();
  if (!value) return null;
  return DAILY_MODE_PATTERN.test(value) ? value : null;
}

function normalizeSeedHash(seedHashLike) {
  const value = String(seedHashLike || '').trim().toLowerCase();
  if (!value) return null;
  return SEED_HASH_PATTERN.test(value) ? value : null;
}

function toPairToken(startPath, endPath) {
  return `${String(startPath || '').toLowerCase()}|${String(endPath || '').toLowerCase()}`;
}

function isUniqueViolation(error) {
  const code = String(error?.code || '').trim();
  if (code === '23505') return true;
  const details = String(error?.details || error?.message || '').toLowerCase();
  return details.includes('duplicate key value violates unique constraint');
}

function generateSeedCandidate(pairToken) {
  const nonce = randomBytes(16).toString('hex');
  const hashInput = `${pairToken}|${nonce}`;
  const seedHash = createHash('sha256').update(hashInput).digest('hex').slice(0, 24);
  return { seedHash, nonce };
}

function createSeedStoreError(message, { status = 502, detail = null } = {}) {
  const error = new Error(message);
  error.status = status;
  error.detail = detail;
  return error;
}

async function tryInsertSupabase(row) {
  const supabaseClient = await getSupabaseServiceClient();
  if (!supabaseClient) {
    return { ok: false, conflict: false, unavailable: true };
  }

  const { error } = await supabaseClient
    .from(RUN_SEED_TABLE)
    .insert(row);

  if (!error) {
    return { ok: true, conflict: false };
  }
  if (isUniqueViolation(error)) {
    return { ok: false, conflict: true };
  }
  return { ok: false, conflict: false, error };
}

async function tryInsertDailyRunSupabase(row) {
  const supabaseClient = await getSupabaseServiceClient();
  if (!supabaseClient) {
    return { ok: false, conflict: false, unavailable: true };
  }

  const { error } = await supabaseClient
    .from(DAILY_RUN_TABLE)
    .insert(row);

  if (!error) {
    return { ok: true, conflict: false };
  }
  if (isUniqueViolation(error)) {
    return { ok: false, conflict: true };
  }
  return { ok: false, conflict: false, error };
}

function normalizeSeedRow(row) {
  if (!row) return null;
  return {
    seed_hash: normalizeSeedHash(row.seed_hash),
    start_title: normalizeTitle(row.start_title),
    end_title: normalizeTitle(row.end_title),
    start_path: normalizePath(row.start_path),
    end_path: normalizePath(row.end_path),
    created_at_utc: row.created_at_utc || null,
    metadata_json: row.metadata_json || null
  };
}

export async function getRunSeedRowByHash(seedHash, supabaseClient = null) {
  const normalizedSeedHash = normalizeSeedHash(seedHash);
  if (!normalizedSeedHash) return null;

  const client = supabaseClient || await getSupabaseServiceClient();
  if (!client) return null;

  const { data, error } = await client
    .from(RUN_SEED_TABLE)
    .select('seed_hash, start_title, end_title, start_path, end_path, created_at_utc, metadata_json')
    .eq('seed_hash', normalizedSeedHash)
    .maybeSingle();

  if (error) throw error;
  return normalizeSeedRow(data);
}

export async function getDailyRunRow({ mode, dateKey } = {}, supabaseClient = null) {
  const normalizedMode = normalizeMode(mode);
  const normalizedDateKey = normalizeDateKey(dateKey);
  if (!normalizedMode || !normalizedDateKey) return null;

  const client = supabaseClient || await getSupabaseServiceClient();
  if (!client) return null;

  const { data, error } = await client
    .from(DAILY_RUN_TABLE)
    .select('mode, date_key, seed_hash, created_at_utc')
    .eq('mode', normalizedMode)
    .eq('date_key', normalizedDateKey)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    mode: normalizeMode(data.mode),
    dateKey: normalizeDateKey(data.date_key),
    seedHash: normalizeSeedHash(data.seed_hash),
    createdAtUtc: data.created_at_utc || null
  };
}

export async function createAndPersistRunSeed({ startPage, endPage, dateKey = null } = {}) {
  if (!isWikiRaceSeedStoreEnabled()) {
    throw createSeedStoreError('Run seed persistence is disabled', {
      status: 503
    });
  }

  const startPath = normalizePath(startPage?.path);
  const endPath = normalizePath(endPage?.path);
  if (!startPath || !endPath) {
    throw createSeedStoreError('Failed to persist run seed', {
      status: 500,
      detail: 'missing start or end path'
    });
  }

  const pairToken = toPairToken(startPath, endPath);
  const supabaseClient = await getSupabaseServiceClient();
  if (!supabaseClient) {
    throw createSeedStoreError('Run seed persistence is not configured', {
      status: 503
    });
  }

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_SEED_INSERT_ATTEMPTS; attempt += 1) {
    const { seedHash, nonce } = generateSeedCandidate(pairToken);
    const createdAtUtc = new Date().toISOString();
    const row = {
      seed_hash: seedHash,
      start_path: startPath,
      end_path: endPath,
      start_title: normalizeTitle(startPage?.title),
      end_title: normalizeTitle(endPage?.title),
      created_at_utc: createdAtUtc,
      metadata_json: {
        dateKey: normalizeDateKey(dateKey) || null,
        pairToken,
        nonce
      }
    };

    const supabaseResult = await tryInsertSupabase(row);
    if (supabaseResult.ok) {
      return { seedHash, seedSource: 'supabase' };
    }
    if (supabaseResult.conflict) {
      const { data: existing, error: existingError } = await supabaseClient
        .from(RUN_SEED_TABLE)
        .select('seed_hash')
        .eq('start_path', startPath)
        .eq('end_path', endPath)
        .maybeSingle();
      if (!existingError) {
        const existingSeedHash = String(existing?.seed_hash || '').trim();
        if (existingSeedHash) {
          return { seedHash: existingSeedHash, seedSource: 'supabase' };
        }
      }
      lastError = existingError || null;
      continue;
    }
    lastError = supabaseResult.error || null;
    break;
  }

  throw createSeedStoreError('Failed to persist run seed', {
    status: 502,
    detail: lastError?.message || null
  });
}

export async function createOrFetchDailyRun({ mode, dateKey, seedHash } = {}) {
  const normalizedMode = normalizeMode(mode);
  const normalizedDateKey = normalizeDateKey(dateKey);
  const normalizedSeedHash = normalizeSeedHash(seedHash);

  if (!normalizedMode) {
    throw createSeedStoreError('Invalid daily run mode', {
      status: 400
    });
  }
  if (!normalizedDateKey) {
    throw createSeedStoreError('Invalid daily run date key', {
      status: 400
    });
  }
  if (!normalizedSeedHash) {
    throw createSeedStoreError('Invalid seed hash', {
      status: 400
    });
  }

  const supabaseClient = await getSupabaseServiceClient();
  if (!supabaseClient) {
    throw createSeedStoreError('Daily run persistence is not configured', {
      status: 503
    });
  }

  const row = {
    mode: normalizedMode,
    date_key: normalizedDateKey,
    seed_hash: normalizedSeedHash,
    created_at_utc: new Date().toISOString()
  };

  const insertResult = await tryInsertDailyRunSupabase(row);
  if (!insertResult.ok && !insertResult.conflict) {
    throw createSeedStoreError('Failed to persist daily run', {
      status: 502,
      detail: insertResult.error?.message || null
    });
  }

  const dailyRun = await getDailyRunRow({
    mode: normalizedMode,
    dateKey: normalizedDateKey
  }, supabaseClient);
  if (!dailyRun?.seedHash) {
    throw createSeedStoreError('Failed to load daily run', {
      status: 502
    });
  }

  const runSeed = await getRunSeedRowByHash(dailyRun.seedHash, supabaseClient);
  if (!runSeed?.seed_hash) {
    throw createSeedStoreError('Failed to load daily run seed', {
      status: 502
    });
  }

  return {
    dailyRun,
    runSeed
  };
}
