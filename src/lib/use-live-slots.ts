"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export type SlotCounts = { slots_filled: number; released_slots: number };

/**
 * Keeps the product feed's slot counters in step with everyone else.
 *
 * Realtime runs on the browser anon-key client, so it inherits RLS: a signed-in
 * reviewer only receives open products, exactly like the REST reads. UPDATE
 * events patch the count in place (no server round trip, so the number moves the
 * instant somebody else claims), while INSERT/DELETE are rare and simply trigger
 * a refresh of the server-rendered list.
 *
 * A failure here is never fatal: the feed still renders whatever the server sent
 * and the claim action updates the row itself.
 */
export function useLiveSlots(initial: Record<string, SlotCounts>) {
  const router = useRouter();
  const [slots, setSlots] = useState<Record<string, SlotCounts>>(initial);
  const [changedId, setChangedId] = useState<string | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-seed whenever the server-rendered counts actually change. Keyed on the
  // serialised values (not just the ids) so a refresh that brings newer numbers
  // is not ignored, while an unrelated re-render does not clobber a realtime
  // value that arrived a moment ago.
  const signature = JSON.stringify(initial);
  useEffect(() => {
    setSlots(JSON.parse(signature) as Record<string, SlotCounts>);
  }, [signature]);

  const markChanged = useCallback((id: string) => {
    setChangedId(id);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setChangedId(null), 1200);
  }, []);

  /** Optimistic local bump so the claim feels immediate. */
  const applyClaim = useCallback(
    (id: string) => {
      setSlots((current) => {
        const row = current[id];
        if (!row) return current;
        return {
          ...current,
          [id]: { ...row, slots_filled: Math.min(row.released_slots, row.slots_filled + 1) },
        };
      });
      markChanged(id);
    },
    [markChanged],
  );

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    try {
      const supabase = createBrowserSupabaseClient();
      const channel = supabase
        .channel("user:products")
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "products" },
          (payload) => {
            if (cancelled) return;
            const row = payload.new as {
              id?: string;
              slots_filled?: number;
              released_slots?: number;
            };
            if (
              !row?.id ||
              typeof row.slots_filled !== "number" ||
              typeof row.released_slots !== "number"
            ) {
              return;
            }
            setSlots((current) => ({
              ...current,
              [row.id as string]: {
                slots_filled: row.slots_filled as number,
                // The daily job raises this while the page is open, so the
                // counter jumps the moment a new batch opens too.
                released_slots: row.released_slots as number,
              },
            }));
            markChanged(row.id as string);
          },
        )
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "products" }, () => {
          if (!cancelled) router.refresh();
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "products" }, () => {
          if (!cancelled) router.refresh();
        })
        .subscribe();

      cleanup = () => {
        cancelled = true;
        void supabase.removeChannel(channel);
      };
    } catch {
      // Realtime unavailable: the counters stay at their server-rendered value.
    }

    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
      cleanup?.();
    };
  }, [markChanged, router]);

  return { slots, changedId, applyClaim, markChanged };
}
