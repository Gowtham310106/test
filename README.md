# Campus Xerox — online print ordering

**Order your prints from class. Collect them when they're ready.**

An online ordering system for the campus Xerox shop, built from the *Campus Xerox Ordering* pilot proposal.
Students upload files from anywhere, choose B&W or colour, the pages to print and how many copies, see the exact
price, then pay online (UPI/card) or at collection. The shop works through one clear queue instead of a crowd at the
counter, and students collect with a short token number when notified.

| | |
|---|---|
| **Front end** | Next.js 16 (App Router, React 19, Tailwind CSS 4), installable as an app (PWA) |
| **Back end** | Supabase — Postgres with row-level security, Auth (college email + code), Realtime |
| **File storage** | Cloudflare R2 (private bucket, presigned upload/download URLs) |
| **Payments** | Razorpay (UPI, cards, netbanking) — optional; pay-at-shop works without it |
| **Notifications** | Web Push ("Token 4821 is ready") — optional |

See [`docs/EDGE_CASES.md`](docs/EDGE_CASES.md) for every edge case the design handles and where.

---

## How it works

```
Student phone                         Next.js (API routes)                 Supabase / R2 / Razorpay
─────────────                         ────────────────────                 ────────────────────────
1. choose file ──► POST /api/uploads ──► checks type & size, records file ──► files row (pending)
                ◄── presigned PUT URL
   PUT file ─────────────────────────────────────────────────────────────► R2 (private bucket)
   POST /api/uploads/:id ──────────────► re-reads the object: real type?     files row (ready,
                                         counts pages (pdf-lib / docx)        detected_pages)
2. choose B&W/colour, pages, copies — price shown instantly (same formula as the database)
3. POST /api/orders ───────────────────► place_order() in Postgres: ownership, limits, prices,
                                         token — all in one transaction
   (online) Razorpay Checkout ────────► /api/payments/verify + webhook ──► mark_order_paid()
4. Shop dashboard (realtime) ─────────► staff_transition_order(): take → ready → collected
                                         push notification "ready"
5. Nightly /api/cron/cleanup ─────────► expire unpaid orders, delete files after 7 days from R2
```

**Order journey:** `awaiting payment` (online only, hidden from the shop) → `placed` (in the queue, token issued) →
`taken` (printing) → `ready` (student notified) → `collected` (handed over against the token, cash settled if
pending). Orders can be `cancelled` by the student before printing starts, or by the shop with a reason (paid orders
are refunded automatically).

**Who does what**

- **Students** (college email only): sign in with a code sent to their college email, fill in name / roll number /
  department / section / mobile once, then order. Optional friend's name and number for collection.
- **Shop staff** (allowlisted emails): queue with every instruction written out, one-click downloads named
  `<token>-<n>-<file>`, *Start printing* / *Mark ready* / *Hand over* (with cash confirmation), cancel with a
  reason, pause taking orders, beep on new orders, search by token/name/roll number, edit prices.
- **Admins**: everything staff can do, plus settings (allowed email domains, limits, retention) and staff management.
- **Pilot stats** (`/shop/stats`): orders per day, when orders arrive through the day, average wait, uncollected
  orders and student ratings — the numbers the pilot proposal says to measure.

## Project layout

```
src/app/                 pages and API routes
  (student)/orders/      my orders, new order form, order tracking
  shop/                  queue dashboard, prices, stats, settings (staff/admin)
  api/uploads/           presigned upload + server-side verification & page counting
  api/orders/            place, pay, cancel, feedback
  api/payments/          Razorpay verify + webhook
  api/shop/              staff transitions, refunds, downloads
  api/cron/cleanup/      scheduled housekeeping
src/lib/                 pricing (shared with the DB), files, page counting, R2, Razorpay, push
supabase/migrations/     the whole schema, RLS policies and business rules
supabase/tests/          database tests (run against an in-memory Postgres via PGlite)
public/sw.js             service worker for push notifications
```

---

## Setting it up

You need accounts on Supabase, Cloudflare (R2) and — for online payments — Razorpay. Everything below fits in the
free tiers for a single-campus pilot.

### 1. Supabase

1. Create a project. Choose the Mumbai (ap-south-1) region for the lowest latency in India.
2. Apply the schema — either paste [`supabase/migrations/20260927000000_init.sql`](supabase/migrations/20260927000000_init.sql)
   into **SQL Editor** and run it, or with the CLI:
   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
3. Set the college email domain and your first admin (SQL Editor):
   ```sql
   update public.app_settings set allowed_email_domains = '{yourcollege.edu.in}' where id = 1;
   insert into public.staff_allowlist (email, role) values ('you@example.com', 'admin');
   ```
   Until a domain is set, **anyone can sign up** — the admin settings page warns about this. Add the shop staff later
   from **Settings** in the app.
