"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { IconSearch } from "@/components/ui/icons";
import { apiRequest } from "@/lib/api-client";
import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import { formatDate } from "@/lib/format";
import type { BrandRow, CampaignWithBrand } from "@/lib/types";

export type CampaignListItem = {
  id: string;
  brandId: string;
  brandSeq: number | null;
  brandName: string;
  campaignNumber: number;
  createdAt: string;
};

export type BrandOption = {
  id: string;
  brandSeq: number;
  name: string;
};

function brandDisplayId(seq: number | null): string {
  if (seq === null || seq === undefined) return "—";
  return `BR-${String(seq).padStart(3, "0")}`;
}

export function CampaignsPanel({
  campaigns,
  brands,
}: {
  campaigns: CampaignListItem[];
  brands: BrandOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  useRealtimeRefresh("campaigns");

  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CampaignListItem | null>(null);

  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [selectedCampaignNumber, setSelectedCampaignNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Determine existing campaign numbers for the currently selected brand
  const usedCampaignNumbers = useMemo(() => {
    if (!selectedBrandId) return new Set<number>();
    const numbers = campaigns
      .filter((c) => c.brandId === selectedBrandId)
      .map((c) => c.campaignNumber);
    return new Set(numbers);
  }, [campaigns, selectedBrandId]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return campaigns;
    return campaigns.filter((campaign) =>
      [
        brandDisplayId(campaign.brandSeq),
        campaign.brandName,
        `campaign ${campaign.campaignNumber}`,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [campaigns, query]);

  function openCreate() {
    setSelectedBrandId(brands[0]?.id ?? "");
    setSelectedCampaignNumber("");
    setCreating(true);
  }

  function closeForm() {
    setCreating(false);
    setSelectedBrandId("");
    setSelectedCampaignNumber("");
  }

  async function save() {
    if (!selectedBrandId || !selectedCampaignNumber) return;

    const payload = {
      brandId: selectedBrandId,
      campaignNumber: Number(selectedCampaignNumber),
    };

    setSaving(true);
    try {
      await apiRequest("/api/admin/campaigns", { body: payload });
      toast.success("Campaign created", `Campaign ${payload.campaignNumber} added for brand.`);
      closeForm();
      router.refresh();
    } catch (error) {
      toast.failure(
        "Could not create campaign",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteCampaign() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/admin/campaigns/${confirmDelete.id}`, { method: "DELETE" });
      toast.success(
        "Campaign deleted",
        `Campaign ${confirmDelete.campaignNumber} for ${confirmDelete.brandName} was removed.`,
      );
      setConfirmDelete(null);
      router.refresh();
    } catch (error) {
      toast.failure(
        "Could not delete campaign",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setDeleting(false);
    }
  }

  const formValid =
    selectedBrandId.length > 0 &&
    Number(selectedCampaignNumber) >= 1 &&
    Number(selectedCampaignNumber) <= 10 &&
    !usedCampaignNumbers.has(Number(selectedCampaignNumber));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search campaigns"
            className="input pl-9"
            aria-label="Search campaigns"
          />
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={brands.length === 0}
          className="btn-primary"
        >
          Add campaign
        </button>
      </div>

      <div className="card mt-4 overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            title={campaigns.length === 0 ? "No campaigns yet" : "No campaigns match that search"}
            description={
              campaigns.length === 0
                ? brands.length === 0
                  ? "Create a brand first before adding campaigns."
                  : "Add the first campaign for a brand."
                : "Try searching for a different brand name or campaign number."
            }
            icon="📢"
            action={
              campaigns.length === 0 && brands.length > 0 ? (
                <button type="button" onClick={openCreate} className="btn-primary btn-sm">
                  Add campaign
                </button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-left">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-3 font-semibold">Brand ID</th>
                  <th className="px-4 py-3 font-semibold">Brand Name</th>
                  <th className="px-4 py-3 font-semibold">Campaign</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filtered.map((campaign) => (
                  <tr
                    key={campaign.id}
                    className="transition hover:bg-slate-50/70 dark:hover:bg-white/5"
                  >
                    <td className="table-cell font-mono text-xs text-slate-500 dark:text-slate-400">
                      {brandDisplayId(campaign.brandSeq)}
                    </td>
                    <td className="table-cell">
                      <p className="truncate font-medium text-slate-900 dark:text-white">
                        {campaign.brandName}
                      </p>
                    </td>
                    <td className="table-cell font-medium text-slate-900 dark:text-white">
                      Campaign {campaign.campaignNumber}
                    </td>
                    <td className="table-cell text-slate-500 dark:text-slate-400">
                      {formatDate(campaign.createdAt)}
                    </td>
                    <td className="table-cell">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(campaign)}
                          className="btn-ghost btn-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add campaign modal ───────────────────────────────────────────── */}
      <Modal
        open={creating}
        onClose={closeForm}
        title="Add campaign"
        description="Select a brand and an available campaign number (1-10)."
        footer={
          <>
            <button type="button" onClick={closeForm} className="btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              disabled={!formValid || saving}
              onClick={() => void save()}
              className="btn-primary"
            >
              {saving ? "Saving" : "Create campaign"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="campaign-brand" className="label">
              Select Brand <span className="text-red-500">*</span>
            </label>
            <select
              id="campaign-brand"
              value={selectedBrandId}
              onChange={(e) => {
                setSelectedBrandId(e.target.value);
                setSelectedCampaignNumber("");
              }}
              className="input"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({brandDisplayId(b.brandSeq)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="campaign-number" className="label">
              Select Campaign <span className="text-red-500">*</span>
            </label>
            <select
              id="campaign-number"
              value={selectedCampaignNumber}
              onChange={(e) => setSelectedCampaignNumber(e.target.value)}
              className="input"
            >
              <option value="">Select a campaign number...</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => {
                const isUsed = usedCampaignNumbers.has(num);
                return (
                  <option key={num} value={num} disabled={isUsed}>
                    Campaign {num} {isUsed ? "(Already added)" : ""}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </Modal>

      {/* ── Delete confirmation modal ─────────────────────────────────────── */}
      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete campaign"
        description="This action is permanent and cannot be undone."
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => void deleteCampaign()}
              className="btn-danger"
            >
              {deleting ? "Deleting…" : "Delete campaign"}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          You are about to permanently delete{" "}
          <strong className="font-semibold text-slate-900 dark:text-white">
            Campaign {confirmDelete?.campaignNumber}
          </strong>{" "}
          for{" "}
          <strong className="font-semibold text-slate-900 dark:text-white">
            {confirmDelete?.brandName}
          </strong>
          .
        </p>
      </Modal>
    </>
  );
}
