import { requireUserSession } from "@/lib/auth";
import { ApiError, badRequest, errorResponse, jsonOk } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { mapUserMutationError } from "@/lib/user-errors";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Withdraw a claim the reviewer has not acted on yet.
 *
 * Uses requireUserSession rather than the verified variant on purpose: releasing
 * a slot is how somebody backs out, so an account whose phone is no longer
 * verified must still be able to give the slot back rather than hold it
 * forever. The database asserts ownership of the order inside
 * withdraw_order_claim(), so a guessed id fails there too.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireUserSession();

    const { id } = await context.params;
    const orderId = uuidSchema.safeParse(id);
    if (!orderId.success) throw badRequest("Invalid order id.");

    const { data, error } = await session.supabase.rpc("withdraw_order_claim", {
      p_order_id: orderId.data,
    });

    if (error) {
      // Two withdrawals from different screens are the common case here, so the
      // message says what happened rather than reusing the submit wording.
      if (error.hint === "order_locked") {
        throw new ApiError(
          409,
          "This claim has already been submitted, so it can no longer be withdrawn.",
          "order_locked",
        );
      }
      if (error.hint === "order_not_found") {
        throw new ApiError(404, "We could not find that claim.", "not_found");
      }
      throw mapUserMutationError(error);
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { product_id?: string; slots_filled?: number }
      | null
      | undefined;

    const productId = row?.product_id ?? null;

    // The released figure is read from the product row instead of being added to
    // withdraw_order_claim()'s RETURNS TABLE: changing a function's row type on the
    // same signature makes supabase/setup.sql impossible to re-apply, because 0007's
    // create-or-replace then clashes with the newer definition. RLS limits this read
    // to products the caller may see, so a product closed in the meantime yields null.
    let releasedSlots: number | null = null;
    if (productId) {
      const { data: product } = await session.supabase
        .from("products")
        .select("released_slots")
        .eq("id", productId)
        .maybeSingle();
      releasedSlots = (product as { released_slots?: number } | null)?.released_slots ?? null;
    }

    return jsonOk({
      withdrawn: true,
      productId,
      slotsFilled: row?.slots_filled ?? null,
      releasedSlots,
    });
  } catch (error) {
    return errorResponse(error);
  }
}