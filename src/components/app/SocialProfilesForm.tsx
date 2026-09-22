"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";

export function SocialProfilesForm({
  initialInstagram,
  initialYoutube,
}: {
  initialInstagram?: string | null;
  initialYoutube?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [instagram, setInstagram] = useState(initialInstagram ?? "");
  const [youtube, setYoutube] = useState(initialYoutube ?? "");
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest("/api/user/social", {
        body: {
          instagramUsername: instagram,
          youtubeUsername: youtube,
        },
      });
      toast.success("Social handles updated", "Your social profiles have been saved.");
      router.refresh();
    } catch (error) {
      toast.failure(
        "Could not save social profiles",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="u-card p-4 space-y-4">
      <div>
        <label htmlFor="instagram-username" className="block text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-paper-200/60">
          Instagram Username
        </label>
        <input
          id="instagram-username"
          type="text"
          value={instagram}
          onChange={(e) => setInstagram(e.target.value)}
          placeholder="yourhandle"
          className="u-input mt-1.5"
        />
        <p className="mt-1 text-[11px] text-ink-400 dark:text-paper-200/40">
          Enter just your handle (e.g. <code>john_doe</code>, no <code>@</code> or link).
        </p>
      </div>

      <div>
        <label htmlFor="youtube-username" className="block text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-paper-200/60">
          YouTube Username / Channel
        </label>
        <input
          id="youtube-username"
          type="text"
          value={youtube}
          onChange={(e) => setYoutube(e.target.value)}
          placeholder="yourchannel"
          className="u-input mt-1.5"
        />
        <p className="mt-1 text-[11px] text-ink-400 dark:text-paper-200/40">
          Enter your handle or channel name without <code>@</code>.
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <button type="submit" disabled={saving} className="u-btn-primary">
          {saving ? "Saving..." : "Save Social Profiles"}
        </button>
      </div>
    </form>
  );
}
