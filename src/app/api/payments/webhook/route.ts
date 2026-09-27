import { NextResponse } from "next/server";
import { razorpayConfig } from "@/lib/env";
import { settlePayment } from "@/lib/orders-server";
import { verifyWebhookSignature, type RazorpayPayment } from "@/lib/razorpay";
import { createAdminClient } from "@/lib/supabase/admin";

interface WebhookEvent {
  event: string;
  payload?: {
    payment?: { entity?: RazorpayPayment };
    refund?: { entity?: { id: string; payment_id: string; status: string } };
  };
}

/**
 * Razorpay webhook (events: payment.authorized, payment.captured, order.paid,
 * refund.processed). Point the Razorpay dashboard at /api/payments/webhook.
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
  const payment = event.payload?.payment?.entity;
  const eventId = request.headers.get("x-razorpay-event-id");

  // Razorpay retries deliveries; process each event id once.
  if (eventId) {
    const { error } = await admin.from("payment_events").insert({
      id: eventId,
      event_type: event.event,
      razorpay_order_id: payment?.order_id ?? null,
      payload: event,
    });
    if (error?.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    switch (event.event) {
      case "payment.authorized":
      case "payment.captured":
      case "order.paid":
        if (payment) await settlePayment(payment);
        break;
      case "refund.processed": {
        const refund = event.payload?.refund?.entity;
        if (refund) {
          await admin
            .from("orders")
            .update({ payment_status: "refunded", refund_id: refund.id, refund_error: null })
            .eq("razorpay_payment_id", refund.payment_id);
        }
        break;
      }
    }
  } catch (e) {
    console.error(`webhook ${event.event} failed`, e);
    // Let Razorpay retry: forget the event so the retry is processed.
    if (eventId) await admin.from("payment_events").delete().eq("id", eventId);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
