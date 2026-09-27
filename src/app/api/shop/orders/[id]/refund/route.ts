import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";
import { processRefund } from "@/lib/orders-server";
import type { Order } from "@/lib/types";

/** Retries a refund that failed earlier (shown as "Refund pending" to staff). */
export async function POST(_request: Request, ctx: RouteContext<"/api/shop/orders/[id]/refund">) {
  const { id } = await ctx.params;
  const auth = await requireUser({ staff: true });
  if (!auth.ok) return auth.response;

  const { data: order } = await auth.supabase.from("orders").select("*").eq("id", id).maybeSingle<Order>();
  if (!order) return jsonError("Order not found.", 404);
  if (order.payment_status !== "refund_pending") return NextResponse.json({ order });

  const result = await processRefund(order);
  if (result.payment_status !== "refunded") {
    return jsonError(result.refund_error ?? "The refund didn't go through. Try again or refund from the Razorpay dashboard.", 502, {
      order: result,
    });
  }
  return NextResponse.json({ order: result });
}
