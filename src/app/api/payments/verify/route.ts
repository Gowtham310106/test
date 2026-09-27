import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson, requireUser } from "@/lib/api";
import { settlePaymentById } from "@/lib/orders-server";
import { verifyPaymentSignature } from "@/lib/razorpay";
import type { Order } from "@/lib/types";

const Body = z.object({
  orderId: z.uuid(),
  razorpay_order_id: z.string().min(1).max(100),
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(200),
});

/**
 * Called by the browser right after Checkout succeeds, so the order moves to
 * the queue immediately. The webhook does the same thing independently in
 * case the student closes the page before this runs.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await readJson(request, Body);
  if (!body.ok) return body.response;
  const p = body.data;

  const { data: order } = await auth.supabase
    .from("orders")
    .select("*")
    .eq("id", p.orderId)
    .eq("student_id", auth.userId)
    .maybeSingle<Order>();
  if (!order || order.razorpay_order_id !== p.razorpay_order_id) return jsonError("Order not found.", 404);

  if (!verifyPaymentSignature(p.razorpay_order_id, p.razorpay_payment_id, p.razorpay_signature)) {
    return jsonError("We couldn't verify this payment. If money was deducted, it will be confirmed shortly.", 400);
  }

  try {
    const settled = await settlePaymentById(p.razorpay_payment_id);
    return NextResponse.json({ order: settled ?? order });
  } catch (e) {
    console.error("payment settlement failed", e);
    return jsonError("Payment received but not confirmed yet. It will update automatically in a minute.", 502);
  }
}
