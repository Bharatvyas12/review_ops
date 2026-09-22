import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ApiError,
  badRequest,
  clientIp,
  errorResponse,
  forbidden,
  jsonOk,
  parseJson,
  unauthorized,
} from "@/lib/http";

describe("errorResponse", () => {
  it("passes ApiError status and message through", async () => {
    const response = errorResponse(forbidden());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "forbidden" });
  });

  it("maps Postgres SQLSTATEs raised by the admin functions", async () => {
    const denied = errorResponse({ code: "42501", message: "admin privileges required" });
    expect(denied.status).toBe(403);

    const missing = errorResponse({ code: "P0002", message: "order not found" });
    expect(missing.status).toBe(404);

    const rejected = errorResponse({ code: "P0001", message: "illegal admin transition" });
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({ error: "illegal admin transition" });
  });

  it("never leaks internal errors to the client", async () => {
    const response = errorResponse(new Error("connection string postgres://secret"));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).not.toContain("secret");
  });

  it("redacts error messages from production logs", () => {
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    const previous = process.env.NODE_ENV;
    // @ts-expect-error NODE_ENV is writable at runtime.
    process.env.NODE_ENV = "production";

    try {
      errorResponse(new Error("postgres://user:password@host/db"));
    } finally {
      // @ts-expect-error restore the original value.
      process.env.NODE_ENV = previous;
      spy.mockRestore();
    }

    expect(JSON.stringify(logged)).not.toContain("password");
    expect(JSON.stringify(logged)).toContain("redacted in production");
  });

  it("sets no-store on every response", () => {
    expect(jsonOk({ ok: true }).headers.get("cache-control")).toContain("no-store");
    expect(errorResponse(unauthorized()).headers.get("cache-control")).toContain("no-store");
  });

  it("adds Retry-After for rate limits", () => {
    const response = errorResponse(
      new ApiError(429, "slow down", "rate_limited", { retryAfterSeconds: 30 }),
    );
    expect(response.headers.get("retry-after")).toBe("30");
  });
});

describe("parseJson", () => {
  const schema = z.object({ name: z.string().min(2) });

  it("returns the parsed body", async () => {
    const request = new Request("https://x.test", {
      method: "POST",
      body: JSON.stringify({ name: "ok" }),
    });
    await expect(parseJson(request, schema)).resolves.toEqual({ name: "ok" });
  });

  it("maps validation problems to a 400", async () => {
    const request = new Request("https://x.test", {
      method: "POST",
      body: JSON.stringify({ name: "a" }),
    });
    await expect(parseJson(request, schema)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects malformed JSON with a 400", async () => {
    const request = new Request("https://x.test", { method: "POST", body: "{not json" });
    await expect(parseJson(request, schema)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("clientIp", () => {
  it("prefers the Cloudflare client ip", () => {
    const request = new Request("https://x.test", {
      headers: { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" },
    });
    expect(clientIp(request)).toBe("1.1.1.1");
  });

  it("falls back through the proxy headers", () => {
    const request = new Request("https://x.test", {
      headers: { "x-forwarded-for": "2.2.2.2, 3.3.3.3" },
    });
    expect(clientIp(request)).toBe("2.2.2.2");
    expect(clientIp(new Request("https://x.test"))).toBe("unknown");
  });
});

describe("badRequest", () => {
  it("keeps details for the caller", () => {
    const error = badRequest("nope", { field: "name" });
    expect(error.status).toBe(400);
    expect(error.details).toEqual({ field: "name" });
  });
});
