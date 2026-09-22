"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProductStatusBadge } from "@/components/ui/StatusBadge";
import { ImageDropzone, type UploadResult } from "@/components/admin/ImageDropzone";
import { useToast } from "@/components/ui/Toast";
import { IconExternal, IconSearch } from "@/components/ui/icons";
import { apiRequest } from "@/lib/api-client";
import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import { formatCurrency, formatDate, productSlotLabel } from "@/lib/format";
import type { ProductStatus } from "@/lib/types";

export type ProductListItem = {
  id: string;
  name: string;
  brand: string | null;
  brandId: string | null;
  brandName: string | null;
  description: string | null;
  imageUrl: string | null;
  signedImageUrl: string | null;
  totalSlots: number;
  slotsFilled: number;
  releasedSlots: number;
  dailyReleaseLimit: number | null;
  cashbackAmount: number | null;
  status: ProductStatus;
  createdAt: string;
  productLink: string | null;
  campaign: string | null;
  campaignId: string | null;
  campaignLabel: string | null;
  asinCode: string | null;
};

type FormState = {
  name: string;
  description: string;
  imageUrl: string;
  totalSlots: string;
  dailyReleaseLimit: string;
  cashbackAmount: string;
  productLink: string;
  asinCode: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  imageUrl: "",
  totalSlots: "10",
  dailyReleaseLimit: "",
  cashbackAmount: "",
  productLink: "",
  asinCode: "",
};

type BulkFormRow = {
  id: string;
  name: string;
  brandId: string;
  campaignId: string;
  totalSlots: string;
  dailyReleaseLimit: string;
  cashbackAmount: string;
  productLink: string;
  asinCode: string;
  description: string;
  imageUrl: string;
  uploadPreview: string | null;
  errors?: {
    name?: string;
    totalSlots?: string;
  };
};

function createDefaultBulkRow(defaultBrandId = ""): BulkFormRow {
  return {
    id: Math.random().toString(36).substring(2, 9),
    name: "",
    brandId: defaultBrandId,
    campaignId: "",
    totalSlots: "10",
    dailyReleaseLimit: "",
    cashbackAmount: "",
    productLink: "",
    asinCode: "",
    description: "",
    imageUrl: "",
    uploadPreview: null,
  };
}

export type ProductBrandOption = {
  id: string;
  brandSeq: number;
  name: string;
};

export type ProductCampaignOption = {
  id: string;
  brandId: string;
  campaignNumber: number;
};

function brandDisplayId(seq: number): string {
  return `BR-${String(seq).padStart(3, "0")}`;
}

