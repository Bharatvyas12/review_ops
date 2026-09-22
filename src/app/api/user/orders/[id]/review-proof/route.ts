import { requireVerifiedUserSession } from "@/lib/auth";
import { badRequest, errorResponse, jsonOk, parseJson } from "@/lib/http";
import { uuidSchema, reviewProofSchema } from "@/lib/validation";
import { mapUserMutationError } from "@/lib/user-errors";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** Saves the review screenshot and/or live link, and moves to review_submitted. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireVerifiedUserSession();

    const { id } = await context.params;
    const orderId = uuidSchema.safeParse(id);
    if (!orderId.success) throw badRequest("Invalid order id.");

    const input = await parseJson(request, reviewProofSchema);

    const { data, error } = await session.supabase.rpc("submit_review_proof", {
      p_order_id: orderId.data,
      p_screenshot_path: input.screenshotPath ?? null,
      p_review_link: input.reviewLink ?? null,
    });

    if (error) throw mapUserMutationError(error);

    return jsonOk({ order: data });
  } catch (error) {
    return errorResponse(error);
  }
}
