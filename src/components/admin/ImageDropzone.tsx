"use client";

import { useRef, useState } from "react";
import { uploadFile } from "@/lib/api-client";

export type UploadResult = {
  bucket: string;
  path: string;
  signedUrl: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: string;
};

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = "image/png,image/jpeg,image/webp,image/heic,image/heif";

export function ImageDropzone({
  purpose,
  previewUrl,
  onUploaded,
  disabled = false,
}: {
  purpose: "screenshot" | "product-image" | "share";
  previewUrl?: string | null;
  onUploaded: (result: UploadResult) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(previewUrl ?? null);

  async function handleFile(file: File | undefined) {
    if (!file || disabled) return;
    setError(null);

    // Fast client-side feedback only. The server repeats every check on the
    // real bytes and is the only authority.
    if (!ACCEPTED.split(",").includes(file.type)) {
      setError("Only PNG, JPEG, WebP or HEIC images are allowed.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Images must be 5 MB or smaller.");
      return;
    }

    setUploading(true);
    try {
      const result = await uploadFile<UploadResult>("/api/admin/upload", file, { purpose });
      setPreview(result.signedUrl);
      onUploaded(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void handleFile(event.dataTransfer.files?.[0]);
        }}
        className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition ${
          dragging
            ? "border-brand-500 bg-brand-50/60 dark:bg-brand-500/10"
            : "border-slate-300 dark:border-slate-700"
        }`}
      >
        {preview ? (
          <img
            src={preview}
            alt="Selected upload preview"
            className="max-h-40 rounded-lg object-contain"
          />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            ↑
          </span>
        )}

        <p className="text-sm text-slate-600 dark:text-slate-300">
          {uploading ? "Uploading…" : "Drag an image here, or"}
        </p>

        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          className="btn-secondary btn-sm"
        >
          {preview ? "Choose another file" : "Browse files"}
        </button>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          PNG, JPEG, WebP or HEIC · up to 5 MB
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="sr-only"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
