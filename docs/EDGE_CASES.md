# Edge cases and how they are handled

The pilot proposal describes the happy path: upload, choose, pay, shop prints, collect. This is the list of
things that go wrong at a real counter with real students, and what the system does about each. Rules that
involve money, the queue or privacy are enforced in the database (`supabase/migrations/…_init.sql`), so they
hold even if someone calls the API directly; the tests in `supabase/tests/db.test.ts` cover them.

## Accounts and access

| Situation | What happens | Where |
|---|---|---|
| An outsider tries to sign up with Gmail | Refused before the code is sent, and again by a database trigger when the account would be created | `login/actions.ts`, `handle_new_user()` |
| College uses a subdomain for students (`students.college.edu.in`) | Subdomains of an allowed domain are accepted | `email_domain_allowed()` |
| Shop staff don't have college emails | Staff allowlist works for any domain; role is applied on sign-up and updated if the list changes later | `staff_allowlist`, `sync_staff_role()` |
| Two accounts claim the same roll number | Second one is refused with a message to contact the shop ("one account per student") | `profiles.roll_number unique`, `save_profile()` |
| Student mistypes roll number, tries to change it later | Roll number is locked once set; the shop/admin corrects it in the database | `save_profile()` |
| Student tries to make themselves staff via the API | Profiles can't be updated directly; only `save_profile()`, which never touches the role | column privileges + RLS |
| Phone typed as `+91 98765 43210` or `098765…` | Normalised to 10 digits; anything that isn't a valid Indian mobile is rejected | `save_profile()`, `place_order()` |
| Sign-in email slow or in spam | Page says so; "Send a new code" button; rate-limit errors explained | `login-form.tsx` |
| Built-in Supabase mailer rate limit hit on day one | README requires custom SMTP before launch | README §1.7 |
| Magic link opened on a different device / expired | Falls back to the login page with a clear message; the 6-digit code works on any device | `auth/confirm/route.ts` |
| Session expires while the tab is open | Proxy refreshes it on every navigation; API routes answer 401 and the page asks to sign in again | `proxy.ts`, `lib/api.ts` |

## Files and page counting

| Situation | What happens | Where |
|---|---|---|
| Unsupported type (PowerPoint, HEIC, ZIP, EXE) | Rejected in the browser and again on the server, with the list of accepted types | `lib/files.ts` |
| A file renamed to `.pdf` that isn't a PDF | Server reads the uploaded object's real signature and rejects it; object deleted from R2 | `api/uploads/[id]` |
| A PNG saved with `.jpg` | Accepted — both are images — and stored with the right type | `signatureMatches()` |
| Student lies about the page count to pay less | Page counts come from the server reading the file. For PDFs and photos the student's number is ignored | `page-count.ts`, `place_order()` |
| Student re-uploads a longer file to the same upload link after it was counted | The server stores the exact bytes it counted under a new key no upload link can write to; the shop downloads that copy | `api/uploads/[id]` |
| Crafted PDF that shows one parser fewer pages than a viewer prints | Pages are counted by pdf.js (follows the cross-reference table like Chrome/Acrobat) and by pdf-lib; if they disagree the count isn't trusted — the student enters it and the shop is told to check | `countPdfPages()` |
| Word file (.docx) | Page count read from the document's metadata and shown as an estimate the student can correct; the shop sees "page count from Word — check" | `countDocxPages()` |
| Old Word (.doc), damaged PDF, PDF whose pages can't be counted | Student enters the number of pages; the shop sees "page count entered by student — check" | `page-count.ts`, dashboard badge |
| A `.docx` that is really a spreadsheet or random zip | Rejected: not a Word document | `countDocxPages()` |
| PDF that needs a password to open | Rejected with a message to remove the password — the shop couldn't open it either | `countPdfPages()` |
| PDF with only copy/print restrictions (opens without a password) | Accepted; the shop sees a "Protected PDF" badge and can cancel with reason "Problem with the file" if it won't print | `countPdfPages()`, dashboard |
| File bigger than the limit (25 MB default) | Refused before upload; the signed upload URL also fixes the size, and the server re-checks it | `api/uploads`, `r2.ts` |
| Upload cut off halfway (weak Wi-Fi in the hostel) | Size mismatch detected, file rejected; the student taps Retry | `api/uploads/[id]` |
| Student leaves the page while uploading | Browser asks for confirmation | `new-order-form.tsx` |
| Someone uses the bucket as free storage | 60 uploads per hour per student; unattached uploads deleted after 24 hours | `api/uploads`, `files_due_for_deletion()` |
| File names with Tamil/Hindi characters, slashes or Windows-illegal characters | Cleaned for display; downloads keep the original name via RFC 6266 headers | `sanitizeFileName()`, `contentDisposition()` |
| Many photos from class | Up to 10 files per order, each with its own colour, pages and copies | settings |
| Same PDF, some pages in colour and the rest B&W | Add the file twice with different ranges and colour settings | `place_order()` allows repeats |

