"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, apiRequest } from "@/lib/api-client";

/**
 * Reviewer sign in.
 *
 * The failure message is deliberately identical for an unknown address and a
 * wrong password, so the form cannot be used to enumerate accounts. The same
 * rule is enforced again on the server.
 */
export function UserLoginForm({
  disabled = false,
  nextPath,
}: {
  disabled?: boolean;
  nextPath?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const result = await apiRequest<{ redirectTo: string }>("/api/user/auth/login", {
        body: { email, password },
      });
      setPassword("");
      // An explicit ?next= wins, but never for an account that still has to
      // finish verification or belongs in the admin console.
      const target =
        nextPath && result.redirectTo === "/app" && nextPath.startsWith("/app/")
          ? nextPath
          : result.redirectTo;
      router.replace(target);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Something went wrong. Please try again.",
      );
      setPassword("");
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
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="u-input"
          placeholder="you@example.com"
        />
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
            autoComplete="current-password"
            required
            disabled={disabled || pending}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="u-input pr-16"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg px-2.5 py-2 font-body text-[12px] font-semibold text-ink-500 transition hover:bg-paper-100 dark:text-paper-200/60 dark:hover:bg-white/5"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={disabled || pending || email.length === 0 || password.length === 0}
        className="u-btn-primary w-full"
      >
        {pending ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            Signing in
          </>
        ) : (
          "Sign in"
        )}
      </button>
    </form>
  );
}
