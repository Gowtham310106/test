import "server-only";
import { razorpayConfig, siteUrl } from "@/lib/env";
import { notifyUser } from "@/lib/push";
import {
  capturePayment,
  createRazorpayOrder,
  getPayment,
  refundPayment,
  type RazorpayPayment,
} from "@/lib/razorpay";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppSettings, CheckoutParams, Order, Profile } from "@/lib/types";

export function onlinePaymentsAvailable(settings: Pick<AppSettings, "online_payments_enabled">) {
  return settings.online_payments_enabled && razorpayConfig() !== null;
}

/**
 * Makes sure the order has a Razorpay order and returns what Checkout needs.
 * Reuses the existing Razorpay order on retries so a payment is never split
 * across two gateway orders.
 */
export async function checkoutFor(order: Order, profile: Profile, shopName: string): Promise<CheckoutParams> {
  const cfg = razorpayConfig();
  if (!cfg) throw new Error("Online payments are not configured.");
  const admin = createAdminClient();

  let razorpayOrderId = order.razorpay_order_id;
  if (!razorpayOrderId) {
    const created = await createRazorpayOrder(order.amount_paise, `order_${order.token}_${order.id.slice(0, 8)}`, {
      order_id: order.id,
      token: String(order.token),
    });
    // Only the first concurrent request wins; the others use its id.
    const { data: claimed } = await admin
      .from("orders")
      .update({ razorpay_order_id: created.id })
      .eq("id", order.id)
      .is("razorpay_order_id", null)
      .select("razorpay_order_id")
      .maybeSingle();
    if (claimed?.razorpay_order_id) {
      razorpayOrderId = claimed.razorpay_order_id as string;
    } else {
      const { data: current } = await admin.from("orders").select("razorpay_order_id").eq("id", order.id).single();
      razorpayOrderId = current?.razorpay_order_id as string;
    }
  }

  return {
    keyId: cfg.keyId,
    razorpayOrderId: razorpayOrderId!,
    amountPaise: order.amount_paise,
    name: shopName,
    description: `Print order · token ${order.token}`,
    prefill: { name: profile.full_name ?? "", email: profile.email, contact: profile.phone ?? "" },
  };
}

/**
 * Records a payment the gateway confirmed, capturing it first if needed.
 * Used by both the browser callback and the webhook, in any order.
 */
export async function settlePayment(payment: RazorpayPayment): Promise<Order | null> {
  if (!payment.order_id) return null;
  const admin = createAdminClient();

  if (payment.status === "authorized") {
    payment = await capturePayment(payment.id, payment.amount);
  }
  if (payment.status !== "captured") return null;

  const { data: order, error } = await admin
    .rpc("mark_order_paid", {
      p_razorpay_order_id: payment.order_id,
      p_razorpay_payment_id: payment.id,
      p_amount_paise: payment.amount,
    })
    .single<Order>();

  if (error) {
    if (error.message === "AMOUNT_MISMATCH") {
      await refundStray(payment, "amount did not match the order");
    }
    if (error.message !== "ORDER_NOT_FOUND") console.error("mark_order_paid failed", error);
    return null;
  }

  if (order.razorpay_payment_id !== payment.id) {
    // A second payment for an order that was already paid.
    await refundStray(payment, "duplicate payment");
    return order;
  }

  await processRefund(order);
  if (order.status === "placed") {
    await notifyUser(order.student_id, {
      title: `Order ${order.token} confirmed`,
      body: "Payment received. Your order is in the shop's queue.",
      url: `${siteUrl()}/orders/${order.id}`,
      tag: `order-${order.id}`,
    });
  }
  return order;
}

export async function settlePaymentById(paymentId: string) {
  return settlePayment(await getPayment(paymentId));
}

async function refundStray(payment: RazorpayPayment, reason: string) {
  try {
    await refundPayment(payment.id, payment.amount, { reason });
  } catch (e) {
    console.error(`refund of stray payment ${payment.id} failed`, e);
  }
}

/**
 * Refunds an order marked refund_pending. Claims the order first so the
 * webhook and a staff action can't both refund it.
 */
export async function processRefund(order: Order): Promise<Order> {
  if (order.payment_status !== "refund_pending" || !order.razorpay_payment_id) return order;
  const admin = createAdminClient();

  const { data: claimed } = await admin
    .from("orders")
    .update({ refund_id: "pending", refund_error: null })
    .eq("id", order.id)
    .eq("payment_status", "refund_pending")
    .is("refund_id", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return order;

  try {
    const refund = await refundPayment(order.razorpay_payment_id, order.amount_paise, {
      order_id: order.id,
      token: String(order.token),
    });
    const { data } = await admin
      .from("orders")
      .update({ refund_id: refund.id, payment_status: "refunded" })
      .eq("id", order.id)
      .select("*")
      .single<Order>();
    return data ?? order;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Refund failed";
    const { data } = await admin
      .from("orders")
      .update({ refund_id: null, refund_error: message.slice(0, 300) })
      .eq("id", order.id)
      .select("*")
      .single<Order>();
    return data ?? order;
  }
}

/** Tells the student about changes they need to act on. */
export async function notifyStatusChange(order: Order) {
  const url = `${siteUrl()}/orders/${order.id}`;
  const tag = `order-${order.id}`;
  if (order.status === "ready") {
    const due = order.payment_status === "paid" ? "" : " Please bring the payment.";
    await notifyUser(order.student_id, {
      title: `Token ${order.token} is ready`,
      body: `Your prints are ready to collect at the Xerox shop.${due}`,
      url,
      tag,
    });
  } else if (order.status === "cancelled" && order.cancel_code !== "student") {
    await notifyUser(order.student_id, {
      title: `Order ${order.token} was cancelled`,
      body: order.cancel_reason ?? "The shop cancelled this order.",
      url,
      tag,
    });
  }
}
