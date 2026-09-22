"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import { IconSignOut } from "@/components/ui/icons";

/** Signs out through the shared endpoint, then returns to the user sign-in. */
export function UserSignOutButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await apiRequest<{ redirectTo: string }>("/api/auth/logout");
    } catch {
      // The cookie is cleared server-side even if the call reports a failure, so
      // always move the user away from a signed-in screen.
    }
    router.replace("/app/login");
    router.refresh();
  }

  return (
    <button type="button" onClick={signOut} disabled={pending} className={`u-btn-ghost ${className}`}>
      <IconSignOut className="h-4 w-4" />
      {pending ? "Signing out" : "Sign out"}
    </button>
  );
}
