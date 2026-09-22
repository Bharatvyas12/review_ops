import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env/server";

let cachedClient: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS, therefore:
 *   * it may only be imported from modules that also import "server-only";
 *   * every caller must first prove admin rights through requireAdminSession().
 *
 * It exists for exactly three jobs: reading the encrypted bank column, minting
 * signed storage URLs, and uploading into private buckets.
 */
export function createAdminSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  cachedClient = createClient(serverEnv.supabaseUrl, serverEnv.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "X-Client-Info": "reviewsys-admin/server" },
    },
  });

  return cachedClient;
}
