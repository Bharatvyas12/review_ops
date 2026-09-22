import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/app/AuthFrame";
import { UserLoginForm } from "@/components/app/UserLoginForm";
import { getSessionUser } from "@/lib/auth";
import { SETUP_HINT, isSupabaseConfigured } from "@/lib/env/public";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in" };

export default async function UserLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; setup?: string }>;
}) {
  const params = await searchParams;
  const session = await getSessionUser();

  // Middleware already turns signed-in visitors away; repeating it here means
  // the page is safe on its own too.
  if (session?.profile) redirect("/app");

  const nextPath =
    params.next && params.next.startsWith("/app/") ? params.next : undefined;

  return (
    <AuthFrame
      title="Sign in"
      subtitle="Track your orders, submit proof and get paid."
      footer={
        <>
          New here?{" "}
          <Link
            href="/app/register"
            className="font-semibold text-signal-600 underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      {!isSupabaseConfigured ? (
        <p className="mb-5 rounded-xl border border-signal-500/25 bg-signal-50 p-3.5 text-[13px] leading-relaxed text-signal-700">
          <span className="font-semibold">Supabase is not configured.</span> {SETUP_HINT}
        </p>
      ) : null}

      <UserLoginForm disabled={!isSupabaseConfigured} nextPath={nextPath} />
    </AuthFrame>
  );
}