export function ProductsPanel({
  products,
  brands = [],
  campaigns = [],
}: {
  products: ProductListItem[];
  brands?: ProductBrandOption[];
  campaigns?: ProductCampaignOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  useRealtimeRefresh("products");

  const [query, setQuery] = useState("");
  const [filterBrandId, setFilterBrandId] = useState("");
  const [filterCampaignId, setFilterCampaignId] = useState("");

  const [editing, setEditing] = useState<ProductListItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmClose, setConfirmClose] = useState<ProductListItem | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Bulk creation state
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkFormRow[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);

  // Filter campaigns list based on selected filter brand
  const filterAvailableCampaigns = useMemo(() => {
    if (!filterBrandId) return campaigns;
    return campaigns.filter((c) => c.brandId === filterBrandId);
  }, [campaigns, filterBrandId]);

  // Form: campaigns available for currently selected single form brand
  const formAvailableCampaigns = useMemo(() => {
    if (!selectedBrandId) return [];
    return campaigns.filter((c) => c.brandId === selectedBrandId);
  }, [campaigns, selectedBrandId]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();

    return products.filter((product) => {
      // Search term filter
      if (term) {
        const matches = [
          product.name,
          product.brandName ?? product.brand ?? "",
          product.campaignLabel ?? product.campaign ?? "",
          product.status,
        ]
          .join(" ")
          .toLowerCase()
          .includes(term);
        if (!matches) return false;
      }

      // Brand filter
      if (filterBrandId) {
        if (product.brandId) {
          if (product.brandId !== filterBrandId) return false;
        } else {
          // Fallback match for legacy product by brand name
          const targetBrand = brands.find((b) => b.id === filterBrandId);
          if (
            targetBrand &&
            product.brand?.toLowerCase() !== targetBrand.name.toLowerCase()
          ) {
            return false;
          }
        }
      }

      // Campaign filter
      if (filterCampaignId) {
        if (product.campaignId) {
          if (product.campaignId !== filterCampaignId) return false;
        } else {
          // Fallback match for legacy product
          const targetCamp = campaigns.find((c) => c.id === filterCampaignId);
          if (targetCamp) {
            const expectedLabel = `Campaign ${targetCamp.campaignNumber}`;
            if (product.campaign !== expectedLabel) return false;
          }
        }
      }

      return true;
    });
  }, [products, query, filterBrandId, filterCampaignId, brands, campaigns]);

  const hasActiveFilters = Boolean(query || filterBrandId || filterCampaignId);

  function clearFilters() {
    setQuery("");
    setFilterBrandId("");
    setFilterCampaignId("");
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setSelectedBrandId(brands[0]?.id ?? "");
    setSelectedCampaignId("");
    setUploadPreview(null);
    setCreating(true);
  }

  function openEdit(product: ProductListItem) {
    setForm({
      name: product.name,
      description: product.description ?? "",
      imageUrl: product.imageUrl ?? "",
      totalSlots: String(product.totalSlots),
      dailyReleaseLimit:
        product.dailyReleaseLimit === null ? "" : String(product.dailyReleaseLimit),
      cashbackAmount: product.cashbackAmount === null ? "" : String(product.cashbackAmount),
      productLink: product.productLink ?? "",
      asinCode: product.asinCode ?? "",
    });

    // Try to match brandId
    let bId = product.brandId ?? "";
    if (!bId && product.brand) {
      const match = brands.find((b) => b.name.toLowerCase() === product.brand?.toLowerCase());
      if (match) bId = match.id;
    }
    setSelectedBrandId(bId);

    // Try to match campaignId
    let cId = product.campaignId ?? "";
    if (!cId && product.campaign && bId) {
      const matchCamp = campaigns.find(
        (c) => c.brandId === bId && `Campaign ${c.campaignNumber}` === product.campaign,
      );
      if (matchCamp) cId = matchCamp.id;
    }
    setSelectedCampaignId(cId);

    setUploadPreview(product.signedImageUrl);
    setEditing(product);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    setUploadPreview(null);
    setSelectedBrandId("");
    setSelectedCampaignId("");
  }

  function onUploaded(result: UploadResult) {
    setForm((current) => ({ ...current, imageUrl: result.path }));
    setUploadPreview(result.signedUrl);
  }

  async function save() {
    const selectedBrand = brands.find((b) => b.id === selectedBrandId);
    const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);

    const payload = {
      name: form.name.trim(),
      brand: selectedBrand?.name ?? null,
      brandId: selectedBrandId || null,
      description: form.description.trim() || null,
      imageUrl: form.imageUrl || null,
      totalSlots: form.totalSlots,
      dailyReleaseLimit:
        form.dailyReleaseLimit.trim() === "" ? (editing ? 0 : null) : form.dailyReleaseLimit,
      cashbackAmount: form.cashbackAmount.trim() === "" ? null : form.cashbackAmount,
      productLink: form.productLink.trim() || null,
      campaign: selectedCampaign ? `Campaign ${selectedCampaign.campaignNumber}` : null,
      campaignId: selectedCampaignId || null,
      asinCode: form.asinCode.trim() || null,
    };

    setSaving(true);
    try {
      if (editing) {
        await apiRequest(`/api/admin/products/${editing.id}`, {
          method: "PATCH",
          body: payload,
        });
        toast.success("Product updated", `${payload.name} was saved and logged.`);
      } else {
        await apiRequest("/api/admin/products", { body: payload });
        toast.success("Product created", `${payload.name} is now open for claiming.`);
      }
      closeForm();
      router.refresh();
    } catch (error) {
      toast.failure(
        "Could not save the product",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(product: ProductListItem) {
    const nextStatus: ProductStatus = product.status === "open" ? "closed" : "open";
    setSaving(true);
    try {
      await apiRequest(`/api/admin/products/${product.id}`, {
        method: "PATCH",
        body: { status: nextStatus },
      });
      toast.success(
        nextStatus === "closed" ? "Product closed" : "Product reopened",
        `${product.name} is now ${nextStatus}.`,
      );
      setConfirmClose(null);
      router.refresh();
    } catch (error) {
      toast.failure(
        "Could not change the status",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setSaving(false);
    }
  }

  // --- Bulk Creation Logic ---
  function openBulkCreate() {
    setBulkRows([createDefaultBulkRow(brands[0]?.id ?? "")]);
    setBulkCreating(true);
  }

  function closeBulkModal() {
    setBulkCreating(false);
    setBulkRows([]);
  }

  function addBulkRow() {
    setBulkRows((prev) => [...prev, createDefaultBulkRow(brands[0]?.id ?? "")]);
  }

  function removeBulkRow(index: number) {
    if (bulkRows.length <= 1) return;
    setBulkRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateBulkRow(index: number, updates: Partial<BulkFormRow>) {
    setBulkRows((prev) => {
      const next = [...prev];
      const target = { ...next[index], ...updates };

      // If brandId changed, reset campaignId for this row
      if (updates.brandId !== undefined && updates.brandId !== next[index].brandId) {
        target.campaignId = "";
      }

      // Clear errors on field edits if now valid
      if (target.errors) {
        const newErrors = { ...target.errors };
        if (updates.name !== undefined && updates.name.trim()) delete newErrors.name;
        if (updates.totalSlots !== undefined && Number(updates.totalSlots) >= 1) delete newErrors.totalSlots;
        target.errors = Object.keys(newErrors).length > 0 ? newErrors : undefined;
      }

      next[index] = target;
      return next;
    });
  }

  function handleBulkUploaded(index: number, result: UploadResult) {
    updateBulkRow(index, {
      imageUrl: result.path,
      uploadPreview: result.signedUrl,
    });
  }

  async function saveBulk() {
    let hasErrors = false;
    const validatedRows = bulkRows.map((row) => {
      const errors: { name?: string; totalSlots?: string } = {};
      if (!row.name.trim()) {
        errors.name = "Name is required";
        hasErrors = true;
      }
      if (!row.totalSlots || Number(row.totalSlots) < 1) {
        errors.totalSlots = "Min 1 slot";
        hasErrors = true;
      }
      return { ...row, errors: Object.keys(errors).length > 0 ? errors : undefined };
    });

    if (hasErrors) {
      setBulkRows(validatedRows);
      toast.failure("Validation failed", "Please fill in all required fields marked in red.");
      return;
    }

    setBulkSaving(true);
    let successCount = 0;
    const failures: string[] = [];

    for (let i = 0; i < bulkRows.length; i++) {
      const row = bulkRows[i];
      const selectedBrand = brands.find((b) => b.id === row.brandId);
      const selectedCampaign = campaigns.find((c) => c.id === row.campaignId);

      const payload = {
        name: row.name.trim(),
        brand: selectedBrand?.name ?? null,
        brandId: row.brandId || null,
        description: row.description.trim() || null,
        imageUrl: row.imageUrl || null,
        totalSlots: row.totalSlots,
        dailyReleaseLimit: row.dailyReleaseLimit.trim() === "" ? null : row.dailyReleaseLimit,
        cashbackAmount: row.cashbackAmount.trim() === "" ? null : row.cashbackAmount,
        productLink: row.productLink.trim() || null,
        campaign: selectedCampaign ? `Campaign ${selectedCampaign.campaignNumber}` : null,
        campaignId: row.campaignId || null,
        asinCode: row.asinCode.trim() || null,
      };

      try {
        await apiRequest("/api/admin/products", { body: payload });
        successCount++;
      } catch (error) {
        failures.push(
          `Row ${i + 1} (${row.name || "Unnamed"}): ${error instanceof Error ? error.message : "Failed"}`,
        );
      }
    }

    setBulkSaving(false);

    if (failures.length === 0) {
      toast.success("Bulk products created", `Successfully created all ${successCount} products.`);
      closeBulkModal();
      router.refresh();
    } else if (successCount > 0) {
      toast.toast(
        "Bulk creation finished with issues",
        { tone: "info", description: `Created ${successCount} of ${bulkRows.length} products. Failures: ${failures.join("; ")}` },
      );
      closeBulkModal();
      router.refresh();
    } else {
      toast.failure("Failed to create products", failures.join("; "));
    }
  }

  const formValid =
    form.name.trim().length > 0 &&
    Number(form.totalSlots) >= 1 &&
    (form.dailyReleaseLimit.trim() === "" || Number(form.dailyReleaseLimit) >= 1);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search products..."
              className="input pl-9"
              aria-label="Search products"
            />
          </div>

          {/* Filter by brand */}
          <select
            value={filterBrandId}
            onChange={(e) => {
              setFilterBrandId(e.target.value);
              setFilterCampaignId("");
            }}
            className="input w-auto min-w-[10rem]"
            aria-label="Filter by brand"
          >
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({brandDisplayId(b.brandSeq)})
              </option>
            ))}
          </select>

          {/* Filter by campaign */}
          <select
            value={filterCampaignId}
            onChange={(e) => setFilterCampaignId(e.target.value)}
            className="input w-auto min-w-[10rem]"
            aria-label="Filter by campaign"
          >
            <option value="">All campaigns</option>
            {filterAvailableCampaigns.map((c) => {
              const b = brands.find((brand) => brand.id === c.brandId);
              const label = b ? `${b.name} — Campaign ${c.campaignNumber}` : `Campaign ${c.campaignNumber}`;
              return (
                <option key={c.id} value={c.id}>
                  {label}
                </option>
              );
            })}
          </select>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="btn-ghost btn-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={openCreate} className="btn-primary">
            Add Single Product
          </button>
          <button type="button" onClick={openBulkCreate} className="btn-secondary">
            Add Bulk Products
          </button>
        </div>
      </div>

      <div className="card mt-4 overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            title={products.length === 0 ? "No products yet" : "No products match that search/filter"}
            description={
              products.length === 0
                ? "Create the first product to start collecting claims."
                : "Try adjusting your search or clearing brand/campaign filters."
            }
            icon="□"
            action={
              products.length === 0 ? (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={openCreate} className="btn-primary btn-sm">
                    Add Single Product
                  </button>
                  <button type="button" onClick={openBulkCreate} className="btn-secondary btn-sm">
                    Add Bulk Products
                  </button>
                </div>
              ) : hasActiveFilters ? (
                <button type="button" onClick={clearFilters} className="btn-secondary btn-sm">
                  Clear filters
                </button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] border-collapse text-left">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-3 font-semibold">Product</th>
                  <th className="px-4 py-3 font-semibold">Campaign</th>
                  <th className="px-4 py-3 font-semibold">ASIN</th>
                  <th className="px-4 py-3 font-semibold">Link</th>
                  <th className="px-4 py-3 font-semibold">Slots</th>
                  <th className="px-4 py-3 font-semibold">Cashback</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filtered.map((product) => {
                  const releasedRatio =
                    product.releasedSlots > 0
                      ? Math.min(100, Math.round((product.slotsFilled / product.releasedSlots) * 100))
                      : 0;
                  const displayBrand = product.brandName ?? product.brand ?? "—";
                  const displayCampaign = product.campaignLabel ?? product.campaign ?? "—";

                  return (
                    <tr key={product.id} className="transition hover:bg-slate-50/70 dark:hover:bg-white/5">
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          {product.signedImageUrl ? (
                            <img
                              src={product.signedImageUrl}
                              alt=""
                              className="h-10 w-10 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-white/10"
                            />
                          ) : (
                            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400 dark:bg-slate-800">
                              n/a
                            </span>
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900 dark:text-white">
                              {product.name}
                            </p>
                            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                              {displayBrand}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="table-cell text-slate-600 dark:text-slate-300">
                        {displayCampaign}
                      </td>
                      <td className="table-cell font-mono text-xs text-slate-600 dark:text-slate-300">
                        {product.asinCode ?? "—"}
                      </td>
                      <td className="table-cell">
                        {product.productLink ? (
                          <a
                            href={product.productLink}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                          >
                            Open
                            <IconExternal className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      <td className="table-cell">
                        <p className="font-medium text-slate-900 dark:text-white">
                          {productSlotLabel({
                            slots_filled: product.slotsFilled,
                            released_slots: product.releasedSlots,
                          })}
                          {product.releasedSlots < product.totalSlots ? (
                            <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">
                              of {product.totalSlots} total
                            </span>
                          ) : null}
                        </p>
                        <div className="mt-1.5 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-full rounded-full bg-brand-500"
                            style={{ width: `${releasedRatio}%` }}
                          />
                        </div>
                        {product.dailyReleaseLimit ? (
                          <p className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            +{product.dailyReleaseLimit}/day
                          </p>
                        ) : null}
                      </td>
                      <td className="table-cell">{formatCurrency(product.cashbackAmount)}</td>
                      <td className="table-cell">
                        <ProductStatusBadge status={product.status} />
                      </td>
                      <td className="table-cell text-slate-500 dark:text-slate-400">
                        {formatDate(product.createdAt)}
                      </td>
                      <td className="table-cell">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(product)}
                            className="btn-secondary btn-sm"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmClose(product)}
                            className="btn-ghost btn-sm"
                          >
                            {product.status === "open" ? "Close" : "Reopen"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* --- Single Product Modal --- */}
      <Modal
        open={creating || editing !== null}
        onClose={closeForm}
        title={editing ? "Edit product" : "Add Single Product"}
        description="Every change is written to the audit log with your admin id."
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
              {saving ? "Saving" : editing ? "Save changes" : "Create product"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="product-name" className="label">
              Name
            </label>
            <input
              id="product-name"
              value={form.name}
              maxLength={200}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="input"
              placeholder="Boat Airdopes 141"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="product-brand" className="label">
                Brand
              </label>
              {brands.length > 0 ? (
                <select
                  id="product-brand"
                  value={selectedBrandId}
                  onChange={(event) => {
                    const newBrandId = event.target.value;
                    setSelectedBrandId(newBrandId);
                    setSelectedCampaignId("");
                  }}
                  className="input"
                >
                  <option value="">Select a brand...</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({brandDisplayId(b.brandSeq)})
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No brands created yet. Create a brand first.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="product-slots" className="label">
                Total slots
              </label>
              <input
                id="product-slots"
                type="number"
                min={1}
                max={100000}
                value={form.totalSlots}
                onChange={(event) => setForm({ ...form, totalSlots: event.target.value })}
                className="input"
              />
            </div>
          </div>

          <div>
            <label htmlFor="product-daily-release" className="label">
              Daily slot release limit
            </label>
            <input
              id="product-daily-release"
              type="number"
              min={1}
              max={100000}
              value={form.dailyReleaseLimit}
              onChange={(event) => setForm({ ...form, dailyReleaseLimit: event.target.value })}
              className="input"
              placeholder="5"
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              Optional. Opens this many slots every day at midnight IST so a large batch is
              released gradually. Leave it blank and all {form.totalSlots || ""} slots are
              claimable straight away. Slots that are already open are never taken back, so
              yesterday&apos;s unclaimed slots carry into today.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="product-campaign" className="label">
                Campaign
              </label>
              <select
                id="product-campaign"
                value={selectedCampaignId}
                disabled={!selectedBrandId || formAvailableCampaigns.length === 0}
                onChange={(event) => setSelectedCampaignId(event.target.value)}
                className="input"
              >
                <option value="">
                  {!selectedBrandId
                    ? "Select a brand first..."
                    : formAvailableCampaigns.length === 0
                      ? "No campaigns for this brand"
                      : "Select a campaign..."}
                </option>
                {formAvailableCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    Campaign {c.campaignNumber}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="product-asin" className="label">
                ASIN code
              </label>
              <input
                id="product-asin"
                value={form.asinCode}
                onChange={(event) => setForm({ ...form, asinCode: event.target.value })}
                className="input font-mono"
                placeholder="B09N3ZNHTY"
              />
            </div>
          </div>

          <div>
            <label htmlFor="product-link" className="label">
              Product link
            </label>
            <input
              id="product-link"
              type="url"
              inputMode="url"
              value={form.productLink}
              maxLength={1024}
              onChange={(event) => setForm({ ...form, productLink: event.target.value })}
              className="input"
              placeholder="https://www.amazon.in/dp/B09N3ZNHTY"
            />
          </div>

          <div>
            <label htmlFor="product-cashback" className="label">
              Cashback amount (₹)
            </label>
            <input
              id="product-cashback"
              type="number"
              min={0}
              step="0.01"
              value={form.cashbackAmount}
              onChange={(event) => setForm({ ...form, cashbackAmount: event.target.value })}
              className="input"
              placeholder="250"
            />
          </div>

          <div>
            <label htmlFor="product-description" className="label">
              Description
            </label>
            <textarea
              id="product-description"
              rows={3}
              maxLength={4000}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              className="input resize-none"
              placeholder="What the reviewer needs to buy and review."
            />
          </div>

          <div>
            <span className="label">Product image</span>
            <ImageDropzone
              purpose="product-image"
              previewUrl={uploadPreview}
              onUploaded={onUploaded}
            />
          </div>
        </div>
      </Modal>

      {/* --- Bulk Products Modal --- */}
      <Modal
        open={bulkCreating}
        onClose={closeBulkModal}
        title="Add Bulk Products"
        description="Add multiple products at once. Complete the product details below and submit."
        size="lg"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={addBulkRow}
              className="btn-secondary btn-sm"
              disabled={bulkSaving}
            >
              + Add More Product
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={closeBulkModal}
                className="btn-secondary"
                disabled={bulkSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bulkSaving}
                onClick={() => void saveBulk()}
                className="btn-primary"
              >
                {bulkSaving
                  ? "Creating products..."
                  : `Create ${bulkRows.length} Product${bulkRows.length > 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-6">
          {bulkRows.map((row, index) => {
            const rowAvailableCampaigns = row.brandId
              ? campaigns.filter((c) => c.brandId === row.brandId)
              : [];

            return (
              <div
                key={row.id}
                className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 transition-all dark:border-white/10 dark:bg-slate-800/40"
              >
                <div className="mb-3 flex items-center justify-between border-b border-slate-200/80 pb-2 dark:border-white/10">
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Product #{index + 1}
                  </span>
                  {bulkRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeBulkRow(index)}
                      className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline dark:text-red-400"
                    >
                      - Remove Row
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  {/* Row 1: Name, Brand, Campaign */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="label">
                        Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        value={row.name}
                        onChange={(e) => updateBulkRow(index, { name: e.target.value })}
                        className={`input ${row.errors?.name ? "border-red-500 ring-1 ring-red-500" : ""}`}
                        placeholder="Product Name"
                      />
                      {row.errors?.name && (
                        <p className="mt-1 text-xs text-red-500">{row.errors.name}</p>
                      )}
                    </div>
                    <div>
                      <label className="label">Brand</label>
                      <select
                        value={row.brandId}
                        onChange={(e) => updateBulkRow(index, { brandId: e.target.value })}
                        className="input"
                      >
                        <option value="">Select Brand...</option>
                        {brands.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({brandDisplayId(b.brandSeq)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Campaign</label>
                      <select
                        value={row.campaignId}
                        disabled={!row.brandId || rowAvailableCampaigns.length === 0}
                        onChange={(e) => updateBulkRow(index, { campaignId: e.target.value })}
                        className="input"
                      >
                        <option value="">
                          {!row.brandId
                            ? "Select brand first..."
                            : rowAvailableCampaigns.length === 0
                              ? "No campaigns"
                              : "Select Campaign..."}
                        </option>
                        {rowAvailableCampaigns.map((c) => (
                          <option key={c.id} value={c.id}>
                            Campaign {c.campaignNumber}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Row 2: Slots, Daily Limit, Cashback */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="label">
                        Total Slots <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={row.totalSlots}
                        onChange={(e) => updateBulkRow(index, { totalSlots: e.target.value })}
                        className={`input ${row.errors?.totalSlots ? "border-red-500 ring-1 ring-red-500" : ""}`}
                      />
                      {row.errors?.totalSlots && (
                        <p className="mt-1 text-xs text-red-500">{row.errors.totalSlots}</p>
                      )}
                    </div>
                    <div>
                      <label className="label">Daily Limit</label>
                      <input
                        type="number"
                        min={1}
                        value={row.dailyReleaseLimit}
                        onChange={(e) => updateBulkRow(index, { dailyReleaseLimit: e.target.value })}
                        className="input"
                        placeholder="e.g. 5"
                      />
                    </div>
                    <div>
                      <label className="label">Cashback (₹)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={row.cashbackAmount}
                        onChange={(e) => updateBulkRow(index, { cashbackAmount: e.target.value })}
                        className="input"
                        placeholder="250"
                      />
                    </div>
                  </div>

                  {/* Row 3: Product Link, ASIN Code */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">Product Link</label>
                      <input
                        type="url"
                        value={row.productLink}
                        onChange={(e) => updateBulkRow(index, { productLink: e.target.value })}
                        className="input"
                        placeholder="https://amazon.in/dp/..."
                      />
                    </div>
                    <div>
                      <label className="label">ASIN Code</label>
                      <input
                        value={row.asinCode}
                        onChange={(e) => updateBulkRow(index, { asinCode: e.target.value })}
                        className="input font-mono"
                        placeholder="Any ASIN text"
                      />
                    </div>
                  </div>

                  {/* Row 4: Description */}
                  <div>
                    <label className="label">Description</label>
                    <textarea
                      rows={2}
                      value={row.description}
                      onChange={(e) => updateBulkRow(index, { description: e.target.value })}
                      className="input resize-none"
                      placeholder="Product instructions or details..."
                    />
                  </div>

                  {/* Row 5: Product Image */}
                  <div>
                    <span className="label">Product Image</span>
                    <ImageDropzone
                      purpose="product-image"
                      previewUrl={row.uploadPreview}
                      onUploaded={(res) => handleBulkUploaded(index, res)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      {/* --- Confirm Status Modal --- */}
      <Modal
        open={confirmClose !== null}
        onClose={() => setConfirmClose(null)}
        title={confirmClose?.status === "open" ? "Close product" : "Reopen product"}
        description={
          confirmClose?.status === "open"
            ? "Closed products stop accepting new claims. Existing orders are unaffected."
            : "Reopened products accept new claims again."
        }
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setConfirmClose(null)} className="btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => confirmClose && void toggleStatus(confirmClose)}
              className={confirmClose?.status === "open" ? "btn-danger" : "btn-primary"}
            >
              {saving ? "Saving" : confirmClose?.status === "open" ? "Close product" : "Reopen"}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {confirmClose?.name} has {confirmClose?.slotsFilled ?? 0} of{" "}
          {confirmClose?.releasedSlots ?? 0} released slots filled
          {confirmClose && confirmClose.releasedSlots < confirmClose.totalSlots
            ? ` of ${confirmClose.totalSlots} total`
            : ""}
          .
        </p>
      </Modal>
    </>
  );
}
