import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/app/AuthFrame";
import { OtpForm } from "@/components/app/OtpForm";
import { UserSignOutButton } from "@/components/app/UserSignOutButton";
import { requireUserOrRedirect, isPhoneVerified, OTP_VERIFICATION_REQUIRED } from "@/lib/auth";
import { maskPhone } from "@/lib/otp";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Verify your phone" };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ delivery?: string }>;
}) {
  const session = await requireUserOrRedirect("/app/verify");
  const params = await searchParams;

  // TEMPORARY: OTP verification is disabled, so this page is unreachable.
  // Keep the route (re-enable by flipping OTP_VERIFICATION_REQUIRED) but send
  // everyone straight into the app.
  if (!OTP_VERIFICATION_REQUIRED) redirect("/app");
  if (isPhoneVerified(session.profile)) redirect("/app");

  return (
    <AuthFrame
      title="Verify your mobile number"
      subtitle="One code unlocks claiming products and submitting proof."
      footer={<UserSignOutButton className="mx-auto" />}
    >
      <OtpForm
        maskedPhone={maskPhone(session.profile.phone)}
        devConsoleHint={params.delivery === "console"}
      />
    </AuthFrame>
  );
}
