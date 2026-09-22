# Review & Order Tracking

A two-role review/order tracking platform, in one Next.js app:

* **Admin panel** (`/admin`) - products, review approvals, payments and
  users, every mutation audited.
* **User panel** (`/app`) - registration with phone verification, a live product feed,
  order and review proof submission with AI-assisted extraction, a six-stage order
  tracker, payout settings, notifications and payment history.

Both run on one Supabase project. Row Level Security is the boundary between the two:
admin access is granted only through `profiles.role = 'admin'`, and every API route
re-checks authorization server-side rather than trusting the UI.

Stack: Next.js 15 (App Router, TypeScript, edge runtime) · Supabase (Postgres,
Auth, Storage, Realtime) · Tailwind CSS v4 · Anthropic Claude (Haiku) for
screenshot extraction · hosted on Cloudflare Pages.

---

## Quick start

```bash
npm install
cp .env.example .env.local          # then fill in the values below
npm run key:generate                # prints BANK_ENCRYPTION_KEY, paste it into .env.local
```

1. **Apply the schema.** Options:
   - **One paste (easiest):** `npm run db:bundle` writes `supabase/setup.sql`, which
     contains every migration in order. Paste the whole file into the Supabase SQL
     editor and run it. It is idempotent, so running it again (or on a project that
     already has some migrations applied) is safe.
   - **Or individually:** run `supabase/migrations/0001` → `0010` in order, or
     `npx supabase link --project-ref <ref> && npm run db:push`.
   - **Staggered slot release (optional):** enable the `pg_cron` extension
     (Database → Extensions) before applying if you want the daily slot-release
     job scheduled. Every migration still applies without it, but the job is absent and
     `select public.release_daily_slots();` then has to be run by hand.
