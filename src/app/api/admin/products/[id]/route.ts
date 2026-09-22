import { requireAdminSession } from "@/lib/auth";
import { badRequest, errorResponse, jsonOk, parseJson } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { productUpdateSchema } from "@/lib/validation";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { supabase } = await requireAdminSession();

    const { id } = await context.params;
    const productId = uuidSchema.safeParse(id);
    if (!productId.success) throw badRequest("Invalid product id.");

    const input = await parseJson(request, productUpdateSchema);

    const { data, error } = await supabase.rpc("admin_update_product", {
      p_product_id: productId.data,
      p_name: input.name ?? null,
      p_brand: input.brand ?? null,
      p_description: input.description ?? null,
      p_image_url: input.imageUrl ?? null,
      p_total_slots: input.totalSlots ?? null,
      p_cashback_amount: input.cashbackAmount ?? null,
      p_status: input.status ?? null,
      // null means "leave this field alone" in the RPC; "" clears it.
      p_product_link: input.productLink ?? null,
      p_campaign: input.campaign ?? null,
      p_asin_code: input.asinCode ?? null,
      // null leaves the limit alone; 0 removes it.
      p_daily_release_limit: input.dailyReleaseLimit ?? null,
      p_brand_id: input.brandId ?? null,
      p_campaign_id: input.campaignId ?? null,
    });

    if (error) throw error;
    return jsonOk({ product: data });
  } catch (error) {
    return errorResponse(error);
  }
}
