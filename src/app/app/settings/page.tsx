import type { Metadata } from "next";
import Link from "next/link";
import { requireUserOrRedirect, isPhoneVerified } from "@/lib/auth";
import { BankDetailsForm, type MaskedBankDetails } from "@/components/app/BankDetailsForm";
import { SocialProfilesForm } from "@/components/app/SocialProfilesForm";
import { UserSignOutButton } from "@/components/app/UserSignOutButton";
import { IconCheck, IconChevronRight } from "@/components/ui/icons";
import { maskPhone } from "@/lib/otp";
import { initials } from "@/lib/format";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your account" };

export default async function SettingsPage() {
  const session = await requireUserOrRedirect("/app/settings");
  const verified = isPhoneVerified(session.profile);

  // Only the safe projection is selected: the ciphertext column is revoked from
  // the authenticated role at column level, so it could not be read here even
  // if this query asked for it.
  const { data } = await session.supabase
    .from("bank_details")
    .select("account_holder_name, account_number_last4, ifsc_code, upi_id")
    .eq("user_id", session.userId)
    .maybeSingle();

  const bankDetails = (data as MaskedBankDetails | null) ?? null;

  return (
    <div>
      <header>
        <p className="u-data text-[11px] uppercase tracking-[0.18em] text-ink-500 dark:text-paper-200/50">
          Your account
        </p>
        <h1 className="mt-1 font-display text-[24px] font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          Settings
        </h1>
      </header>

      <div className="u-card mt-5 flex items-center gap-3.5 p-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink-900 font-body text-[13px] font-semibold text-paper-50 dark:bg-paper-100 dark:text-ink-900">
          {initials(session.profile.full_name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-semibold text-ink-900 dark:text-paper-50">
            {session.profile.full_name}
          </p>
          <p className="truncate font-body text-[13px] text-ink-500 dark:text-paper-200/60">
            {session.email}
          </p>
        </div>
      </div>

      <div className="u-card mt-3 divide-y divide-paper-300/60 dark:divide-white/10">
        <div className="flex items-center justify-between gap-3 px-4 py-3.5">
          <div>
            <p className="font-body text-[13px] font-semibold text-ink-800 dark:text-paper-100">
              Mobile number
            </p>
            <p className="u-data mt-0.5 text-[13px] text-ink-500 dark:text-paper-200/60">
              {maskPhone(session.profile.phone)}
            </p>
          </div>
          {verified ? (
            <span className="u-chip bg-done-50 text-done-700 ring-done-500/25 dark:bg-done-500/10 dark:text-done-500 dark:ring-done-500/25">
              <IconCheck className="h-3 w-3" />
              Verified
            </span>
          ) : (
            <Link href="/app/verify" className="u-btn-primary !px-3.5 !py-2 !text-[13px]">
              Verify
            </Link>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3.5">
          <div>
            <p className="font-body text-[13px] font-semibold text-ink-800 dark:text-paper-100">
              Payment history
            </p>
            <p className="mt-0.5 font-body text-[13px] text-ink-500 dark:text-paper-200/60">
              Every cashback that has been sent to you.
            </p>
          </div>
          <Link
            href="/app/payments"
            className="flex items-center gap-1 font-body text-[13px] font-semibold text-signal-600"
          >
            View
            <IconChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="mt-6">
        <h2 className="font-display text-[17px] font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          Social profiles
        </h2>
        <p className="mt-1 font-body text-[13px] leading-relaxed text-ink-500 dark:text-paper-200/60">
          Your Instagram and YouTube handles so admins can verify your profile.
        </p>
        <div className="mt-4">
          <SocialProfilesForm
            initialInstagram={session.profile.instagram_username}
            initialYoutube={session.profile.youtube_username}
          />
        </div>
      </div>

      <div className="mt-6">
        <h2 className="font-display text-[17px] font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          Payout details
        </h2>
        <p className="mt-1 font-body text-[13px] leading-relaxed text-ink-500 dark:text-paper-200/60">
          Where your cashback is sent. Changes are recorded against your account and visible to the
          payment operator only.
        </p>
        <div className="mt-4">
          <BankDetailsForm initial={bankDetails} />
        </div>
      </div>

      <div className="mt-8 border-t border-paper-300/70 pt-5 dark:border-white/10">
        <UserSignOutButton />
      </div>
    </div>
  );
}
