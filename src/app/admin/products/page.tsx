import type { Metadata } from "next";
import { requireAdminOrRedirect } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProductsPanel, type ProductListItem } from "@/components/admin/ProductsPanel";
import { PRODUCT_IMAGE_BUCKET, createSignedImageUrls, screenshotTtlSeconds } from "@/lib/storage";
import type { BrandRow, CampaignRow, ProductRow } from "@/lib/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Products" };

type ProductWithRefs = ProductRow & {
  brand_ref: { id: string; name: string; brand_seq: number } | null;
  campaign_ref: { id: string; campaign_number: number } | null;
};

export default async function ProductsPage() {
  const { supabase } = await requireAdminOrRedirect();

  const [productsRes, brandsRes, campaignsRes] = await Promise.all([
    supabase
      .from("products")
      .select("*, brand_ref:brands(id, name, brand_seq), campaign_ref:campaigns(id, campaign_number)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("brands").select("*").order("brand_seq", { ascending: true }).limit(500),
    supabase.from("campaigns").select("*").order("campaign_number", { ascending: true }).limit(500),
  ]);

  if (productsRes.error) throw productsRes.error;

  const products = (productsRes.data ?? []) as unknown as ProductWithRefs[];
  const brands = (brandsRes.data ?? []) as BrandRow[];
  const campaigns = (campaignsRes.data ?? []) as CampaignRow[];

  // Product images live in a private bucket, so previews are signed server-side.
  const signedUrls = await createSignedImageUrls(
    createAdminSupabaseClient(),
    PRODUCT_IMAGE_BUCKET,
    products.map((product) => product.image_url),
    screenshotTtlSeconds(),
  );

  const items: ProductListItem[] = products.map((product) => {
    const brandName = product.brand_ref?.name ?? product.brand ?? null;
    const campaignLabel = product.campaign_ref
      ? `Campaign ${product.campaign_ref.campaign_number}`
      : product.campaign ?? null;

    return {
      id: product.id,
      name: product.name,
      brand: product.brand,
      brandId: product.brand_id,
      brandName,
      description: product.description,
      imageUrl: product.image_url,
      signedImageUrl: product.image_url ? signedUrls.get(product.image_url) ?? null : null,
      totalSlots: product.total_slots,
      slotsFilled: product.slots_filled,
      releasedSlots: product.released_slots,
      dailyReleaseLimit: product.daily_release_limit,
      cashbackAmount: product.cashback_amount === null ? null : Number(product.cashback_amount),
      status: product.status,
      createdAt: product.created_at,
      productLink: product.product_link,
      campaign: product.campaign,
      campaignId: product.campaign_id,
      campaignLabel,
      asinCode: product.asin_code,
    };
  });

  const brandOptions = brands.map((b) => ({
    id: b.id,
    brandSeq: b.brand_seq,
    name: b.name,
  }));

  const campaignOptions = campaigns.map((c) => ({
    id: c.id,
    brandId: c.brand_id,
    campaignNumber: c.campaign_number,
  }));

  return (
    <>
      <PageHeader
        title="Products"
        description="Products, slots and cashback. Creating or editing a product writes an audit row."
      />
      <ProductsPanel products={items} brands={brandOptions} campaigns={campaignOptions} />
    </>
  );
}
