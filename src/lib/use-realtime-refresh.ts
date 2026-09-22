"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

// Refreshes server components when a row changes.
//
// Realtime runs on the browser client with the anon key, so it inherits RLS:
// an admin session only receives rows it is allowed to see, and a non-admin
// session receives nothing useful. Failures are swallowed, because live
// updates are a convenience and never a correctness requirement.
export function useRealtimeRefresh(
  table: "orders" | "products" | "notifications" | "brands" | "campaigns",
): void {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    try {
      const supabase = createBrowserSupabaseClient();
      const channel = supabase
        .channel(`admin:${table}`)
        .on("postgres_changes", { event: "*", schema: "public", table }, () => {
          if (cancelled) return;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => router.refresh(), 700);
        })
        .subscribe();

      cleanup = () => {
        cancelled = true;
        void supabase.removeChannel(channel);
      };
    } catch {
      // Realtime unavailable on this project  manual refresh still works.
    }

    return () => {
      if (timer.current) clearTimeout(timer.current);
      cleanup?.();
    };
  }, [router, table]);
}
