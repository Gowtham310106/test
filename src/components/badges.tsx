import { Badge } from "@/components/ui";
import { formatRupees, PAYMENT_STATUS_LABEL, STATUS_LABEL } from "@/lib/format";
import type { Order, OrderStatus } from "@/lib/types";

const STATUS_TONE: Record<OrderStatus, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  awaiting_payment: "warning",
  placed: "accent",
  taken: "accent",
  ready: "success",
  collected: "neutral",
  cancelled: "danger",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function PaymentBadge({ order }: { order: Pick<Order, "payment_status" | "payment_method" | "amount_paise"> }) {
  const amount = formatRupees(order.amount_paise);
  switch (order.payment_status) {
    case "paid":
      return <Badge tone="success">Paid {amount}</Badge>;
    case "unpaid":
      return (
        <Badge tone="warning">
          {order.payment_method === "cash" ? "Unpaid" : "Not paid"} {amount}
        </Badge>
      );
    default:
      return (
        <Badge tone="danger">
          {PAYMENT_STATUS_LABEL[order.payment_status]} {amount}
        </Badge>
      );
  }
}
