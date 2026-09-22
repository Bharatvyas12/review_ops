"use client";

import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";

/**
 * Client-side shim so a server page can opt into live order updates. RLS decides
 * which rows actually arrive, so this can only ever refresh the caller's own
 * list.
 */
export function OrdersRealtime() {
  useRealtimeRefresh("orders");
  return null;
}
