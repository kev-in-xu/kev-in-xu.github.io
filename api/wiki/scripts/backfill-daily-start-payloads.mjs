import { createClient } from '@supabase/supabase-js';
import { buildWikiPagePayloadByTitle } from '../_page-pipeline.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AGI_TITLE = 'Artificial general intelligence';
const AGI_KEY = 'artificial_general_intelligence';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function getPageCacheByKey(key) {
  const { data, error } = await supabase
    .from('wiki_race_page_cache')
    .select('payload_json')
    .eq('page_key', key)
    .maybeSingle();
  if (error) throw error;
  return data?.payload_json || null;
}

async function upsertPageCache(payload) {
  const normalized = String(payload?.page?.normalizedTitle || payload?.page?.title || '')
    .trim()
    .replace(/ /g, '_')
    .toLowerCase();
  if (!normalized) return;

  const row = {
    page_key: normalized,
    normalized_title: payload?.page?.normalizedTitle || null,
    canonical_path: payload?.canonicalPath || payload?.page?.path || null,
    page_title: payload?.page?.title || payload?.displayTitle || null,
    fetched_at_utc: payload?.fetchedAtUtc || new Date().toISOString(),
    payload_json: payload
  };

  const { error } = await supabase
    .from('wiki_race_page_cache')
    .upsert(row, { onConflict: 'page_key' });
  if (error) throw error;
}

async function getAllDailyRows() {
  const rows = [];
  let from = 0;
  const pageSize = 500;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('wiki_race_daily_start')
      .select('date_key, start_title, start_normalized_title, start_path, start_url, start_page_id, end_title, end_normalized_title, end_path, end_url, end_page_id, start_payload_json, end_payload_json, generated_at_utc, generation_attempts')
      .order('date_key', { ascending: true })
      .range(from, to);

    if (error) throw error;
    if (!data?.length) break;

    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

function hasPagePayload(payload) {
  return Boolean(payload?.page?.path && payload?.html && Array.isArray(payload?.linkIndex));
}

async function resolveStartPayload(row) {
  if (hasPagePayload(row.start_payload_json)) return row.start_payload_json;

  const startKey = String(row.start_normalized_title || row.start_title || '')
    .trim()
    .replace(/ /g, '_')
    .toLowerCase();

  if (startKey) {
    const cached = await getPageCacheByKey(startKey);
    if (hasPagePayload(cached)) return cached;
  }

  const title = row.start_title || row.start_normalized_title?.replace(/_/g, ' ');
  if (!title) return null;
  return buildWikiPagePayloadByTitle(title);
}

async function resolveEndPayload(row, agiPayload) {
  if (hasPagePayload(row.end_payload_json)) return row.end_payload_json;

  const endKey = String(row.end_normalized_title || '').trim().replace(/ /g, '_').toLowerCase();
  if (endKey) {
    const cached = await getPageCacheByKey(endKey);
    if (hasPagePayload(cached)) return cached;
  }

  const agiCached = await getPageCacheByKey(AGI_KEY);
  if (hasPagePayload(agiCached)) return agiCached;

  return agiPayload;
}

async function main() {
  const rows = await getAllDailyRows();
  const agiPayload = await buildWikiPagePayloadByTitle(AGI_TITLE);
  await upsertPageCache(agiPayload);

  let updated = 0;
  for (const row of rows) {
    const startPayload = await resolveStartPayload(row);
    const endPayload = await resolveEndPayload(row, agiPayload);

    if (!startPayload || !endPayload) continue;

    await upsertPageCache(startPayload);
    await upsertPageCache(endPayload);

    const endPage = endPayload.page;
    const patch = {
      date_key: row.date_key,
      start_payload_json: startPayload,
      end_payload_json: endPayload,
      end_title: row.end_title || endPage.title,
      end_normalized_title: row.end_normalized_title || endPage.normalizedTitle,
      end_path: row.end_path || endPage.path,
      end_url: row.end_url || endPage.url,
      end_page_id: row.end_page_id ?? endPage.pageId ?? null,
      generated_at_utc: row.generated_at_utc || new Date().toISOString(),
      generation_attempts: row.generation_attempts ?? null
    };

    const { error } = await supabase
      .from('wiki_race_daily_start')
      .upsert(patch, { onConflict: 'date_key' });
    if (error) throw error;

    updated += 1;
    if (updated % 25 === 0) {
      console.log(`Updated ${updated} rows...`);
    }
  }

  console.log(`Backfill complete. Updated rows: ${updated}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
