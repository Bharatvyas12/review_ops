import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/app/AuthFrame";
import { RegisterForm } from "@/components/app/RegisterForm";
import { getSessionUser } from "@/lib/auth";
import { SETUP_HINT, isSupabaseConfigured } from "@/lib/env/public";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage() {
  const session = await getSessionUser();
  if (session?.profile) redirect("/app");

  return (
    <AuthFrame
      title="Create your account"
      subtitle="A phone number we can verify, and a payout account for your cashback."
      footer={
        <>
          Already registered?{" "}
          <Link
            href="/app/login"
            className="font-semibold text-signal-600 underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      {!isSupabaseConfigured ? (
        <p className="mb-5 rounded-xl border border-signal-500/25 bg-signal-50 p-3.5 text-[13px] leading-relaxed text-signal-700">
          <span className="font-semibold">Supabase is not configured.</span> {SETUP_HINT}
        </p>
      ) : null}

      <RegisterForm disabled={!isSupabaseConfigured} />
    </AuthFrame>
  );
}
