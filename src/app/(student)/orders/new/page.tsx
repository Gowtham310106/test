import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { getPriceTiers, getSettings, requireProfile } from "@/lib/data";
import { formatRate } from "@/lib/format";
import { onlinePaymentsAvailable } from "@/lib/orders-server";
import { OPEN_STATUSES } from "@/lib/types";
import { NewOrderForm } from "./new-order-form";

export const metadata: Metadata = { title: "New order" };

export default async function NewOrderPage() {
  const { supabase, profile } = await requireProfile();
  const [settings, tiers] = await Promise.all([getSettings(), getPriceTiers()]);
  if (!settings) return <Alert tone="danger">The service is not set up yet.</Alert>;

  if (!settings.accepting_orders) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
        <h1 className="text-xl font-semibold">The shop is closed for online orders</h1>
        <p className="text-muted">{settings.closed_message}</p>
        <Link href="/orders" className="text-accent hover:underline">
          Back to my orders
        </Link>
      </div>
    );
  }

  // Work out up front whether pay-at-shop is open to this student, so the
  // form can explain instead of failing on submit.
  const [{ data: openOrders }, { count: noShows }] = await Promise.all([
    supabase.from("orders").select("status, payment_method, payment_status").eq("student_id", profile.id).in("status", OPEN_STATUSES),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("student_id", profile.id)
      .eq("cancel_code", "not_collected"),
  ]);
  const open = openOrders ?? [];
  const unpaidCash = open.filter((o) => o.payment_method === "cash" && o.payment_status === "unpaid" && o.status !== "awaiting_payment").length;

  let cashUnavailableReason: string | null = null;
  if (settings.max_unpaid_orders === 0) cashUnavailableReason = "Pay at shop is turned off.";
  else if (settings.cash_block_after_no_shows > 0 && (noShows ?? 0) >= settings.cash_block_after_no_shows) {
    cashUnavailableReason = "Pay at shop is off for your account because earlier orders weren't collected.";
  } else if (unpaidCash >= settings.max_unpaid_orders) {
    cashUnavailableReason = `You already have ${unpaidCash} unpaid order${unpaidCash === 1 ? "" : "s"}. Pay online or collect those first.`;
  }

  const onlineAvailable = onlinePaymentsAvailable(settings);
  const cashAvailable = cashUnavailableReason === null;
  const bwBase = tiers.find((t) => t.color_mode === "bw" && t.min_pages === 1);
  const colorBase = tiers.find((t) => t.color_mode === "color" && t.min_pages === 1);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">New print order</h1>
        <p className="mt-1 text-sm text-muted">
          A4 paper.
          {bwBase ? ` B&W from ${formatRate(bwBase.rate_cash_paise)}/page` : ""}
          {colorBase ? `, colour from ${formatRate(colorBase.rate_cash_paise)}/page` : ""}
          {bwBase || colorBase ? " at the shop; cheaper per page for large orders." : ""}
        </p>
      </div>
      {open.length >= settings.max_active_orders ? (
        <Alert tone="warning">
          You already have {open.length} open orders, the most allowed at once. Collect or cancel one before placing another.
        </Alert>
      ) : null}
      {!onlineAvailable && !cashAvailable ? (
        <Alert tone="danger">No payment option is available for you right now. Please talk to the shop.</Alert>
      ) : null}
      <NewOrderForm
        tiers={tiers}
        defaultMethod={onlineAvailable ? "online" : "cash"}
        settings={{
          maxFileMb: settings.max_file_mb,
          maxFilesPerOrder: settings.max_files_per_order,
          maxCopies: settings.max_copies,
          maxPagesPerOrder: settings.max_pages_per_order,
          roundToRupee: settings.round_to_rupee,
          onlineAvailable,
          cashAvailable,
          cashUnavailableReason,
          paymentWindowMinutes: settings.payment_window_minutes,
        }}
      />
    </div>
  );
}
