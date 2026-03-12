let supabaseServiceClient = null;
let attemptedLoad = false;

export async function getSupabaseServiceClient() {
  if (supabaseServiceClient) return supabaseServiceClient;
  if (attemptedLoad) return null;

  attemptedLoad = true;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  try {
    const mod = await import('@supabase/supabase-js');
    supabaseServiceClient = mod.createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    return supabaseServiceClient;
  } catch (_err) {
    return null;
  }
}
