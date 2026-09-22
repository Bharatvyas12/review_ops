import "server-only";
import { serverEnv } from "@/lib/env/server";
import { maskPhone } from "@/lib/otp";

/**
 * SMS transport.
 *
 * The OTP flow only ever talks to this interface, so swapping vendors is a
 * matter of returning a different implementation from createSmsProvider() - or,
 * for any vendor that accepts a JSON POST, of setting SMS_PROVIDER_URL.
 *
 * Nothing here decides whether verification is *required*; it only delivers the
 * code. The verification gate itself lives in the database
 * (public.assert_verified_user) so a missing SMS provider can never quietly
 * turn into an unverified-but-allowed state in production.
 */

export type SmsMessage = {
  to: string;
  body: string;
};

export type SmsSendResult =
  | { delivered: true; provider: string; messageId: string | null }
  | { delivered: false; provider: string; reason: "not_configured" | "failed"; detail?: string };

export interface SmsProvider {
  readonly name: string;
  readonly configured: boolean;
  send(message: SmsMessage): Promise<SmsSendResult>;
}

/**
 * Development transport, used when no provider is configured.
 *
 * It prints the message to the server console so the flow stays testable
 * locally, and it is deliberately inert in production: the send route refuses
 * to issue a code at all when NODE_ENV is "production" and no provider is
 * configured, so this can never become a silent production bypass.
 */
class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  readonly configured = false;

  async send(message: SmsMessage): Promise<SmsSendResult> {
    if (serverEnv.isProduction) {
      return { delivered: false, provider: this.name, reason: "not_configured" };
    }

    console.warn(
      [
        "",
        "  [sms] SMS provider is NOT configured - no message was sent.",
        "  [sms] Set SMS_PROVIDER_URL and SMS_PROVIDER_API_KEY to deliver real messages.",
        `  [sms] DEV ONLY, for ${maskPhone(message.to)}:`,
        `  [sms] ${message.body}`,
        "",
      ].join("\n"),
    );

    return { delivered: false, provider: this.name, reason: "not_configured" };
  }
}

/**
 * Generic HTTP transport: POSTs { to, body, sender } as JSON with a bearer
 * token. Point SMS_PROVIDER_URL at a vendor, or implement SmsProvider directly
 * when a vendor needs a different payload shape.
 */
class HttpSmsProvider implements SmsProvider {
  readonly name = "http";
  readonly configured = true;

  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly senderId: string | null,
  ) {}

  async send(message: SmsMessage): Promise<SmsSendResult> {
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          to: message.to,
          body: message.body,
          sender: this.senderId ?? undefined,
        }),
      });

      if (!response.ok) {
        // Never echo the body: it can contain the code.
        return {
          delivered: false,
          provider: this.name,
          reason: "failed",
          detail: `provider responded ${response.status}`,
        };
      }

      const payload = (await response.json().catch(() => null)) as { id?: string } | null;
      return { delivered: true, provider: this.name, messageId: payload?.id ?? null };
    } catch (error) {
      return {
        delivered: false,
        provider: this.name,
        reason: "failed",
        detail: error instanceof Error ? error.name : "unknown error",
      };
    }
  }
}

let cached: SmsProvider | null = null;

export function createSmsProvider(): SmsProvider {
  if (cached) return cached;

  const url = serverEnv.smsProviderUrl;
  const apiKey = serverEnv.smsProviderApiKey;

  cached =
    url && apiKey
      ? new HttpSmsProvider(url, apiKey, serverEnv.smsSenderId)
      : new ConsoleSmsProvider();

  return cached;
}

/** Test helper: forget the memoised provider. */
export function resetSmsProvider(): void {
  cached = null;
}
