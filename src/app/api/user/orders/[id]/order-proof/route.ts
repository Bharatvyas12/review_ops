import { requireVerifiedUserSession } from "@/lib/auth";
import { badRequest, errorResponse, jsonOk, parseJson } from "@/lib/http";
import { uuidSchema, orderProofSchema } from "@/lib/validation";
import { mapUserMutationError } from "@/lib/user-errors";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Saves the confirmed extraction and moves the order straight to review_pending.
 *
 * There is no admin approval in between: the screenshot is stored as the record
 * of the purchase, and the reviewer is asked for their review immediately.
 * The database decides the resulting status inside submit_order_proof().
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireVerifiedUserSession();

    const { id } = await context.params;
    const orderId = uuidSchema.safeParse(id);
    if (!orderId.success) throw badRequest("Invalid order id.");

    const input = await parseJson(request, orderProofSchema);

    const { data, error } = await session.supabase.rpc("submit_order_proof", {
      p_order_id: orderId.data,
      p_screenshot_path: input.screenshotPath,
      p_name: input.name ?? null,
      p_order_ref: input.orderRef,
      p_phone: input.phone ?? null,
      p_product_name: input.productName ?? null,
    });

    if (error) throw mapUserMutationError(error);

    return jsonOk({ order: data });
  } catch (error) {
    return errorResponse(error);
  }
}
