import { clientIp, tooManyRequests } from "./http";

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

type Bucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, Bucket>();
const MEMORY_SWEEP_INTERVAL_MS = 60_000;
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < MEMORY_SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of memoryBuckets) {
    if (bucket.resetAt <= now) memoryBuckets.delete(key);
  }
}

function checkMemory(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = memoryBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    memoryBuckets.set(key, { count: 1, resetAt });
    return { ok: true, limit, remaining: limit - 1, resetAt, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const ok = existing.count <= limit;
  return {
    ok,
    limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterSeconds: ok ? 0 : Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/**
 * Persistent limiter backed by Postgres (migration 0006).
 *
 * Cloudflare can run many isolates, so an in-memory counter is not a real limit
 * in production. This keeps the window in the database - no extra vendor - and
 * the counter is incremented in a single statement, so concurrent requests
 * cannot both slip past the last allowed attempt.
 *
 * Returns null when the store is unusable so the caller can fall back instead of
 * failing the request.
 */
async function rateLimitPostgres(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return null;
    }

    const { createAdminSupabaseClient } = await import("@/lib/supabase/admin");
    const { data, error } = await createAdminSupabaseClient().rpc("consume_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_ms: windowMs,
    });

    if (error || !data) return null;

    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed: boolean; remaining: number; retry_after_seconds: number }
      | undefined;
    if (!row) return null;

    return {
      ok: Boolean(row.allowed),
      limit,
      remaining: Number(row.remaining ?? 0),
      resetAt: Date.now() + windowMs,
      retryAfterSeconds: Number(row.retry_after_seconds ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * Fixed-window limiter.
 *
 * Order of preference: Upstash Redis when configured, then the Postgres store,
 * then a per-instance in-memory window as a last resort. Every step is
 * fail-open on availability and fail-closed on authorization - a limiter outage
 * must not take the app down, but it must also never grant access.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  redis?: { url: string; token: string },
  persistent = false,
): Promise<RateLimitResult> {
  if (!redis) {
    if (persistent) {
      const stored = await rateLimitPostgres(key, limit, windowMs);
      if (stored) return stored;
    }
    return checkMemory(key, limit, windowMs);
  }

  const encodedKey = encodeURIComponent(`ratelimit:${key}`);
  const headers = { Authorization: `Bearer ${redis.token}` };

  try {
    const incrementResponse = await fetch(`${redis.url}/incr/${encodedKey}`, {
      headers,
      cache: "no-store",
    });
    if (!incrementResponse.ok) throw new Error("upstash incr failed");
    const { result: count } = (await incrementResponse.json()) as { result: number };

    if (count === 1) {
      await fetch(`${redis.url}/expire/${encodedKey}/${Math.ceil(windowMs / 1000)}`, {
        headers,
        cache: "no-store",
      });
    }

    const ok = count <= limit;
    return {
      ok,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt: Date.now() + windowMs,
      retryAfterSeconds: ok ? 0 : Math.ceil(windowMs / 1000),
    };
  } catch {
    // Never let a limiter outage take the app down; fall back to the local window
    // and let the request through (fail-open on availability, not on authz).
    return checkMemory(key, limit, windowMs);
  }
}

export async function enforceRateLimit(
  request: Request,
  options: {
    bucket: string;
    limit: number;
    windowMs: number;
    identifier?: string;
    redis?: { url: string; token: string };
    /** Default true: use the durable store when Redis is not configured. */
    persistent?: boolean;
  },
): Promise<RateLimitResult> {
  const identifier = options.identifier ?? clientIp(request);
  const result = await rateLimit(
    `${options.bucket}:${identifier}`,
    options.limit,
    options.windowMs,
    options.redis,
    options.persistent ?? true,
  );
  if (!result.ok) {
    throw tooManyRequests(
      "Too many attempts. Please wait a moment and try again.",
      result.retryAfterSeconds,
    );
  }
  return result;
}

/** Test helper: clears the in-memory windows. */
export function resetRateLimitMemory(): void {
  memoryBuckets.clear();
  lastSweep = Date.now();
}
