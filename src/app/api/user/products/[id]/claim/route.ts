import { requireVerifiedUserSession } from "@/lib/auth";
import { ApiError, badRequest, errorResponse, jsonOk } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { serverEnv } from "@/lib/env/server";
import { uuidSchema } from "@/lib/validation";
import { mapUserMutationError } from "@/lib/user-errors";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Claims a slot and creates the order in one transaction.
 *
 * Runs through the caller's own session client (never the service role), so
 * auth.uid() inside claim_product_for_user() is the real user and the database
 * can enforce the verified-phone rule and the one-active-claim-per-product
 * index itself.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireVerifiedUserSession();

    await enforceRateLimit(request, {
      bucket: "claim:user",
      limit: 20,
      windowMs: 60_000,
      identifier: session.userId,
      redis: serverEnv.rateLimitRedis,
    });

    const { id } = await context.params;
    const productId = uuidSchema.safeParse(id);
    if (!productId.success) throw badRequest("Invalid product id.");

    const { data, error } = await session.supabase.rpc("claim_product_for_user", {
      p_product_id: productId.data,
    });

    if (error) throw mapUserMutationError(error);

    // No row and no error means the atomic UPDATE matched nothing: the last
    // slot went to somebody else between render and click.
    if (!data) {
      throw new ApiError(
        409,
        "That was the last slot and someone just took it.",
        "sold_out",
      );
    }

    return jsonOk({ order: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
