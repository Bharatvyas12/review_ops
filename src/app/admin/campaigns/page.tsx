import type { Metadata } from "next";
import { requireAdminOrRedirect } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  CampaignsPanel,
  type CampaignListItem,
  type BrandOption,
} from "@/components/admin/CampaignsPanel";
import type { BrandRow, CampaignWithBrand } from "@/lib/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const { supabase } = await requireAdminOrRedirect();

  const [campaignsResult, brandsResult] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, brand_id, campaign_number, created_by, created_at, brand:brands(id, brand_seq, name)")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("brands")
      .select("id, brand_seq, name")
      .order("brand_seq", { ascending: true })
      .limit(500),
  ]);

  if (campaignsResult.error) throw campaignsResult.error;
  if (brandsResult.error) throw brandsResult.error;

  const rawCampaigns = (campaignsResult.data ?? []) as unknown as CampaignWithBrand[];
  const rawBrands = (brandsResult.data ?? []) as unknown as Pick<BrandRow, "id" | "brand_seq" | "name">[];

  const campaigns: CampaignListItem[] = rawCampaigns.map((row) => ({
    id: row.id,
    brandId: row.brand_id,
    brandSeq: row.brand?.brand_seq ?? null,
    brandName: row.brand?.name ?? "Unknown Brand",
    campaignNumber: row.campaign_number,
    createdAt: row.created_at,
  }));

  const brands: BrandOption[] = rawBrands.map((b) => ({
    id: b.id,
    brandSeq: b.brand_seq,
    name: b.name,
  }));

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Brand and campaign number pairings. Creating or deleting a campaign writes an audit row."
      />
      <CampaignsPanel campaigns={campaigns} brands={brands} />
    </>
  );
}