## Prices

| Situation | What happens | Where |
|---|---|---|
| Browser shows one price, database charges another | Both use the same formula; a randomised test checks they agree | `lib/pricing.ts`, parity test |
| Shop changes prices while a student is on the form | Order is refused with "prices just changed", the form reloads the new prices for the student to confirm | `PRICE_CHANGED` |
| Bulk discount | Tiers per colour mode based on the whole order's printed pages | `price_tiers`, `selectTier()` |
| Online gateway fee | Separate online rate per tier; the Prices page suggests the rate that nets the cash price | `price-editor.tsx` |
| Totals like ₹75.75 at a cash counter | Totals are rounded up to the next rupee (can be turned off) | `round_to_rupee` |
| Shop saves a price list with no tier starting at 1 page, duplicates or ₹0 | Refused | `set_price_tiers()` |
| Huge order (e.g. 5,000 pages) | Capped per order (2,000 printed pages by default) and at ₹1,00,000 | `ORDER_TOO_LARGE` |

## Ordering limits and abuse

| Situation | What happens | Where |
|---|---|---|
| Shop closed, printer broken, holiday | Staff click *Pause* with a message; students see it and can't order | `set_accepting_orders()` |
| One student floods the queue | At most 5 open orders per student | `max_active_orders` |
| Pay-at-shop orders that are never collected (wasted paper) | At most 2 unpaid orders at a time; after 3 uncollected orders pay-at-shop is turned off for that student; staff see "N uncollected before" | `place_order()`, dashboard |
| Double-tap on "Place order" | Button disabled while submitting; per-student row lock serialises concurrent submits so limits can't be raced | `place_order()` |
| Student's network drops right after submitting | Message tells them to check *My orders* before retrying | `new-order-form.tsx` |

## Payments

