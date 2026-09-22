"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import { IconSignOut } from "@/components/ui/icons";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await apiRequest<{ redirectTo: string }>("/api/auth/logout");
    } catch {
      // Even if the call fails, send the user to the login screen.
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="btn-ghost btn-sm"
      title="Sign out"
    >
      <IconSignOut className="h-4 w-4" />
      <span className="hidden sm:inline">{pending ? "Signing out" : "Sign out"}</span>
    </button>
  );
}
