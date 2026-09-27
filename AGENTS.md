<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Campus Xerox

Online print ordering for a campus Xerox shop. Next.js (App Router) front end and API routes, Supabase
(Postgres + Auth + Realtime) back end, Cloudflare R2 for files, Razorpay for payments.

- Business rules (pricing, limits, order state machine, RLS) live in `supabase/migrations/`. Change them there and
  keep `src/lib/pricing.ts` in step — the parity test in `supabase/tests/db.test.ts` fails if they diverge.
- Row types in `src/lib/types.ts` are maintained by hand; update them with any schema change.
- Checks: `npm test` (unit + PGlite database tests), `npm run lint`, `npm run typecheck`, `npm run build`.
- Edge cases and where each is handled: `docs/EDGE_CASES.md`.
