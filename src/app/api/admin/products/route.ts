import { requireAdminSession } from "@/lib/auth";
import { errorResponse, jsonOk, parseJson } from "@/lib/http";
import { productCreateSchema } from "@/lib/validation";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    // Independent admin re-check. The RPC re-checks again inside Postgres, and
    // writes the audit_log row in the same transaction as the insert.
    const { supabase } = await requireAdminSession();

    const input = await parseJson(request, productCreateSchema);

    const { data, error } = await supabase.rpc("admin_create_product", {
      p_name: input.name,
      p_brand: input.brand ?? null,
      p_description: input.description ?? null,
      p_image_url: input.imageUrl ?? null,
      p_total_slots: input.totalSlots,
      p_cashback_amount: input.cashbackAmount ?? null,
      p_product_link: input.productLink ?? null,
      p_campaign: input.campaign ?? null,
      p_asin_code: input.asinCode ?? null,
      p_daily_release_limit: input.dailyReleaseLimit ?? null,
      p_brand_id: input.brandId ?? null,
      p_campaign_id: input.campaignId ?? null,
    });

    if (error) throw error;
    return jsonOk({ product: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
