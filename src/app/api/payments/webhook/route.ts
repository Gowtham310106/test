import { NextResponse } from "next/server";
import { razorpayConfig } from "@/lib/env";
import { settlePaymentById } from "@/lib/orders-server";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { createAdminClient } from "@/lib/supabase/admin";

interface WebhookEvent {
  event: string;
  payload?: {
    payment?: { entity?: { id: string; order_id: string | null } };
    refund?: { entity?: { id: string; payment_id: string; status: string } };
  };
}

/**
 * Razorpay webhook (events: payment.authorized, payment.captured, order.paid,
 * refund.processed, refund.failed). Point the Razorpay dashboard at
 * /api/payments/webhook.
 *
 * Answers 500 when processing fails so Razorpay retries; an event is recorded
 * as processed only after it succeeded.
 */
export async function POST(request: Request) {
  const cfg = razorpayConfig();
  if (!cfg?.webhookSecret) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });

  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  if (!signature || !verifyWebhookSignature(raw, signature, cfg.webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const admin = createAdminClient();
  const eventId = request.headers.get("x-razorpay-event-id");
  if (eventId) {
    const { data: seen } = await admin.from("payment_events").select("id").eq("id", eventId).maybeSingle();
    if (seen) return NextResponse.json({ ok: true, duplicate: true });
  }

  const payment = event.payload?.payment?.entity;
  const refund = event.payload?.refund?.entity;
  try {
    switch (event.event) {
      case "payment.authorized":
      case "payment.captured":
      case "order.paid":
        // Re-fetched inside: the payload may already be out of date.
        if (payment?.id) await settlePaymentById(payment.id);
        break;
      case "refund.processed":
        if (refund) {
          await admin
            .from("orders")
            .update({ payment_status: "refunded", refund_id: refund.id, refund_error: null })
            .eq("razorpay_payment_id", refund.payment_id);
        }
        break;
      case "refund.failed":
        if (refund) {
          // Back to the Refunds tab, where staff can retry.
          await admin
            .from("orders")
            .update({ payment_status: "refund_pending", refund_id: null, refund_error: "Razorpay reported the refund failed." })
            .eq("razorpay_payment_id", refund.payment_id)
            .eq("refund_id", refund.id);
        }
        break;
    }
  } catch (e) {
    console.error(`webhook ${event.event} failed`, e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  if (eventId) {
    await admin
      .from("payment_events")
      .upsert(
        { id: eventId, event_type: event.event, razorpay_order_id: payment?.order_id ?? null, payload: event },
        { onConflict: "id", ignoreDuplicates: true },
      );
  }
  return NextResponse.json({ ok: true });
}
