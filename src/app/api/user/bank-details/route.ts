import { requireUserSession } from "@/lib/auth";
import { badRequest, errorResponse, jsonOk, parseJson } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { serverEnv } from "@/lib/env/server";
import { bankDetailsSchema } from "@/lib/validation";
import { encryptAccountNumber, isValidAccountNumber, last4 } from "@/lib/crypto";
import { mapUserMutationError } from "@/lib/user-errors";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Saves payout details.
 *
 * The account number is encrypted here, in the app layer, with the Phase 1
 * crypto library - there is no second implementation of that anywhere. Only the
 * ciphertext and the last four digits ever reach the database, and the response
 * carries the masked projection, never the number the user typed.
 *
 * The audit row is written by user_save_bank_details(), so the change and its
 * record cannot drift apart.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireUserSession();

    await enforceRateLimit(request, {
      bucket: "bank-details:user",
      limit: 10,
      windowMs: 15 * 60_000,
      identifier: session.userId,
      redis: serverEnv.rateLimitRedis,
    });

    const input = await parseJson(request, bankDetailsSchema);

    let encrypted: string | null = null;
    let last4Digits: string | null = null;

    if (input.accountNumber) {
      if (!isValidAccountNumber(input.accountNumber)) {
        throw badRequest("Account numbers are 6 to 34 digits.");
      }
      encrypted = await encryptAccountNumber(input.accountNumber);
      last4Digits = last4(input.accountNumber);
    }

    const { data, error } = await session.supabase.rpc("user_save_bank_details", {
      p_account_holder_name: input.accountHolderName ?? null,
      p_account_number_encrypted: encrypted,
      p_account_number_last4: last4Digits,
      p_ifsc_code: input.ifscCode ?? null,
      p_upi_id: input.upiId ?? null,
    });

    if (error) throw mapUserMutationError(error);

    const row = Array.isArray(data) ? data[0] : data;
    return jsonOk({ bankDetails: row ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
