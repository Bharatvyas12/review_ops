"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { ApiClientError, uploadFile } from "@/lib/api-client";
import { IconImage } from "@/components/ui/icons";

/** Mirrors the server's extraction payload. Declared here so no client bundle
 *  ever reaches into the server-only AI module for a type. */
export type ProofExtraction = {
  name: string | null;
  order_id: string | null;
  phone: string | null;
  product_name: string | null;
  confidence: "high" | "medium" | "low";
};

export type UploadedProof = {
  path: string;
  signedUrl: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: string;
  extraction: ProofExtraction | null;
  extractionAvailable: boolean;
};

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

/**
 * Screenshot picker and uploader, shared by the order and review steps.
 *
 * The browser checks the type and size purely so a mistake is caught instantly;
 * the server re-validates the real bytes and rejects anything it disagrees with,
 * so this check is convenience, not a control.
 */
export function ProofUploader({
  purpose,
  value,
  onChange,
  disabled = false,
  hint,
}: {
  purpose: "order-proof" | "review-proof";
  value: UploadedProof | null;
  onChange: (proof: UploadedProof | null) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);

    if (!ALLOWED.includes(file.type.toLowerCase())) {
      setError("Only PNG, JPEG, WebP or HEIC images are accepted.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`Files must be 5 MB or smaller (that one is ${(file.size / 1024 / 1024).toFixed(1)} MB).`);
      return;
    }

    // Local preview immediately, so the screen never looks unresponsive while
    // the upload and the extraction round trip are in flight.
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setUploading(true);

    try {
      const result = await uploadFile<UploadedProof>("/api/user/upload", file, { purpose });
      onChange(result);
    } catch (caught) {
      URL.revokeObjectURL(objectUrl);
      setPreviewUrl(null);
      onChange(null);
      setError(
        caught instanceof ApiClientError ? caught.message : "That upload did not go through.",
      );
    } finally {
      setUploading(false);
    }
  }

  function clear() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setError(null);
    onChange(null);
  }

  const shown = previewUrl ?? value?.signedUrl ?? null;

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
        className="sr-only"
        onChange={onPick}
        disabled={disabled || uploading}
      />

      {shown ? (
        <div className="overflow-hidden rounded-xl border border-paper-300 bg-paper-100 dark:border-white/10 dark:bg-white/5">
          <img src={shown} alt="Your uploaded screenshot" className="max-h-80 w-full object-contain" />
          <div className="flex items-center justify-between gap-2 border-t border-paper-300 bg-paper-50 px-3 py-2 dark:border-white/10 dark:bg-ink-800">
            <span className="font-body text-[12px] text-ink-500 dark:text-paper-200/60">
              {uploading ? (
                <span className="flex items-center gap-2 text-signal-600">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-signal-500/30 border-t-signal-500" />
                  Uploading and reading the screenshot
                </span>
              ) : (
                "Screenshot ready"
              )}
            </span>
            <button
              type="button"
              onClick={clear}
              disabled={disabled || uploading}
              className="u-btn-ghost !py-1.5 !text-[12px]"
            >
              Replace
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-paper-300 bg-paper-50 px-4 py-8 text-center transition hover:border-signal-500/50 hover:bg-signal-50/50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15 dark:bg-white/5 dark:hover:border-signal-500/40 dark:hover:bg-signal-500/5"
        >
          <IconImage className="h-6 w-6 text-ink-500 dark:text-paper-200/50" />
          <span className="font-body text-[14px] font-semibold text-ink-700 dark:text-paper-100">
            Choose a screenshot
          </span>
          <span className="font-body text-[12px] text-ink-500 dark:text-paper-200/50">
            {hint ?? "PNG, JPEG, WebP or HEIC, up to 5 MB"}
          </span>
        </button>
      )}

      {error ? (
        <p role="alert" className="mt-2 font-body text-[13px] font-medium text-signal-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
