import { requireAdminSession } from "@/lib/auth";
import { errorResponse, jsonOk, parseJson } from "@/lib/http";
import { campaignCreateSchema } from "@/lib/validation";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { supabase } = await requireAdminSession();

    const input = await parseJson(request, campaignCreateSchema);

    const { data, error } = await supabase.rpc("admin_create_campaign", {
      p_brand_id: input.brandId,
      p_campaign_number: input.campaignNumber,
    });

    if (error) throw error;
    return jsonOk({ campaign: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