2. **Create the first admin.** There is no public admin sign-up:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
     npm run admin:create admin@company.com "Ops Admin" "a-long-password"
   ```

   `scripts/create-admin.mjs` creates the Auth user (Supabase hashes the password)
   and sets `profiles.role = 'admin'`. Equivalent SQL-only path for an existing
   user: `select public.promote_admin('admin@company.com');`.
3. **Run it:** `npm run dev` -> http://localhost:3000 (staff land on `/login`, everyone else on `/app`).
4. *(Optional)* **Fill the screens with demo data:**

   ```bash
   npm run seed:demo
   ```

   Creates three demo users, three products and seven orders covering every queue
   (awaiting proof, review pending, review approvals, payments, paid, rejected). It prints the demo
   user emails and their shared password. Delete the `demo+*` users when you are done.

> **Windows/PowerShell note:** if you see *"npm.ps1 cannot be loaded because running
> scripts is disabled on this system"*, either use `npm.cmd run dev` instead of
> `npm run dev`, or allow signed local scripts once with
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### Environment variables

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Anon key; everything it can reach is gated by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Ciphertext reads, signed URLs, uploads, admin listing |
| `BANK_ENCRYPTION_KEY` | **server only** | 32-byte AES-256-GCM key (`npm run key:generate`) |
| `BANK_ENCRYPTION_KEY_PREVIOUS` | **server only** | Optional, decrypt-only, for key rotation |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | **server only** | Claude screenshot extraction |
| `SIGNED_URL_TTL_SCREENSHOT` / `SIGNED_URL_TTL_SHARE` | server | Signed URL lifetimes (default 1 h / 24 h) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | server | Distributed rate limiting (recommended in production) |
| `SMS_PROVIDER_URL` / `SMS_PROVIDER_API_KEY` / `SMS_SENDER_ID` | **server only** | Phone OTP delivery. With none set, development prints the code to the server console and production refuses to issue a code at all. |
| `OTP_HASH_PEPPER` | **server only** | Optional pepper for stored OTP hashes. Falls back to a domain-separated derivation of `BANK_ENCRYPTION_KEY`. |
| `OTP_TTL_SECONDS` / `OTP_MAX_ATTEMPTS` | server | OTP validity window (default 300s) and wrong-guess budget (default 5). |

Open only, never committed: `.env*` is gitignored; `.env.example` documents the shape.

---

## Pages

| Route | What it does |
| --- | --- |
| `/login` | Admin email + password. Generic "invalid email or password" on any failure; no sign-up link. |
| `/admin` | Live metric cards (active products, pending review approvals, paid out this month) plus recent audit activity. |
| `/admin/products` | Product table with released/total slot progress, create/edit modal (including an optional daily slot release limit), close/reopen. Image upload included. |
| `/admin/reviews` | Queue of `review_submitted`; screenshot and/or review link, approve/reject. |
| `/admin/payments` | Queue of `approved`; masked bank details, audited reveal, mark-as-paid with a reference. |
| `/admin/users` | User list with order stats; drill into full order history and masked payout details. |
| `/app/login` | Reviewer sign in. No public sign-up link; generic failure message. |
| `/app/register` | Name, email, phone, password, then straight into phone verification. |
| `/app/verify` | 6-digit OTP entry with resend cooldown. Unlocks claiming. |
| `/app` | Product feed. The "slots left" gauge counts the slots released so far and updates live over Realtime; the claim goes through `claim_product_for_user()`. |
| `/app/orders` | Every order with a compact six-segment progress bar. |
| `/app/orders/[id]` | Status tracker, next-action card, order proof upload and confirm screen, review proof submission, submitted details. |
| `/app/settings` | Payout details (encrypted, last-4 only) and account status. |
| `/app/notifications` | Order and payment notifications, mark one or all as read. |
| `/app/payments` | Paid orders grouped by month with subtotals, reference and date. |

---

## How the security requirements are implemented

| # | Requirement | Where it lives |
| --- | --- | --- |
| 1 | RLS on every table, no permissive defaults, admin access only via `profiles.role` | `supabase/migrations/0002_rls_and_policies.sql`. Every policy is table-scoped and role-scoped; `public.is_admin()` is the single source of admin truth. Verified by `npm run test:schema`. |
| 2 | Service role key never reaches the browser | `src/lib/supabase/admin.ts` starts with `import "server-only"`, so the build fails if a client component imports it. Only three server modules may use it. Verified by grepping `.next/static` after a build. |
| 3 | Admin routes protected at two levels (plus a third) | (a) `src/middleware.ts` redirects anonymous/non-admin visitors away from `/admin/*`; (b) `requireAdminSession()` re-checks **inside every** `/api/admin/*` handler; (c) each `admin_*` Postgres function calls `assert_admin()` again, so a future code path cannot skip the check. |
| 4 | Bank numbers encrypted at the application layer; decryption only in the payment console, always logged | `src/lib/crypto.ts` (AES-256-GCM, key from env, `v1.<iv>.<ciphertext>` envelope, rotation-friendly). `account_number_encrypted` is revoked at the **column** level from `anon`/`authenticated`, so not even an admin session can select it. `/api/admin/payments/[id]` writes the audit row *before* decrypting and only returns the number for `approved`/`paid` orders. |
| 5 | Uploads validated server-side; private buckets; short-lived URLs | `src/lib/storage.ts` sniffs real magic bytes (a lying `Content-Type` is rejected), enforces a 5 MB cap, requires the declared type to match the bytes, and both buckets are private with their own `file_size_limit`/`allowed_mime_types`. Images are served through `createSignedUrl`/`createSignedUrls` only. |
| 6 | Every state change writes an `audit_log` row | Order/review transitions, payments and product create/update/close go through `SECURITY DEFINER` functions that write status + audit + notification **in one transaction**. `audit_log` is append-only: no UPDATE/DELETE policy or grant exists. |
| 7 | All secrets in env vars, never logged | `src/lib/env/server.ts` (lazy accessors, fails loudly when missing). Production logs redact error messages because driver errors can embed connection strings. |
| 8 | Server-side validation, no string-built SQL | zod schemas in `src/lib/validation.ts` reachable only through `parseJson`; all database access is supabase-js or parameterised plpgsql. Row-count/status/role checks are re-done in SQL. |
| 9 | Rate-limit login and uploads | `src/lib/rate-limit.ts`: login is limited per IP **and** per account (the email is SHA-256 hashed before it is used as a key), plus `/api/admin/upload` and the extraction route. |
| 10 | HTTPS only | `Strict-Transport-Security` header in `next.config.ts`; Cloudflare Pages enforces TLS at the edge. |
| 11 | Claude receives exactly one screenshot per call | `src/lib/ai/extract-order.ts` sends a single image block and nothing else; the response is re-validated with zod and never trusted raw. It is called only from the server-side route. |
| 12 | Passwords only ever handled by Supabase Auth | The login route passes them straight to `signInWithPassword`; they are not trimmed, transformed, stored or logged. |
| 13 | OTP codes are never stored, logged or returned | `phone_verifications` keeps a peppered SHA-256 hash only, has RLS enabled with **no** policy and no grant to any client role. The code is generated with the CSPRNG, returned in no response, and printed only by the development SMS transport, which is inert in production. |
| 14 | Server-only functions are not reachable from a browser | Supabase grants EXECUTE on new functions to `anon`/`authenticated` by default, so `REVOKE ... FROM public` is not sufficient on its own. Migration 0006 explicitly revokes EXECUTE on `verify_phone_code` and `consume_rate_limit` from `anon` and `authenticated`; both `npm run doctor` and `test:schema` assert it. |
| 15 | Registration, login and OTP are rate-limited per IP and per account | Every one of those routes calls `enforceRateLimit()` with two windows. The store is the shared Postgres window from 0006, so the limit holds across Cloudflare isolates. |

### The user panel's equivalent

The same three layers apply to `/app`:

(a) `src/middleware.ts` gates `/app/*`, allowing only `/app/login` and `/app/register`
through unauthenticated; (b) every `/api/user/*` handler calls `requireUserSession()`
or `requireVerifiedUserSession()` before it reads the body, and then filters by
`user_id` even though RLS would refuse a foreign row; (c) the database functions
re-check ownership, the verified-phone gate and the storage path prefix themselves.

The phone gate is worth calling out because it is the one rule a UI could plausibly
be trusted with and must not be: `assert_verified_user()` is the first statement in
`claim_product_for_user()`, `submit_order_proof()` and `submit_review_proof()`, so an
unverified account cannot claim or submit even by calling the RPC directly.
### Slot claiming is atomic

`claim_product_slot()` performs a single `UPDATE ... WHERE slots_filled < released_slots`
and reports whether a row changed. Postgres serialises the concurrent writers, and the
`products_released_bounds` CHECK constraint (`slots_filled <= released_slots <= total_slots`)
is a hard backstop, so the last slot cannot be sold twice. The stub in the brief used
`select found;` inside a `language sql` body, which does not compile - this is the
row-count adaptation.

### Daily slot release

A campaign can be opened gradually instead of all at once. `products.daily_release_limit`
is the per-day batch (NULL keeps the original behaviour, where every slot is claimable the
moment the product exists), `products.released_slots` is how many slots are claimable right
now, and `products.last_release_date` is the IST day the job last topped the row up.
Availability is measured as `slots_filled < released_slots` everywhere - the claim function,
both panels and the CHECK constraint - so a claim can never reach a slot that has not been
released yet.

`release_daily_slots()` is scheduled through the `pg_cron` extension (`30 18 * * *` UTC, i.e.
midnight IST). For every open product with a limit whose `last_release_date` is in the past it
adds `daily_release_limit * days_elapsed`, capped at `total_slots`, and stamps today - so a
missed run catches up in a single pass and yesterday's unclaimed slots simply stay in the
pool, because `released_slots` is never decreased. The function is `revoke`d from `anon` and
`authenticated` and granted to `service_role` alone, so only the scheduler or an operator can
move it.

---

## Verification

| Command | What it proves |
| --- | --- |
| `npm run typecheck` | Whole codebase is type-clean (`tsc --noEmit`). |
| `npm run lint` | ESLint (next/core-web-vitals and next/typescript), zero warnings. |
| `npm test` | 102 unit tests: crypto round-trip/tamper/rotation, upload sniffing and size limits, zod schemas, rate limiter, error mapping and log redaction, OTP generation/hashing/masking, tracker state, formatting. |
| `npm run test:schema` | Boots an in-process Postgres (PGlite), applies all ten migrations, then runs **125 checks**: RLS on every table, cross-user read denial, no self-promotion, ciphertext unreadable by users and by admins, order guard rails, audit and notification per action, atomic slot claiming, the daily release job, storage policies, the phone-verification gate, OTP expiry/attempt/replay behaviour, ownership checks on every proof submission, payout masking and the server-only grant lockdown. No project or network needed. |
| `npm run test:db` | **58 checks** against a **real** Supabase project: cross-user read denial, the ciphertext being unreachable from every client session, the audited admin transition, 12 genuinely concurrent claims through `claim_product_for_user()` (expects exactly 5 orders and no oversell), the staggered-release batch and its catch-up run, the unverified-phone refusal, cross-user proof denial, the payout round-trip and a live OTP verify. Skips cleanly when credentials are absent. |
| `npm run build` | Production build; every route is edge-rendered and ready for the Cloudflare adapter. |

### Acceptance checklist

- [x] **RLS enabled and tested on every table** - `test:schema` asserts `relrowsecurity` on all eight tables, that each has at least one policy, and that cross-user reads return nothing.
- [x] **Service role key never in a client bundle** - `server-only` guard, then grep `.next/static` after a build for `service_role` / `SUPABASE_SERVICE_ROLE_KEY` (currently: no matches).
- [x] **Every admin page redirects non-admins** - middleware matcher on `/admin/*` (layer 1) and `requireAdminOrRedirect()` in the layout and in each page (layer 2).
- [x] **Bank numbers only decrypt in the audited reveal** - column privileges hide the ciphertext from every session; the reveal route audits first, then decrypts, one order at a time.
- [x] **Wrong type or oversized uploads rejected** - 415 and 413 paths covered by unit tests and by the bucket-level limits.
- [x] **Every approve/reject/mark-paid/product change is audited** - written inside the same transaction as the change, asserted per action in `test:schema`.
- [x] **No secrets committed** - `.env*` is gitignored (only `.env.example` is tracked); no key material exists in source.
- [x] **Slot claiming is atomic** - sequential proof in `test:schema`, true concurrency proof in `test:db`; both suites also assert that no claim can pass `released_slots`.

User panel:

- [x] **An unverified phone cannot claim or submit anything** - `assert_verified_user()` raises before any write, so the rule holds even if the UI is bypassed. Tested for claiming, order proof and review proof.
- [x] **The claim is race-safe** - `claim_product_for_user()` reuses `claim_product_slot()` and creates the order in the same transaction; a refused duplicate rolls its slot increment back. 12 concurrent claims are exercised in `test:db`.
- [x] **A user cannot touch another user's rows** - every route resolves the session first and then filters by `user_id`, and the database functions re-check ownership plus the storage path prefix.
- [x] **OTP codes expire, are rate-limited and never leak** - only a peppered SHA-256 hash is stored; the code is never logged, never returned in a response, and is retired as soon as a newer one is issued or the attempt budget is spent.
- [x] **The account number is never returned to its owner** - the RPC returns a narrow masked projection, and the ciphertext column stays revoked from every client role.
- [x] **Uploads are validated server-side** - real bytes decide the MIME type, the declared type must match, and the 5 MB cap is enforced before the body is buffered.
- [x] **The server-only functions are not callable from a browser** - `verify_phone_code` and `consume_rate_limit` revoke EXECUTE from `anon` and `authenticated`; `doctor` and `test:schema` both assert it.

---

## Architecture notes

```
src/
  middleware.ts                 session refresh, the /admin gate and the /app gate (layer 1)
  app/
    api/auth/{login,logout}     rate-limited admin credential handling
    api/admin/*                 every mutation: requireAdminSession, zod, audited RPC
    api/user/*                  requireUserSession/requireVerifiedUserSession, zod, owner-scoped RPC
    admin/*                     admin server components reading through RLS
    app/*                       user panel: feed, orders, tracker, settings, notifications, payments
  components/
    admin/*                     admin features
    app/*                       user panel features (feed, tracker, proof forms, payout form)
    ui/*                        primitives shared by both
  lib/
    supabase/{server,admin,browser}.ts
    auth.ts crypto.ts storage.ts validation.ts rate-limit.ts http.ts format.ts
    otp.ts otp-service.ts sms/provider.ts user-orders.ts user-errors.ts
    use-live-slots.ts use-realtime-refresh.ts
    ai/extract-order.ts
supabase/
  migrations/0001..0010         schema, RLS, functions/triggers, storage, admin bootstrap, user panel, withdraw, product details, approval removal, daily slot release
  tests/                        schema+RLS checks, live-project concurrency checks
```

A mutation travels: client component, `apiRequest()`, route handler (admin session
re-check), zod validation, `admin_*` RPC, `assert_admin()` and the status change and
the `audit_log` row and the `notifications` row in one transaction, then
`router.refresh()`. Realtime subscriptions on `orders` and `products` also refresh a
queue automatically.

Reads never leave the RLS path: admin pages query with the request-scoped anon-key
client carrying a signed-in admin's cookie. The service-role client is used for
exactly three things (reading the encrypted column in the reveal route, minting
signed URLs, uploading into private buckets) and every one of those call sites has
already verified the admin session.

## Deployment (Cloudflare Pages)

Every page and route handler declares `runtime = "edge"`, which is what the
Cloudflare adapter requires.

```bash
npm run pages:build     # npx @cloudflare/next-on-pages@1 -> .vercel/output/static
npm run preview         # wrangler pages dev
npm run deploy          # wrangler pages deploy
```

Set the environment variables in the Pages project and mark the server-only ones as
secrets. `wrangler.toml` pins `nodejs_compat`.

## Known trade-offs (flagged, not silently relaxed)

1. **Rate limiting prefers Upstash, then falls back to a shared Postgres window, then to
   per-instance memory.** Migration 0006 adds `public.rate_limits` and an atomic
   `consume_rate_limit()`, so the counter is shared across Cloudflare isolates without an
   extra vendor, and that is the path `enforceRateLimit()` takes by default. The in-memory
   window is only reached if the database store is unreachable, which is a deliberate
   availability-over-strictness choice: a limiter outage must not take sign-in down.
   Configure `UPSTASH_REDIS_REST_*` to use Redis instead. Login, registration and OTP are
   additionally limited per account, which bounds targeted brute force either way.
2. **Users cannot read back their own full account number.** Column privileges hide the
   ciphertext from every client session, including the owner's, so the user panel must
   re-enter the number to change it. A deliberate trade: an unreadable ciphertext is worth
   more than an edit convenience.
3. **Admins can read masked bank columns through RLS, but never the ciphertext.** The
   reveal path goes through the service role so decryption and auditing stay in one place.
4. **Rejecting an order does not release the product slot.** The brief does not define the
   rule, and silently freeing slots would change inventory semantics. Add a
   `release_product_slot()` function if the business wants it.
5. **Queues are capped at 100 to 200 rows with no server-side pagination yet.** Fine for
   the expected volume; add keyset pagination before a list can exceed that.
6. **Signed links expire** (1 h inline, 24 h share by default). Images are re-signed on
   demand instead of being stored behind a permanent public URL, which is the point.
7. **The Supabase clients are not parameterised with a generated `Database` type.**
   Generation needs a live project; in its place the row shapes live in `src/lib/types.ts`
   and every query result is typed where it is consumed. Run
   `npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts`
   to upgrade later.
8. **CSP allows `'unsafe-inline'` for scripts** (Next.js needs it without a nonce
   pipeline). Nonce-based CSP via middleware is the natural next hardening step.
9. **A staggered product's later slots are invisible until they are released.** Both panels
   show `released_slots` as the "of" figure, because that is what a reviewer can actually
   claim, so a campaign with a daily limit advertises less than its eventual total on day one
   (the admin table spells out both numbers). That is the intent, but the total is only
   reachable once the job has run for enough days - and with `pg_cron` disabled on the
   project, only a manual `select public.release_daily_slots();` will move it.

Everything required by the brief is implemented. The items above are the places where a
stricter or more expensive option exists and the trade-off was taken deliberately.

## The user panel

Reached at `/app`. Mobile-first on purpose: most reviewers arrive from a WhatsApp
link on a phone, so the layout is thumb-reachable bottom tabs that become a
horizontal strip on wider screens.

The pipeline it implements: **register -> verify phone -> claim a slot -> upload the
order screenshot -> confirm the extracted fields -> write the review -> submit the
review proof -> get paid**. `ORDER_STAGES` in `src/lib/user-orders.ts` is the single
description of those six stages; the tracker, the compact list bar and the
"what do I do next" card are all derived from it, so they cannot drift apart.

Design identity is deliberately its own thing rather than a copy of the console:
warm paper and ink, one signal orange for money and action, a deep teal for
completion, Space Grotesk for headings, IBM Plex Sans for reading and IBM Plex Mono
for the numbers people check twice. The slot counter is a segmented instrument that
ticks when a number moves, and the tracker fills as the order advances instead of
being a static list. All of those tokens are appended to `globals.css`, so `/admin`
is untouched.

### Where the AI fits

`POST /api/user/upload` validates the image, stores it in the private `screenshots`
bucket under the caller's own uid, and - only for an order proof, and only when
`ANTHROPIC_API_KEY` is set - sends that single image to Claude Haiku for extraction.
The result is a *suggestion*: the confirm screen shows the fields prefilled and
editable with the screenshot beside them, and `user_confirmed` is only set when the
user submits. If the key is missing or the call fails, the screen simply starts blank
and the user types the details. Nothing is extracted server-side from any other
user's data, and no unrelated fields are bundled into the request.

### Local development

With no SMS provider configured the OTP flow still works end to end: the code is
printed to the terminal running `npm run dev`, prefixed with `[sms]`. That behaviour is
refused in production - the send route returns 503 rather than issuing a code it
cannot deliver, so a missing credential can never silently disable phone verification.

### Admin-side changes in this phase

None to any `/admin` route or component. The shared files that were extended are
additive and backward compatible: `src/lib/auth.ts` (new `requireUserSession`
family), `src/lib/rate-limit.ts` (an optional persistent store), `src/lib/env/server.ts`
(new accessors), `src/lib/validation.ts` (new schemas), `src/lib/storage.ts` (reused
as-is), `src/components/ui/icons.tsx` (new icons) and `src/app/globals.css` (a second
`@theme` block). `src/lib/use-realtime-refresh.ts` already accepted `products` and
`notifications` and now has real callers.
