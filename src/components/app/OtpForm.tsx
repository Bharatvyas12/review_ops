"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { IconAlert } from "@/components/ui/icons";

const RESEND_COOLDOWN_SECONDS = 30;

type SendResult = {
  delivered: boolean;
  smsConfigured: boolean;
  maskedPhone: string;
  devNotice: string | null;
};

/**
 * Phone code entry.
 *
 * The code is never stored in this component beyond the single field, never
 * put in a URL, and never written to storage. Failures are shown as the server
 * described them ("that code has expired") rather than as a generic error, so
 * the next action is obvious.
 */
export function OtpForm({
  maskedPhone,
  devConsoleHint = false,
}: {
  maskedPhone: string;
  devConsoleHint?: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [showDevHint, setShowDevHint] = useState(devConsoleHint);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);

    try {
      await apiRequest<{ redirectTo: string }>("/api/user/auth/otp/verify", { body: { code } });
      router.replace("/app");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Something went wrong. Please try again.",
      );
      setCode("");
      setPending(false);
    }
  }

  async function resend() {
    setError(null);
    setNotice(null);
    setSending(true);

    try {
      const result = await apiRequest<SendResult>("/api/user/auth/otp/send", { body: {} });
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setShowDevHint(!result.smsConfigured);
      setNotice(
        result.delivered
          ? `A new code was sent to ${result.maskedPhone}.`
          : `A new code was generated for ${result.maskedPhone}.`,
      );
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Could not send a new code.",
      );
    } finally {
      setSending(false);
    }
  }

  const ready = code.length === 6;

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {showDevHint ? (
        <div className="flex gap-3 rounded-xl border border-signal-500/25 bg-signal-50 p-3.5 text-[13px] leading-relaxed text-signal-700">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <span className="font-semibold">No SMS provider is configured in this environment.</span>{" "}
            The code was not texted. In development it is printed in the terminal running{" "}
            <code className="u-data">npm run dev</code>, prefixed with{" "}
            <code className="u-data">[sms]</code>. Production refuses to issue a code at all until a
            provider is set, so this can never ship as a silent bypass.
          </p>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-signal-500/30 bg-signal-50 px-3.5 py-3 text-[13px] font-medium text-signal-700"
        >
          {error}
        </p>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="rounded-xl border border-done-500/25 bg-done-50 px-3.5 py-3 text-[13px] font-medium text-done-700"
        >
          {notice}
        </p>
      ) : null}

      <div>
        <label htmlFor="code" className="u-label">
          6-digit code sent to {maskedPhone}
        </label>
        <input
          id="code"
          ref={inputRef}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          disabled={pending}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
          className="u-input u-data text-center text-[26px] font-semibold tracking-[0.42em]"
          placeholder="••••••"
          aria-describedby="code-help"
        />
        <p id="code-help" className="mt-1.5 text-[12px] text-ink-500 dark:text-paper-200/50">
          The code expires five minutes after it is sent.
        </p>
      </div>

      <button type="submit" disabled={pending || !ready} className="u-btn-primary w-full">
        {pending ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            Checking
          </>
        ) : (
          "Verify number"
        )}
      </button>

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-[13px] text-ink-500 dark:text-paper-200/50">Didn&apos;t get it?</p>
        <button
          type="button"
          onClick={resend}
          disabled={sending || cooldown > 0}
          className="u-btn-ghost u-data !text-[13px]"
        >
          {sending
            ? "Sending"
            : cooldown > 0
              ? `Resend in ${cooldown}s`
              : "Send a new code"}
        </button>
      </div>
    </form>
  );
}
