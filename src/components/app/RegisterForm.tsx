"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { IconCheck } from "@/components/ui/icons";

type RegisterResult = {
  redirectTo: string;
  otp: { delivered: boolean; smsConfigured: boolean; maskedPhone: string } | null;
};

/**
 * Account creation.
 *
 * The password never leaves this form except to be posted once, and the phone
 * number is stored unverified: claiming and submitting stay locked until the
 * code is checked server-side.
 */
export function RegisterForm({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const update = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const passwordLongEnough = form.password.length >= 8;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const result = await apiRequest<RegisterResult>("/api/user/auth/register", {
        body: {
          fullName: form.fullName,
          email: form.email,
          phone: form.phone,
          password: form.password,
        },
      });

      setForm((current) => ({ ...current, password: "" }));

      // "console" is a development-only signal that no SMS provider is wired
      // up, so the verification screen can tell the user where to look instead
      // of leaving them waiting for a message that will never arrive.
      const search = result.otp && !result.otp.smsConfigured ? "?delivery=console" : "";
      router.replace(`${result.redirectTo}${search}`);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Something went wrong. Please try again.",
      );
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-signal-500/30 bg-signal-50 px-3.5 py-3 text-[13px] font-medium text-signal-700"
        >
          {error}
        </p>
      ) : null}

      <div>
        <label htmlFor="fullName" className="u-label">
          Full name
        </label>
        <input
          id="fullName"
          name="fullName"
          autoComplete="name"
          required
          disabled={disabled || pending}
          value={form.fullName}
          onChange={(event) => update("fullName")(event.target.value)}
          className="u-input"
          placeholder="Asha Verma"
        />
      </div>

      <div>
        <label htmlFor="email" className="u-label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          required
          disabled={disabled || pending}
          value={form.email}
          onChange={(event) => update("email")(event.target.value)}
          className="u-input"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label htmlFor="phone" className="u-label">
          Mobile number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          disabled={disabled || pending}
          value={form.phone}
          onChange={(event) => update("phone")(event.target.value)}
          className="u-input"
          placeholder="98765 43210"
        />
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-500 dark:text-paper-200/50">
          We send a 6-digit code here. Claiming stays locked until it is verified.
        </p>
      </div>

      <div>
        <label htmlFor="password" className="u-label">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            disabled={disabled || pending}
            value={form.password}
            onChange={(event) => update("password")(event.target.value)}
            className="u-input pr-16"
            placeholder="At least 8 characters"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg px-2.5 py-2 font-body text-[12px] font-semibold text-ink-500 transition hover:bg-paper-100 dark:text-paper-200/60 dark:hover:bg-white/5"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <p
          className={`mt-1.5 flex items-center gap-1.5 text-[12px] ${
            form.password.length === 0
              ? "text-ink-500 dark:text-paper-200/50"
              : passwordLongEnough
                ? "text-done-600"
                : "text-ink-500 dark:text-paper-200/50"
          }`}
        >
          {passwordLongEnough ? <IconCheck className="h-3.5 w-3.5" /> : null}
          {form.password.length === 0
            ? "At least 8 characters."
            : passwordLongEnough
              ? "Long enough."
              : `${8 - form.password.length} more character${
                  8 - form.password.length === 1 ? "" : "s"
                 } needed.`}
        </p>
      </div>

      <button
        type="submit"
        disabled={
          disabled || pending || form.fullName.length < 2 || !form.email || !form.phone || !passwordLongEnough
        }
        className="u-btn-primary w-full"
      >
        {pending ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            Creating account
          </>
        ) : (
          "Create account"
        )}
      </button>
    </form>
  );
}
