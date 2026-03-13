import { createHash, randomBytes } from 'node:crypto';
import { isWikiRaceSeedStoreEnabled } from './_flags.js';
import { getSupabaseServiceClient } from './_supabase.js';

const MAX_SEED_INSERT_ATTEMPTS = 8;

function normalizePath(pathLike) {
  const value = String(pathLike || '').trim();
  if (!value || !value.startsWith('/wiki/')) return null;
  return value;
}

function normalizeTitle(titleLike) {
  const value = String(titleLike || '').trim();
  return value || null;
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
    .from('wiki_race_random_seeds')
    .insert(row);

  if (!error) {
    return { ok: true, conflict: false };
  }
  if (isUniqueViolation(error)) {
    return { ok: false, conflict: true };
  }
  return { ok: false, conflict: false, error };
}

export async function createAndPersistRandomRunSeed({ startPage, endPage, dateKey = null } = {}) {
  if (!isWikiRaceSeedStoreEnabled()) {
    throw createSeedStoreError('Random race seed persistence is disabled', {
      status: 503
    });
  }

  const startPath = normalizePath(startPage?.path);
  const endPath = normalizePath(endPage?.path);
  if (!startPath || !endPath) {
    throw createSeedStoreError('Failed to persist random race seed', {
      status: 500,
      detail: 'missing start or end path'
    });
  }

  const pairToken = toPairToken(startPath, endPath);
  const supabaseClient = await getSupabaseServiceClient();
  if (!supabaseClient) {
    throw createSeedStoreError('Random race seed persistence is not configured', {
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
        dateKey: dateKey || null,
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
        .from('wiki_race_random_seeds')
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

  throw createSeedStoreError('Failed to persist random race seed', {
    status: 502,
    detail: lastError?.message || null
  });
}
