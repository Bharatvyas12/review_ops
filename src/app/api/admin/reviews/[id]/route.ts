import { requireAdminSession } from "@/lib/auth";
import { badRequest, errorResponse, jsonOk, parseJson } from "@/lib/http";
import { reviewActionSchema, uuidSchema } from "@/lib/validation";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { supabase, userId } = await requireAdminSession();

    const { id } = await context.params;
    const orderId = uuidSchema.safeParse(id);
    if (!orderId.success) throw badRequest("Invalid order id.");

    const input = await parseJson(request, reviewActionSchema);
    const isReject = input.action === "reject";

    const { data, error } = await supabase.rpc("admin_transition_order", {
      p_order_id: orderId.data,
      p_new_status: isReject ? "rejected" : "approved",
      p_action: isReject ? "reject_review" : "approve_review",
      p_reason: isReject ? input.reason : null,
      p_details: { source: "admin_panel", admin_id: userId },
    });

    if (error) throw error;
    return jsonOk({ order: data });
  } catch (error) {
    return errorResponse(error);
  }
}
