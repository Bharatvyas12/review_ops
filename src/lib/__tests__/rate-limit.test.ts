import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enforceRateLimit, rateLimit, resetRateLimitMemory } from "@/lib/rate-limit";
import { ApiError } from "@/lib/http";

function requestFrom(ip: string): Request {
  return new Request("https://admin.example.com/api/auth/login", {
    method: "POST",
    headers: { "cf-connecting-ip": ip },
  });
}

beforeEach(() => {
  resetRateLimitMemory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rateLimit (in-memory window)", () => {
  it("allows up to the limit then blocks", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await rateLimit("k", 3, 60_000);
      expect(result.ok).toBe(true);
    }

    const blocked = await rateLimit("k", 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks keys independently", async () => {
    await rateLimit("a", 1, 60_000);
    expect((await rateLimit("a", 1, 60_000)).ok).toBe(false);
    expect((await rateLimit("b", 1, 60_000)).ok).toBe(true);
  });

  it("resets once the window has passed", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    await rateLimit("k", 1, 1_000);
    expect((await rateLimit("k", 1, 1_000)).ok).toBe(false);

    vi.spyOn(Date, "now").mockReturnValue(5_000);
    expect((await rateLimit("k", 1, 1_000)).ok).toBe(true);
  });
});

describe("enforceRateLimit", () => {
  it("throws a 429 with Retry-After data", async () => {
    const options = { bucket: "login:ip", limit: 2, windowMs: 60_000 };
    await enforceRateLimit(requestFrom("203.0.113.7"), options);
    await enforceRateLimit(requestFrom("203.0.113.7"), options);

    await expect(enforceRateLimit(requestFrom("203.0.113.7"), options)).rejects.toBeInstanceOf(
      ApiError,
    );

    try {
      await enforceRateLimit(requestFrom("203.0.113.7"), options);
    } catch (error) {
      expect((error as ApiError).status).toBe(429);
      expect((error as ApiError).details).toMatchObject({ retryAfterSeconds: expect.any(Number) });
    }
  });

  it("keeps separate counters per address", async () => {
    const options = { bucket: "login:ip", limit: 1, windowMs: 60_000 };
    await enforceRateLimit(requestFrom("203.0.113.1"), options);
    await expect(enforceRateLimit(requestFrom("203.0.113.2"), options)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("falls back to the local window when Redis is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const result = await rateLimit("redis", 2, 60_000, {
      url: "https://redis.example.com",
      token: "token",
    });
    expect(result.ok).toBe(true);
  });
});
