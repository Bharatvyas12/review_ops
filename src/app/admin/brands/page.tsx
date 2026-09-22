import type { Metadata } from "next";
import { requireAdminOrRedirect } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { BrandsPanel, type BrandListItem } from "@/components/admin/BrandsPanel";
import type { BrandRow } from "@/lib/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Brands" };

export default async function BrandsPage() {
  const { supabase } = await requireAdminOrRedirect();

  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .order("brand_seq", { ascending: true })
    .limit(500);

  if (error) throw error;

  const brands = (data ?? []) as BrandRow[];

  const items: BrandListItem[] = brands.map((row) => ({
    id: row.id,
    brandSeq: row.brand_seq,
    name: row.name,
    pocName: row.poc_name,
    pocNumber: row.poc_number,
    pocEmail: row.poc_email,
    website: row.website,
    createdAt: row.created_at,
  }));

  return (
    <>
      <PageHeader
        title="Brands"
        description="Advertiser brands with point-of-contact info. Creating, editing or deleting a brand writes an audit row."
      />
      <BrandsPanel brands={items} />
    </>
  );
}
