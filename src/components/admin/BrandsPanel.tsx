"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { IconExternal, IconSearch } from "@/components/ui/icons";
import { apiRequest } from "@/lib/api-client";
import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import { formatDate } from "@/lib/format";

export type BrandListItem = {
  id: string;
  brandSeq: number;
  name: string;
  pocName: string | null;
  pocNumber: string | null;
  pocEmail: string | null;
  website: string | null;
  createdAt: string;
};

type FormState = {
  name: string;
  pocName: string;
  pocNumber: string;
  pocEmail: string;
  website: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  pocName: "",
  pocNumber: "",
  pocEmail: "",
  website: "",
};

/** 'BR-' + zero-padded 3-digit sequence, e.g. BR-001, BR-042, BR-100. */
function brandDisplayId(seq: number): string {
  return `BR-${String(seq).padStart(3, "0")}`;
}

export function BrandsPanel({ brands }: { brands: BrandListItem[] }) {
  const router = useRouter();
  const toast = useToast();
  useRealtimeRefresh("brands");

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<BrandListItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<BrandListItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return brands;
    return brands.filter((brand) =>
      [brand.name, brand.pocName ?? "", brand.pocEmail ?? "", brand.website ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [brands, query]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setCreating(true);
  }

  function openEdit(brand: BrandListItem) {
    setForm({
      name: brand.name,
      pocName: brand.pocName ?? "",
      pocNumber: brand.pocNumber ?? "",
      pocEmail: brand.pocEmail ?? "",
      website: brand.website ?? "",
    });
    setEditing(brand);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
  }

  async function save() {
    const payload = {
      name: form.name.trim(),
      pocName: form.pocName.trim() || null,
      pocNumber: form.pocNumber.trim() || null,
      pocEmail: form.pocEmail.trim() || null,
      website: form.website.trim() || null,
    };

    setSaving(true);
    try {
      if (editing) {
        await apiRequest(`/api/admin/brands/${editing.id}`, {
          method: "PATCH",
          body: payload,
        });
        toast.success("Brand updated", `${payload.name} was saved and logged.`);
      } else {
        await apiRequest("/api/admin/brands", { body: payload });
        toast.success("Brand created", `${payload.name} has been added.`);
      }
      closeForm();
      router.refresh();
    } catch (error) {
      toast.failure("Could not save the brand", error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function deleteBrand() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/admin/brands/${confirmDelete.id}`, { method: "DELETE" });
      toast.success("Brand deleted", `${confirmDelete.name} was removed and logged.`);
      setConfirmDelete(null);
      router.refresh();
    } catch (error) {
      toast.failure(
        "Could not delete the brand",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setDeleting(false);
    }
  }

  const formValid = form.name.trim().length > 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search brands"
            className="input pl-9"
            aria-label="Search brands"
          />
        </div>
        <button type="button" onClick={openCreate} className="btn-primary">
          Add brand
        </button>
      </div>

      <div className="card mt-4 overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            title={brands.length === 0 ? "No brands yet" : "No brands match that search"}
            description={
              brands.length === 0
                ? "Create the first brand to start linking campaigns and products."
                : "Try a different name or contact."
            }
            icon="🏷"
            action={
              brands.length === 0 ? (
                <button type="button" onClick={openCreate} className="btn-primary btn-sm">
                  Add brand
                </button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] border-collapse text-left">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-3 font-semibold">Brand ID</th>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">POC Name</th>
                  <th className="px-4 py-3 font-semibold">POC Number</th>
                  <th className="px-4 py-3 font-semibold">POC Email</th>
                  <th className="px-4 py-3 font-semibold">Website</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filtered.map((brand) => (
                  <tr
                    key={brand.id}
                    className="transition hover:bg-slate-50/70 dark:hover:bg-white/5"
                  >
                    <td className="table-cell font-mono text-xs text-slate-500 dark:text-slate-400">
                      {brandDisplayId(brand.brandSeq)}
                    </td>
                    <td className="table-cell">
                      <p className="truncate font-medium text-slate-900 dark:text-white">
                        {brand.name}
                      </p>
                    </td>
                    <td className="table-cell text-slate-600 dark:text-slate-300">
                      {brand.pocName ?? <span className="text-slate-400 dark:text-slate-500">—</span>}
                    </td>
                    <td className="table-cell text-slate-600 dark:text-slate-300">
                      {brand.pocNumber ?? (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td className="table-cell text-slate-600 dark:text-slate-300">
                      {brand.pocEmail ?? (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td className="table-cell">
                      {brand.website ? (
                        <a
                          href={brand.website}
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
                    <td className="table-cell text-slate-500 dark:text-slate-400">
                      {formatDate(brand.createdAt)}
                    </td>
                    <td className="table-cell">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(brand)}
                          className="btn-secondary btn-sm"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(brand)}
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

      {/* ── Add / Edit modal ─────────────────────────────────────────────── */}
      <Modal
        open={creating || editing !== null}
        onClose={closeForm}
        title={editing ? "Edit brand" : "Add brand"}
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
              {saving ? "Saving" : editing ? "Save changes" : "Create brand"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="brand-name" className="label">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="brand-name"
              value={form.name}
              maxLength={200}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="input"
              placeholder="boAt Lifestyle"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="brand-poc-name" className="label">
                POC Name
              </label>
              <input
                id="brand-poc-name"
                value={form.pocName}
                maxLength={120}
                onChange={(event) => setForm({ ...form, pocName: event.target.value })}
                className="input"
                placeholder="Rahul Sharma"
              />
            </div>
            <div>
              <label htmlFor="brand-poc-number" className="label">
                POC Number
              </label>
              <input
                id="brand-poc-number"
                type="tel"
                value={form.pocNumber}
                maxLength={40}
                onChange={(event) => setForm({ ...form, pocNumber: event.target.value })}
                className="input"
                placeholder="+91 98765 43210"
              />
            </div>
          </div>

          <div>
            <label htmlFor="brand-poc-email" className="label">
              POC Email
            </label>
            <input
              id="brand-poc-email"
              type="email"
              inputMode="email"
              value={form.pocEmail}
              maxLength={254}
              onChange={(event) => setForm({ ...form, pocEmail: event.target.value })}
              className="input"
              placeholder="rahul@brand.com"
            />
          </div>

          <div>
            <label htmlFor="brand-website" className="label">
              Website
            </label>
            <input
              id="brand-website"
              type="url"
              inputMode="url"
              value={form.website}
              maxLength={1024}
              onChange={(event) => setForm({ ...form, website: event.target.value })}
              className="input"
              placeholder="https://www.boat-lifestyle.com"
            />
          </div>
        </div>
      </Modal>

      {/* ── Delete confirmation modal ─────────────────────────────────────── */}
      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete brand"
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
              onClick={() => void deleteBrand()}
              className="btn-danger"
            >
              {deleting ? "Deleting…" : "Delete brand"}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          You are about to permanently delete{" "}
          <strong className="font-semibold text-slate-900 dark:text-white">
            {confirmDelete?.name}
          </strong>
          . If this brand is still associated with any products, the delete will be blocked with a
          clear message explaining which products must be re-assigned first.
        </p>
      </Modal>
    </>
  );
}
