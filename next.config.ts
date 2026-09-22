import type { NextConfig } from "next";
import path from "node:path";

const isDev = process.env.NODE_ENV !== "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  // Realtime runs over a WebSocket, and CSP matches on scheme, so an https-only
  // source list does not permit wss://. Without the wss entry the live slot counter
  // and the live order refresh are silently blocked in the browser.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  // Next.js and the Supabase client can spawn a blob worker for background
  // work. Without an explicit worker-src the browser falls back to child-src and
  // then script-src, which blocks the worker and makes the page look like it is
  // hanging while the request is retried.
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin the tracing root to this project. Without it Next walks up to the
  // nearest lockfile, which may sit outside the repo.
  outputFileTracingRoot: path.join(process.cwd()),
  eslint: {
    dirs: ["src", "scripts"],
  },
  // Product images and screenshots live in private Supabase Storage buckets and are
  // rendered from short-lived signed URLs, so the optimizer cannot be used on them.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.supabase.co" }],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
