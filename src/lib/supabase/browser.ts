"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env/public";

let cachedClient: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Browser client, anon key only. Every statement it issues is filtered by the
 * RLS policies in supabase/migrations/0002_rls_and_policies.sql  there is no
 * privileged path from the browser.
 */
export function createBrowserSupabaseClient() {
  if (cachedClient) return cachedClient;
  cachedClient = createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
  return cachedClient;
}
