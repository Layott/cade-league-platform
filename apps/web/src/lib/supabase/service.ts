import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client with the service-role key. Bypasses RLS.
 *
 * Use in Server Actions / Route Handlers for writes that the authenticated
 * user's session cannot perform directly (e.g. match result entry: the admin
 * is authenticated but we still write via service role so we control audit
 * context and don't depend on policy glue code).
 *
 * Never expose this client to browser code.
 */
let cached: SupabaseClient | null = null;

export function getServiceRoleSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "getServiceRoleSupabase: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required"
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
