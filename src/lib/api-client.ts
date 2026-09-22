"use client";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, message: string, code = "error", details: unknown = null) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Thin fetch wrapper: same-origin, cookies included, JSON in and out.
export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ?? "Something went wrong. Please try again.";
    throw new ApiClientError(
      response.status,
      message,
      (payload as { code?: string } | null)?.code ?? "error",
      (payload as { details?: unknown } | null)?.details ?? null,
    );
  }

  return payload as T;
}

export async function uploadFile<T>(
  path: string,
  file: File,
  fields: Record<string, string> = {},
): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }

  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    body: form,
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      (payload as { error?: string } | null)?.error ?? "Upload failed.",
      (payload as { code?: string } | null)?.code ?? "error",
      (payload as { details?: unknown } | null)?.details ?? null,
    );
  }
  return payload as T;
}
