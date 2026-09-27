import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";
import { checkoutFor, onlinePaymentsAvailable } from "@/lib/orders-server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppSettings, Order } from "@/lib/types";

/** Retry payment for an online order that is still awaiting payment. */
export async function POST(_request: Request, ctx: RouteContext<"/api/orders/[id]/pay">) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data: order } = await auth.supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .eq("student_id", auth.userId)
    .maybeSingle<Order>();
  if (!order) return jsonError("Order not found.", 404);
  if (order.status !== "awaiting_payment") {
    return jsonError(order.payment_status === "paid" ? "This order is already paid." : "This order can't be paid any more.", 409);
  }

  const admin = createAdminClient();
  const { data: settings } = await admin.from("app_settings").select("*").eq("id", 1).single<AppSettings>();
  if (!settings || !onlinePaymentsAvailable(settings)) {
    return jsonError("Online payment is not available right now. Cancel this order and choose pay at shop.", 400);
  }

  const expiresAt = new Date(order.created_at).getTime() + settings.payment_window_minutes * 60_000;
  if (Date.now() > expiresAt) {
    await admin.rpc("expire_stale_payments", { p_student_id: auth.userId });
    return jsonError("The time to pay for this order has run out. Please place it again.", 410);
  }

  try {
    const checkout = await checkoutFor(order, auth.profile, settings.shop_name);
    return NextResponse.json({ checkout });
  } catch (e) {
    console.error("creating the payment failed", e);
    return jsonError("Couldn't start the payment. Please try again.", 502);
  }
}