| Situation | What happens | Where |
|---|---|---|
| Student closes Razorpay without paying | Order stays "awaiting payment" (not in the shop's queue) with a *Pay now* button and a countdown | `order-actions.tsx` |
| Never paid | Cancelled after 30 minutes (configurable) | `expire_stale_payments()` |
| Paid at minute 31, after it was expired | The late payment brings the order back into the queue; if its token was reissued meanwhile it gets a new one | `mark_order_paid()` |
| Paid more than a day late, or after the files were deleted | Not revived (it couldn't be printed); refunded automatically | `mark_order_paid()` |
| Browser callback and webhook both arrive, in any order, or the webhook is retried | Idempotent: the payment is recorded once; the payment is always re-fetched from Razorpay rather than trusting the webhook body, and "already captured" counts as success | `settlePaymentById()`, `mark_order_paid()` |
| Database hiccup while recording a captured payment | The webhook answers 500 so Razorpay retries; an event is only marked processed after it succeeded | `api/payments/webhook` |
| Student closes the tab before the callback runs | Webhook confirms the payment independently | `api/payments/webhook` |
| Two browser tabs start payment for the same order | Both use the same Razorpay order, so money can't be split across two | `checkoutFor()` |
| A second payment for an already-paid order | Detected and refunded automatically | `settlePayment()` |
| Payment amount doesn't match the order | Not accepted; refunded | `AMOUNT_MISMATCH` |
| Forged "payment successful" request | Signature checked with the Razorpay secret; payment re-fetched from Razorpay before marking paid | `verifyPaymentSignature()`, `getPayment()` |
| Auto-capture off in Razorpay | App captures authorised payments itself | `capturePayment()` |
| Student cancels a paid order, or pays after cancelling | Refunded automatically | `cancel_my_order()`, `mark_order_paid()` |
| Shop cancels a paid order (bad file, printer down) | Refunded automatically, student notified | `processRefund()` |
| Refund API fails, or Razorpay later reports `refund.failed` | Order shows "Refund pending" in a Refunds tab with the error and a *Retry refund* button; the nightly job also retries; a claim flag (released after 10 minutes if the server crashed mid-refund) prevents double refunds | `processRefund()`, webhook, cron |
| Refund of a duplicate/wrong-amount payment fails | Recorded and retried with the webhook; successful stray refunds are logged in `payment_events` | `refundStray()` |
| Pay-at-shop order at the counter | *Hand over* asks staff to confirm the cash first; can't mark collected while unpaid | `PAYMENT_PENDING` |
| Online payment not configured yet | Pay online hidden; everything works with pay-at-shop | `onlinePaymentsAvailable()` |

## Queue and the shop counter

| Situation | What happens | Where |
|---|---|---|
| Two staff on two computers click *Start printing* on the same order | Second click gets "someone else already updated this order" and the list refreshes | `STATUS_CHANGED` |
| Staff hand over the wrong order by mistake | *Undo hand-over* for 15 minutes; cash payment reverts to unpaid | `staff_transition_order()` |
| Printer jammed, needs reprint | *Reprint* moves a ready order back to printing | `ready → taken` |
| Staff took an order but can't finish it | *Back to queue* | `taken → placed` |
| Student never collects | *Not collected* cancels it and counts as a no-show for that student. If it was paid online the payment is kept, because the prints were made | `cancel_code = not_collected` |
| Order left "ready" for weeks | Its files are kept until it is collected or cancelled, so staff can still reprint | `files_due_for_deletion()` |
| Friend collects | Friend's name and number are on the order; staff search by token, name or roll number | dashboard search |
| Someone shows another student's token | Staff see the student's name, department, roll number and phone next to the token | dashboard |
| Tokens run past 9999 | Tokens cycle from 1000 but are never reused while an order with that token is open | `next_order_token()` |
| Files on the shop computer get mixed up | Downloads are named `<token>-<n>-<original name>`; downloaded files show "Again" | download route |
| Busy break-time rush | Queue is first-come, first-served by the time an order entered the queue (payment time for online orders) | `queued_at` |
| Staff don't notice new orders | Optional beep on new orders; list updates live and also refreshes every 20 seconds | `LiveRefresh`, dashboard |
| Realtime connection drops | Pages re-fetch on focus and on a timer | `live-refresh.tsx` |
| Student cancels after printing started | Not allowed online — they must talk to the shop | `CANNOT_CANCEL` |

## Notifications

| Situation | What happens | Where |
|---|---|---|
| Student wants to know when it's ready | Web Push notification when marked ready (and if cancelled by the shop); the order page also updates live | `notifyStatusChange()` |
| iPhone | Push only works for home-screen apps on iOS 16.4+; the page explains how, and still updates live | `notification-toggle.tsx` |
| Notifications blocked, or old browser | Page says so and keeps updating live | `notification-toggle.tsx` |
| Phone changed or subscription expired | Dead subscriptions are removed when the push service reports them gone | `push.ts` |
| Shared computer used by two students | The subscription moves to whoever enabled it last | `api/push` |
| Push service down | Never blocks the status change | `notifyUser()` never throws |

## Privacy and retention

| Situation | What happens | Where |
|---|---|---|
| Student guesses another order's ID | Row-level security: students only ever see their own orders, items and files | RLS policies |
| Student asks for another student's no-show count | Only the student themselves and staff get a number | `no_show_count()` |
| Direct access to uploaded files | Bucket is private; only staff get 5-minute download links; uploads use 10-minute links | `r2.ts` |
| "Files removed automatically a week after the order" | Nightly job deletes files once the order is 7 days old (configurable) — but never while the order is still waiting to be printed or collected | `files_due_for_deletion()`, `api/cron/cleanup` |
| Clean-up job stops running | R2 lifecycle rules delete abandoned uploads after 1 day and anything else after 30 days | README §2.4 |
| Old order opened after its files were deleted | Order history stays; download shows "File removed" | download route |
| Cron endpoint called by a stranger | Requires `CRON_SECRET` | `api/cron/cleanup` |

## Known limits of the pilot

- A4 only; no binding, other paper sizes or double-sided pricing yet (the note field says extras aren't available).
- Word page counts are estimates — for an exact print students should upload PDF.
- No direct-to-printer sending: staff download and print as they do today.
- A single shop; extending to more shops would add a `shop_id` to orders, prices and staff.
