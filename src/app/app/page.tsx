import type { Metadata } from "next";
import Link from "next/link";
import { requireUserOrRedirect, isPhoneVerified } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ProductFeed, type ProductFeedItem } from "@/components/app/ProductFeed";
import { IconAlert, IconChevronRight } from "@/components/ui/icons";
import { PRODUCT_IMAGE_BUCKET, createSignedImageUrls, screenshotTtlSeconds } from "@/lib/storage";
import { slotsLeft } from "@/lib/user-orders";
import type { ProductRow } from "@/lib/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Cashback offers" };

export default async function FeedPage() {
  const session = await requireUserOrRedirect("/app");
  const verified = isPhoneVerified(session.profile);

  // Counts come from the rows themselves, never from a cached aggregate, so
  // "live" means the value that is in the database at render time. Realtime
  // keeps it accurate from then on without a refresh.
  const [productsResult, activeOrdersResult] = await Promise.all([
    session.supabase
      .from("products")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(60),
    session.supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.userId)
      .not("status", "in", "(paid,rejected)"),
  ]);

  if (productsResult.error) throw productsResult.error;

  const products = (productsResult.data ?? []) as ProductRow[];

  // Product images live in a private bucket, so previews are signed server-side
  // and expire rather than being permanently public URLs.
  const signedUrls = await createSignedImageUrls(
    createAdminSupabaseClient(),
    PRODUCT_IMAGE_BUCKET,
    products.map((product) => product.image_url),
    screenshotTtlSeconds(),
  );

  const items: ProductFeedItem[] = products.map((product) => ({
    id: product.id,
    name: product.name,
    brand: product.brand,
    description: product.description,
    imageUrl: product.image_url ? signedUrls.get(product.image_url) ?? null : null,
    totalSlots: product.total_slots,
    slotsFilled: product.slots_filled,
    releasedSlots: product.released_slots,
    cashbackAmount: product.cashback_amount === null ? null : Number(product.cashback_amount),
  }));

  // "Left" is always measured against the slots that have been released.
  const openCount = items.filter(
    (item) => slotsLeft({ slots_filled: item.slotsFilled, released_slots: item.releasedSlots }) > 0,
  ).length;
  const slotsAvailable = items.reduce(
    (total, item) =>
      total + slotsLeft({ slots_filled: item.slotsFilled, released_slots: item.releasedSlots }),
    0,
  );
  const activeOrders = activeOrdersResult.count ?? 0;

  return (
    <div>
      {!verified ? (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-signal-500/30 bg-signal-50 p-4">
          <IconAlert className="h-5 w-5 shrink-0 text-signal-600" />
          <div className="min-w-0 flex-1">
            <p className="font-body text-[14px] font-semibold text-signal-700">
              Verify your mobile number to claim
            </p>
            <p className="mt-0.5 font-body text-[13px] leading-relaxed text-signal-700/80">
              You can browse now, but claiming a slot stays locked until the code is confirmed.
            </p>
          </div>
          <Link href="/app/verify" className="u-btn-primary !py-2.5 text-[14px]">
            Verify now
          </Link>
        </div>
      ) : null}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="u-data text-[11px] uppercase tracking-[0.18em] text-ink-500 dark:text-paper-200/50">
            {openCount} open {openCount === 1 ? "offer" : "offers"}
          </p>
          <h1 className="mt-1 font-display text-[24px] font-semibold tracking-tight text-ink-900 dark:text-paper-50">
            Cashback offers
          </h1>
          <p className="mt-1 max-w-md text-[13px] leading-relaxed text-ink-500 dark:text-paper-200/60">
            Claim a slot, buy on Amazon, then send the order screenshot. We read the details for
            you.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-paper-300 bg-paper-100/70 px-3 py-1.5 dark:border-white/10 dark:bg-white/5">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-done-500 animate-[live-pulse_2.2s_ease-in-out_infinite]"
          />
          <span className="u-data text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-600 dark:text-paper-200/70">
            {slotsAvailable} {slotsAvailable === 1 ? "slot" : "slots"} left
          </span>
        </div>
      </header>

      {activeOrders > 0 ? (
        <Link
          href="/app/orders"
          className="mt-5 flex items-center gap-3 rounded-xl border border-paper-300 bg-paper-100/60 px-4 py-3 transition hover:bg-paper-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
        >
          <span className="u-data text-[13px] font-semibold text-ink-900 dark:text-paper-50">
            {activeOrders}
          </span>
          <span className="font-body text-[13px] text-ink-600 dark:text-paper-200/70">
            {activeOrders === 1 ? "order is in progress" : "orders are in progress"}
          </span>
          <IconChevronRight className="ml-auto h-4 w-4 text-ink-500 dark:text-paper-200/50" />
        </Link>
      ) : null}

      <div className="mt-5">
        <ProductFeed products={items} />
      </div>
    </div>
  );
}

