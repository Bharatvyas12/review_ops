import type { Metadata } from "next";
import { requireAdminOrRedirect } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui/PageHeader";
import { SubmissionQueue, type QueueItem } from "@/components/admin/SubmissionQueue";
import { SCREENSHOT_BUCKET, createSignedImageUrls, screenshotTtlSeconds } from "@/lib/storage";
import type { OrderWithRelations } from "@/lib/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Review approvals" };

export default async function ReviewsPage() {
  const { supabase } = await requireAdminOrRedirect();

  const { data, error } = await supabase
    .from("orders")
    .select(
      "*, product:products(id, name, brand, cashback_amount), user:profiles!orders_user_id_fkey(id, full_name, phone)",
    )
    .eq("status", "review_submitted")
    .order("updated_at", { ascending: true })
    .limit(100);

  if (error) throw error;

  const orders = (data ?? []) as unknown as OrderWithRelations[];

  const signedUrls = await createSignedImageUrls(
    createAdminSupabaseClient(),
    SCREENSHOT_BUCKET,
    orders.map((order) => order.review_screenshot_url),
    screenshotTtlSeconds(),
  );

  const items: QueueItem[] = orders.map((order) => ({
    id: order.id,
    userName: order.user?.full_name ?? "Unknown user",
    userPhone: order.user?.phone ?? null,
    productName: order.product?.name ?? null,
    productBrand: order.product?.brand ?? null,
    cashbackAmount:
      order.product?.cashback_amount === null || order.product?.cashback_amount === undefined
        ? null
        : Number(order.product.cashback_amount),
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    screenshotUrl: order.review_screenshot_url
      ? signedUrls.get(order.review_screenshot_url) ?? null
      : null,
    reviewLink: order.review_link,
    extracted: null,
    userConfirmed: order.user_confirmed,
  }));

  return (
    <>
      <PageHeader
        title="Review approvals"
        description={`${items.length} review${items.length === 1 ? "" : "s"} waiting. Approving moves the order into the payout queue.`}
      />
      <SubmissionQueue kind="review" items={items} />
    </>
  );
}
