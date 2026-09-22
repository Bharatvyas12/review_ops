import "server-only";

/**
 * Server-only secrets. Importing this module from a client component is a build
 * error, which is what keeps SUPABASE_SERVICE_ROLE_KEY and the Claude key out of
 * the browser bundle.
 *
 * Every accessor is lazy so that `next build` never needs real secrets.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required server environment variable: ${name}. ` +
        "See .env.example. Never commit real values to the repository.",
    );
  }
  return value.trim();
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = optional(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const serverEnv = {
  get supabaseUrl(): string {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey(): string {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get serviceRoleKey(): string {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get bankEncryptionKey(): string {
    return required("BANK_ENCRYPTION_KEY");
  },
  get bankEncryptionKeyPrevious(): string | null {
    return optional("BANK_ENCRYPTION_KEY_PREVIOUS");
  },
  get anthropicApiKey(): string {
    return required("ANTHROPIC_API_KEY");
  },
  /** True when screenshot extraction can actually run. Never throws. */
  get hasAnthropicKey(): boolean {
    return optional("ANTHROPIC_API_KEY") !== null;
  },
  get anthropicModel(): string {
    return optional("ANTHROPIC_MODEL") ?? "claude-haiku-4-5";
  },
  get signedUrlTtlScreenshot(): number {
    return numberFromEnv("SIGNED_URL_TTL_SCREENSHOT", 3600);
  },
  get signedUrlTtlShare(): number {
    return numberFromEnv("SIGNED_URL_TTL_SHARE", 86400);
  },
  get upstashUrl(): string | null {
    return optional("UPSTASH_REDIS_REST_URL");
  },
  get upstashToken(): string | null {
    return optional("UPSTASH_REDIS_REST_TOKEN");
  },
  /** Ready-made Upstash config for enforceRateLimit(), or undefined. */
  get rateLimitRedis(): { url: string; token: string } | undefined {
    const url = optional("UPSTASH_REDIS_REST_URL");
    const token = optional("UPSTASH_REDIS_REST_TOKEN");
    return url && token ? { url, token } : undefined;
  },

  // ---- OTP / SMS ----------------------------------------------------------
  get otpHashPepper(): string | null {
    return optional("OTP_HASH_PEPPER");
  },
  get otpTtlSeconds(): number {
    return numberFromEnv("OTP_TTL_SECONDS", 300);
  },
  get otpMaxAttempts(): number {
    return numberFromEnv("OTP_MAX_ATTEMPTS", 5);
  },
  get smsProviderUrl(): string | null {
    return optional("SMS_PROVIDER_URL");
  },
  get smsProviderApiKey(): string | null {
    return optional("SMS_PROVIDER_API_KEY");
  },
  get smsSenderId(): string | null {
    return optional("SMS_SENDER_ID");
  },

  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
} as const;
