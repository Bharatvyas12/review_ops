import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env/server";
import { createSmsProvider } from "@/lib/sms/provider";
import {
  buildOtpMessage,
  generateOtpCode,
  hashOtpCode,
  maskPhone,
  otpExpiryFromNow,
} from "@/lib/otp";

/**
 * Issuing and checking phone codes.
 *
 * This module owns the parts that must never be duplicated across routes:
 *   * the code is generated with the CSPRNG and stored as a hash only;
 *   * exactly one code is live per user (older ones are consumed on issue);
 *   * when no SMS provider is configured we refuse to issue anything in
 *     production, so verification can never quietly stop being enforced;
 *   * verification goes through public.verify_phone_code(), which counts
 *     attempts and marks the code used under a single row lock.
 */

export type IssueOtpResult = {
  issued: boolean;
  delivered: boolean;
  smsConfigured: boolean;
  maskedPhone: string;
  expiresAt: string | null;
  reason: "not_configured" | "failed" | null;
};

export async function issuePhoneOtp(userId: string, phone: string): Promise<IssueOtpResult> {
  const provider = createSmsProvider();
  const maskedPhone = maskPhone(phone);

  // Production must never issue a code it cannot deliver: that would leave a
  // user stuck mid-verification with no signal that anything was wrong.
  if (!provider.configured && serverEnv.isProduction) {
    return {
      issued: false,
      delivered: false,
      smsConfigured: false,
      maskedPhone,
      expiresAt: null,
      reason: "not_configured",
    };
  }

  const admin = createAdminSupabaseClient();
  const code = generateOtpCode();
  const codeHash = await hashOtpCode(userId, code);
  const ttlSeconds = serverEnv.otpTtlSeconds;
  const expiresAt = otpExpiryFromNow(ttlSeconds);

  // Only the newest code may be live.
  await admin
    .from("phone_verifications")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("consumed_at", null);

  const { error } = await admin.from("phone_verifications").insert({
    user_id: userId,
    phone,
    code_hash: codeHash,
    max_attempts: serverEnv.otpMaxAttempts,
    expires_at: expiresAt.toISOString(),
  });

  if (error) throw error;

  const result = await provider.send({ to: phone, body: buildOtpMessage(code, ttlSeconds) });

  return {
    issued: true,
    delivered: result.delivered,
    smsConfigured: provider.configured,
    maskedPhone,
    expiresAt: expiresAt.toISOString(),
    reason: result.delivered ? null : result.reason,
  };
}

export type OtpVerificationStatus =
  | "verified"
  | "invalid"
  | "expired"
  | "too_many_attempts"
  | "missing"
  | "no_phone"
  | "error";

export async function verifyPhoneOtp(
  userId: string,
  code: string,
): Promise<OtpVerificationStatus> {
  const admin = createAdminSupabaseClient();
  const codeHash = await hashOtpCode(userId, code);

  const { data, error } = await admin.rpc("verify_phone_code", {
    p_user_id: userId,
    p_code_hash: codeHash,
  });

  if (error) return "error";
  return (data as OtpVerificationStatus | null) ?? "error";
}
