import { requireAdminSession } from "@/lib/auth";
import { badRequest, errorResponse, jsonOk } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { supabase } = await requireAdminSession();

    const { id } = await context.params;
    const campaignId = uuidSchema.safeParse(id);
    if (!campaignId.success) throw badRequest("Invalid campaign id.");

    const { error } = await supabase.rpc("admin_delete_campaign", {
      p_campaign_id: campaignId.data,
    });

    if (error) throw error;
    return jsonOk({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