4. **Authentication → Sign In / Providers → Email**: enable email sign-in. Keep *Confirm email* on.
5. **Authentication → Emails → Templates → Magic Link**: include both the code and a link, e.g.
   ```html
   <h2>Your Campus Xerox sign-in code</h2>
   <p style="font-size:24px;letter-spacing:4px"><strong>{{ .Token }}</strong></p>
   <p>Or <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">tap here to sign in</a>.</p>
   ```
   Do the same for the **Confirm signup** template (first sign-in of a new student uses it).
6. **Authentication → URL Configuration**: set *Site URL* to your deployed URL and add `https://<your-domain>/**`
   (and `http://localhost:3000/**` for development) to *Redirect URLs*.
7. **Authentication → Emails → SMTP Settings**: configure a real SMTP provider (Resend, Brevo, Amazon SES, …).
   Supabase's built-in mailer only sends a handful of emails per hour, which a whole campus signing in at once
   will exceed.
8. **Project settings → API keys**: copy the URL, the publishable key and the secret key into the environment.

Realtime for the `orders` table is enabled by the migration.

### 2. Cloudflare R2 (file storage)

1. **R2 → Create bucket**, e.g. `campus-xerox-uploads`. Leave public access **off**.
2. **Bucket → Settings → CORS policy** — browsers upload directly to R2, so allow your site:
   ```json
   [
     {
       "AllowedOrigins": ["https://your-domain.example", "http://localhost:3000"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
3. **R2 → Manage API tokens → Create API token** with *Object Read & Write* on that bucket. Copy the access key ID,
   secret and your account ID.
4. Optional safety net: **Bucket → Settings → Object lifecycle rules** → delete objects with prefix `uploads/`
   after 30 days. The app deletes files after the retention period itself (7 days by default); this only catches
   anything missed if the clean-up job stops running.

### 3. Razorpay (online payments — optional)

1. Create an account and complete KYC so payments settle to the shop's bank account. Use **test mode** keys first.
2. **Settings → API Keys**: generate a key ID and secret.
3. **Settings → Webhooks → Add**: URL `https://<your-domain>/api/payments/webhook`, a secret of your choice, events
   `payment.authorized`, `payment.captured`, `order.paid`, `refund.processed`.
4. **Settings → Payment capture**: automatic capture is recommended (the app also captures authorised payments itself).

Without these keys the *Pay online* option is hidden and every order is pay-at-shop. The gateway fee can be absorbed
by setting slightly higher online rates on the **Prices** page — the page suggests the rate that nets the cash price.

### 4. Push notifications (optional)

```bash
npx web-push generate-vapid-keys
```
Put the public key in `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and the private key in `VAPID_PRIVATE_KEY`. On iPhones, students
must first *Add to Home Screen* (iOS 16.4+); the order page explains this. Without keys, pages still update live.

### 5. Environment

Copy [`.env.example`](.env.example) to `.env.local` (development) or into your host's environment settings, and fill it in.

### 6. Deploy

**Vercel (simplest):** import the repository, add the environment variables (including `CRON_SECRET`), deploy.
[`vercel.json`](vercel.json) schedules `/api/cron/cleanup` daily at 02:00 IST; Vercel sends `CRON_SECRET` with it.

**Cloudflare Workers:** Next.js apps can be deployed to Workers with the OpenNext adapter (`@opennextjs/cloudflare`,
with the `nodejs_compat` flag). This repository hasn't been tested on Workers yet — verify uploads, page counting and
push notifications there before relying on it. Add a Cron Trigger that calls `https://<your-domain>/api/cron/cleanup`
with header `Authorization: Bearer <CRON_SECRET>`.

**Any other host:** `npm run build && npm start` on Node 20.9+, and call the clean-up URL daily from any scheduler
(for example Supabase `pg_cron` + `pg_net`, or a GitHub Actions schedule).

### 7. At the shop

Open the site in Chrome or Edge on each shop computer, sign in with a staff email and choose **Install app** from the
address bar — the dashboard then opens like a desktop app. Staff keep printing the way they do today: download, print,
mark ready.

---

## Development

```bash
npm install
cp .env.example .env.local   # fill in at least the Supabase and R2 values
npm run dev                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm test` | Unit tests plus the database tests (the real migration in an in-memory Postgres) |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate Next.js route types and run TypeScript |
| `npm run build` | Production build |

The database tests in `supabase/tests/` exercise the rules that matter most: sign-up restrictions, pricing
(including a randomised parity check that the browser preview and the database always agree), order limits, token
reuse, the staff state machine and concurrent staff actions, payment idempotency and late payments, refunds, row-level
security between students, and file retention.

## Pilot scope

**In the pilot:** A4 paper · B&W or colour · page ranges and copies · online payment and pay at collection · order
queue, status updates and tokens.

**Later, after the pilot:** spiral binding and other add-ons · other paper sizes · sending jobs straight to the right
printer · extending to other shops and colleges.
