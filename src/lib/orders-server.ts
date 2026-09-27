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

/** Outcomes that are final answers, not failures worth retrying. */
const SETTLED_ERRORS = new Set(["AMOUNT_MISMATCH", "ORDER_NOT_FOUND"]);

/**
 * Records a payment the gateway confirmed, capturing it first if needed.
 * Used by both the browser callback and the webhook, in any order and any
 * number of times. Always works from the payment's current state at
 * Razorpay, never from a (possibly stale) webhook payload.
 *
 * Throws on unexpected failures so the webhook answers 500 and Razorpay
 * retries: a captured payment must never be silently dropped.
 */
export async function settlePaymentById(paymentId: string): Promise<Order | null> {
  let payment = await getPayment(paymentId);
  if (!payment.order_id) return null;

  if (payment.status === "authorized") {
    try {
      payment = await capturePayment(payment.id, payment.amount);
    } catch (e) {
      // Captured meanwhile (auto-capture, or the other of callback/webhook).
      payment = await getPayment(paymentId);
      if (payment.status !== "captured") throw e;
    }
  }
  if (payment.status !== "captured") return null;

  const admin = createAdminClient();
  const { data: order, error } = await admin
    .rpc("mark_order_paid", {
      p_razorpay_order_id: payment.order_id,
      p_razorpay_payment_id: payment.id,
      p_amount_paise: payment.amount,
    })
    .single<Order>();

  if (error) {
    if (!SETTLED_ERRORS.has(error.message)) throw new Error(`mark_order_paid failed: ${error.message}`);
    if (error.message === "AMOUNT_MISMATCH") await refundStray(payment, "amount did not match the order");
    else console.warn(`payment ${payment.id} is for an unknown order ${payment.order_id}`);
    return null;
  }

  if (order.razorpay_payment_id !== payment.id) {
    // A second payment for an order that was already paid.
    await refundStray(payment, "duplicate payment");
    return order;
  }

  const final = await processRefund(order);
  if (final.status === "placed" && final.paid_at && Date.now() - new Date(final.paid_at).getTime() < 60_000) {
    await notifyUser(final.student_id, {
      title: `Order ${final.token} confirmed`,
      body: "Payment received. Your order is in the shop's queue.",
      url: `${siteUrl()}/orders/${final.id}`,
      tag: `order-${final.id}`,
    });
  }
  return final;
}

/**
 * Refunds a payment that doesn't belong to any order (a duplicate, or a wrong
 * amount). Failures are recorded in payment_events for follow-up and rethrown
 * so the webhook is retried.
 */
async function refundStray(payment: RazorpayPayment, reason: string) {
  const admin = createAdminClient();
  const id = `stray-refund:${payment.id}`;
  const { data: done } = await admin.from("payment_events").select("id").eq("id", id).maybeSingle();
  if (done) return;
  try {
    await refundPayment(payment.id, payment.amount, { reason });
    await admin.from("payment_events").insert({
      id,
      event_type: "stray_refund",
      razorpay_order_id: payment.order_id,
      payload: { payment_id: payment.id, amount: payment.amount, reason },
    });
  } catch (e) {
    console.error(`refund of stray payment ${payment.id} failed`, e);
    throw e;
  }
}

// A claim older than this belongs to a request that crashed mid-refund.
const STALE_REFUND_CLAIM_MS = 10 * 60_000;

/**
 * Refunds an order marked refund_pending. Claims the order first so the
 * webhook, the cron job and a staff action can't all refund it.
 */
export async function processRefund(order: Order): Promise<Order> {
  if (order.payment_status !== "refund_pending" || !order.razorpay_payment_id) return order;
  const admin = createAdminClient();

  const staleBefore = new Date(Date.now() - STALE_REFUND_CLAIM_MS).toISOString();
  const { data: claimed } = await admin
    .from("orders")
    .update({ refund_id: "pending", refund_error: null })
    .eq("id", order.id)
    .eq("payment_status", "refund_pending")
    .or(`refund_id.is.null,and(refund_id.eq.pending,updated_at.lt."${staleBefore}")`)
    .select("id")
    .maybeSingle();
  if (!claimed) return order;

  try {
    const refund = await refundPayment(order.razorpay_payment_id, order.amount_paise, {
      order_id: order.id,
      token: String(order.token),
    });
    // "refunded" means Razorpay accepted the refund; a refund.failed webhook
    // puts the order back to refund_pending.
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
