import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { PaymentBadge, StatusBadge } from "@/components/badges";
import { LiveRefresh } from "@/components/live-refresh";
import { NotificationToggle } from "@/components/notification-toggle";
import { Alert, Card, cx } from "@/components/ui";
import { getSettings, requireProfile } from "@/lib/data";
import { describeJob, formatDateTime, formatRupees, formatTime } from "@/lib/format";
import type { Order, OrderItem } from "@/lib/types";
import { CancelOrder, Feedback, PayNow } from "./order-actions";

export const metadata: Metadata = { title: "Order" };

type Row = Order & { items: OrderItem[] };

const STEPS = [
  { key: "placed", label: "Placed", at: (o: Order) => o.queued_at ?? o.created_at },
  { key: "taken", label: "Printing", at: (o: Order) => o.taken_at },
  { key: "ready", label: "Ready", at: (o: Order) => o.ready_at },
  { key: "collected", label: "Collected", at: (o: Order) => o.collected_at },
] as const;

const STEP_INDEX: Record<string, number> = { awaiting_payment: -1, placed: 0, taken: 1, ready: 2, collected: 3 };

export default async function OrderPage(props: PageProps<"/orders/[id]">) {
  const { id } = await props.params;
  const search = await props.searchParams;
  const { supabase, profile } = await requireProfile();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { data } = await supabase
    .from("orders")
    .select("*, items:order_items(*)")
    .eq("id", id)
    .eq("student_id", profile.id)
    .order("position", { referencedTable: "order_items" })
    .maybeSingle();
  if (!data) notFound();
  const order = data as Row;
  const settings = await getSettings();
  const tz = settings?.timezone ?? "Asia/Kolkata";

  const { data: ahead } =
    order.status === "placed" ? await supabase.rpc("queue_position", { p_order_id: order.id }) : { data: null };

  const paymentDeadline = new Date(order.created_at).getTime() + (settings?.payment_window_minutes ?? 30) * 60_000;
  const current = STEP_INDEX[order.status] ?? -1;
  const unpaidAtShop = order.payment_method === "cash" && order.payment_status === "unpaid";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <LiveRefresh channel={`order-${order.id}`} filter={`id=eq.${order.id}`} intervalMs={30_000} />
      <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> My orders
      </Link>

      <Card className="overflow-hidden">
        <div
          className={cx(
            "p-5 text-center",
            order.status === "ready" ? "bg-success-soft" : order.status === "cancelled" ? "bg-danger-soft" : "bg-accent-soft",
          )}
        >
          <p className="text-sm text-muted">Token</p>
          <p className="font-mono text-5xl font-bold tracking-wider tabular">{order.token}</p>
          <div className="mt-2 flex justify-center gap-2">
            <StatusBadge status={order.status} />
            <PaymentBadge order={order} />
          </div>
        </div>

        <div className="space-y-4 p-5">
          <StatusMessage order={order} ahead={typeof ahead === "number" ? ahead : null} />

          {order.status === "awaiting_payment" ? (
            <PayNow orderId={order.id} deadline={paymentDeadline} initialError={search.payment === "error"} />
          ) : null}

          {order.status !== "cancelled" && order.status !== "awaiting_payment" ? (
            <ol className="grid grid-cols-4 gap-1">
              {STEPS.map((s, i) => {
                const done = i <= current;
                const at = s.at(order);
                return (
                  <li key={s.key} className="text-center">
                    <div className={cx("mx-auto mb-1.5 h-1.5 rounded-full", done ? "bg-accent" : "bg-surface-muted")} />
                    <div className={cx("flex items-center justify-center gap-1 text-xs font-medium", done ? "text-foreground" : "text-muted")}>
                      {done ? <Check className="size-3" aria-hidden /> : null}
                      {s.label}
                    </div>
                    <div className="text-[11px] text-muted tabular">{done && at ? formatTime(at, tz) : ""}</div>
                  </li>
                );
              })}
            </ol>
          ) : null}

          {order.status === "placed" || order.status === "taken" || order.status === "awaiting_payment" ? (
            <NotificationToggle vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
          ) : null}

          {order.status === "awaiting_payment" || order.status === "placed" ? (
            <CancelOrder orderId={order.id} paid={order.payment_status === "paid"} />
          ) : null}
        </div>
      </Card>

      <Card className="divide-y divide-border">
        {order.items.map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate font-medium" title={item.file_name}>
                {item.file_name}
              </p>
              <p className="text-sm text-muted">{describeJob(item)}</p>
              {item.pages_source !== "exact" ? (
                <p className="mt-0.5 text-xs text-warning">
                  {item.file_pages} pages as {item.pages_source === "manual" ? "you entered" : "read from the Word file"} — the shop
                  will check.
                </p>
              ) : null}
            </div>
            <div className="text-right text-sm whitespace-nowrap tabular">
              <div>{formatRupees(item.amount_paise)}</div>
              <div className="text-xs text-muted">
                {item.printed_pages} × {formatRupees(item.rate_paise)}
              </div>
            </div>
          </div>
        ))}
        <div className="flex justify-between p-4 font-semibold">
          <span>Total</span>
          <span className="tabular">{formatRupees(order.amount_paise)}</span>
        </div>
      </Card>

      <Card className="space-y-2 p-4 text-sm">
        <Detail label="Placed">{formatDateTime(order.created_at, tz)}</Detail>
        <Detail label="Payment">
          {order.payment_method === "online" ? "Online" : "Cash at collection"}
          {order.paid_at && order.payment_status === "paid" ? ` · paid ${formatDateTime(order.paid_at, tz)}` : ""}
        </Detail>
        {order.alt_contact_name || order.alt_contact_phone ? (
          <Detail label="Collected by">
            {[order.alt_contact_name, order.alt_contact_phone].filter(Boolean).join(" · ")}
          </Detail>
        ) : null}
        {order.note ? <Detail label="Note">{order.note}</Detail> : null}
      </Card>

      {order.status === "collected" ? (
        <Card className="p-4">
          <Feedback orderId={order.id} rating={order.rating} feedback={order.feedback} />
        </Card>
      ) : null}

      {unpaidAtShop && order.status !== "cancelled" ? (
        <p className="text-center text-xs text-muted">Pay {formatRupees(order.amount_paise)} in cash at the counter when you collect.</p>
      ) : null}
      <p className="text-center text-xs text-muted">
        Your files are deleted automatically {settings?.file_retention_days ?? 7} days after the order.
      </p>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function StatusMessage({ order, ahead }: { order: Order; ahead: number | null }) {
  switch (order.status) {
    case "awaiting_payment":
      return <p className="text-center">Complete the payment to send this order to the shop.</p>;
    case "placed":
      return (
        <p className="text-center">
          In the shop&apos;s queue.
          {ahead !== null ? (ahead === 0 ? " You're next." : ` ${ahead} order${ahead === 1 ? "" : "s"} ahead of you.`) : ""}
        </p>
      );
    case "taken":
      return <p className="text-center">The shop is printing your order.</p>;
    case "ready":
      return (
        <p className="text-center font-medium">
          Ready! Show token {order.token} at the counter
          {order.payment_status !== "paid" ? ` and pay ${formatRupees(order.amount_paise)}` : ""}.
        </p>
      );
    case "collected":
      return <p className="text-center">Collected. Thanks for ordering ahead!</p>;
    case "cancelled":
      return (
        <div className="space-y-2 text-center">
          <p>{order.cancel_reason ?? "This order was cancelled."}</p>
          {order.payment_status === "refunded" ? (
            <Alert tone="success">Refund started. It reaches your account in 5–7 working days.</Alert>
          ) : order.payment_status === "refund_pending" ? (
            <Alert tone="warning">Your refund is being processed.</Alert>
          ) : null}
        </div>
      );
  }
}
