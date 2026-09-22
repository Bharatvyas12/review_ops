import { ZodError, type ZodType } from "zod";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code = "error", details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const unauthorized = (message = "You must sign in to continue.") =>
  new ApiError(401, message, "unauthorized");

export const forbidden = (message = "Admin access required.") =>
  new ApiError(403, message, "forbidden");

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, message, "bad_request", details);

export const notFound = (message = "Not found.") => new ApiError(404, message, "not_found");

export const tooManyRequests = (message: string, retryAfterSeconds: number) =>
  new ApiError(429, message, "rate_limited", { retryAfterSeconds });

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data ?? { ok: true }, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
  });
}

/**
 * Maps thrown errors to responses. Known ApiErrors keep their message; anything
 * else is reported generically so internal details (SQL, stack traces, secrets)
 * never reach the client.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    const details = error.details as { retryAfterSeconds?: number } | undefined;
    if (error.status === 429 && details?.retryAfterSeconds) {
      headers["Retry-After"] = String(details.retryAfterSeconds);
    }
    return Response.json(
      { error: error.message, code: error.code, details: error.details ?? null },
      { status: error.status, headers },
    );
  }

  if (error instanceof ZodError) {
    return Response.json(
      {
        error: "Invalid input.",
        code: "validation_failed",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Postgres errors raised by the SECURITY DEFINER functions carry SQLSTATEs we
  // translate into honest HTTP statuses without leaking the SQL text.
  const pgError = error as { code?: string; message?: string };
  if (pgError?.code === "42501") {
    return Response.json(
      { error: "Admin access required.", code: "forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (pgError?.code === "P0002") {
    return Response.json(
      { error: "Not found.", code: "not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (pgError?.code === "P0001") {
    return Response.json(
      { error: pgError.message ?? "Request rejected.", code: "invalid_operation" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  logUnhandledError(error);

  return Response.json(
    { error: "Something went wrong. Please try again.", code: "internal_error" },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Logs the shape of an unexpected failure without ever echoing its message in
 * production: error text from the driver or the SDK can contain connection
 * strings or keys, and requirement 7 is that secrets never reach a log.
 * Set NODE_ENV=development (or LOG_ERROR_MESSAGES=1) when debugging locally.
 */
function logUnhandledError(error: unknown): void {
  const verbose =
    process.env.NODE_ENV !== "production" || process.env.LOG_ERROR_MESSAGES === "1";

  const base = {
    name: error instanceof Error ? error.name : typeof error,
    code: (error as { code?: string })?.code,
    sqlState: (error as { sqlState?: string })?.sqlState,
  };

  if (verbose) {
    console.error("[api] unhandled error", {
      ...base,
      message: error instanceof Error ? error.message : undefined,
    });
    return;
  }

  console.error("[api] unhandled error", { ...base, message: "[redacted in production]" });
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw badRequest("Invalid input.", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export function clientIp(request: Request): string {
  const headers = request.headers;
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.length > 0) return candidate;
  }
  return "unknown";
}
