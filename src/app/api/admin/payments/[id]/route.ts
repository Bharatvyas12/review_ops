import { requireAdminSession } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  ApiError,
  badRequest,
  errorResponse,
  jsonOk,
  notFound,
  parseJson,
} from "@/lib/http";
import { paymentActionSchema, uuidSchema } from "@/lib/validation";
import { decryptAccountNumber } from "@/lib/crypto";
import { serverEnv } from "@/lib/env/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** Revealing a bank account is only ever allowed for orders in the payment console. */
const REVEALABLE_STATUSES = new Set(["approved", "paid"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAdminSession();

    const { id } = await context.params;
    const orderId = uuidSchema.safeParse(id);
    if (!orderId.success) throw badRequest("Invalid order id.");

    const input = await parseJson(request, paymentActionSchema);

    if (input.action === "mark_paid") {
      const { data, error } = await session.supabase.rpc("admin_mark_paid", {
        p_order_id: orderId.data,
        p_payment_reference: input.paymentReference,
        p_details: { source: "admin_panel", admin_id: session.userId },
      });
      if (error) throw error;
      return jsonOk({ order: data });
    }

    // ---- reveal -------------------------------------------------------------
    const { data: order, error: orderError } = await session.supabase
      .from("orders")
      .select("id, user_id, status, product_id")
      .eq("id", orderId.data)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order) throw notFound("Order not found.");
    if (!REVEALABLE_STATUSES.has(order.status)) {
      throw new ApiError(
        409,
        "Bank details can only be revealed for approved or paid orders.",
        "not_revealable",
      );
    }

    // Audit BEFORE decrypting. If the audit write fails, the number is never
    // produced, so a reveal can never go unrecorded.
    const { error: auditError } = await session.supabase.rpc("admin_log_bank_reveal", {
      p_user_id: order.user_id,
      p_order_id: order.id,
      p_context: "payments_console",
    });
    if (auditError) throw auditError;

    // The ciphertext column is not readable by any authenticated session  not
    // even an admin one  so this read goes through the service role.
    const admin = createAdminSupabaseClient();
    const { data: bank, error: bankError } = await admin
      .from("bank_details")
      .select(
        "user_id, account_holder_name, account_number_encrypted, account_number_last4, ifsc_code, upi_id",
      )
      .eq("user_id", order.user_id)
      .maybeSingle();

    if (bankError) throw bankError;

    const encrypted = (bank as { account_number_encrypted?: string | null } | null)
      ?.account_number_encrypted;
    if (!encrypted) {
      throw notFound("This user has not saved bank details yet.");
    }

    const accountNumber = await decryptAccountNumber(encrypted, {
      primary: serverEnv.bankEncryptionKey,
      previous: serverEnv.bankEncryptionKeyPrevious,
    });

    return jsonOk({
      accountNumber,
      accountHolderName: bank?.account_holder_name ?? null,
      accountNumberLast4: bank?.account_number_last4 ?? null,
      ifscCode: bank?.ifsc_code ?? null,
      upiId: bank?.upi_id ?? null,
      auditedAt: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
