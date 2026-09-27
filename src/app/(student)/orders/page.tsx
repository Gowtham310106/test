import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { PaymentBadge, StatusBadge } from "@/components/badges";
import { LiveRefresh } from "@/components/live-refresh";
import { Alert, Card } from "@/components/ui";
import { getSettings, requireProfile } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { OPEN_STATUSES, type Order, type OrderItem } from "@/lib/types";

export const metadata: Metadata = { title: "My orders" };

type Row = Order & { items: Pick<OrderItem, "file_name">[] };

export default async function OrdersPage() {
  const { supabase, profile } = await requireProfile();
  const settings = await getSettings();
  const { data } = await supabase
    .from("orders")
    .select("*, items:order_items(file_name)")
    .eq("student_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const orders = (data ?? []) as Row[];
  const open = orders.filter((o) => OPEN_STATUSES.includes(o.status));
  const past = orders.filter((o) => !OPEN_STATUSES.includes(o.status));

  return (
    <div className="space-y-6">
      <LiveRefresh channel={`orders-${profile.id}`} filter={`student_id=eq.${profile.id}`} />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">My orders</h1>
        {settings?.accepting_orders ? (
          <Link
            href="/orders/new"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-strong"
          >
            <Plus className="size-4" aria-hidden /> New order
          </Link>
        ) : null}
      </div>

      {settings && !settings.accepting_orders ? <Alert tone="warning">{settings.closed_message}</Alert> : null}

      {orders.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-medium">No orders yet</p>
          <p className="mt-1 text-sm text-muted">Upload a file, choose how to print it, and collect it with your token.</p>
        </Card>
      ) : null}

      {open.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted">In progress</h2>
          {open.map((o) => (
            <OrderRow key={o.id} order={o} />
          ))}
        </section>
      ) : null}

      {past.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted">Earlier</h2>
          {past.map((o) => (
            <OrderRow key={o.id} order={o} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function OrderRow({ order }: { order: Row }) {
  const names = order.items.map((i) => i.file_name);
  return (
    <Link href={`/orders/${order.id}`} className="block">
      <Card className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-muted">
        <div className="w-16 shrink-0 text-center">
          <div className="text-xs text-muted">Token</div>
          <div className="font-mono text-xl font-semibold tabular">{order.token}</div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {names[0]}
            {names.length > 1 ? ` + ${names.length - 1} more` : ""}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <StatusBadge status={order.status} />
            <PaymentBadge order={order} />
            <span>{formatDateTime(order.created_at)}</span>
          </div>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </Card>
    </Link>
  );
}
