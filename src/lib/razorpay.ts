import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { razorpayConfig } from "@/lib/env";

// Razorpay (UPI, cards, netbanking) through its REST API. No SDK needed.

const API = "https://api.razorpay.com/v1";

export class RazorpayError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function config() {
  const cfg = razorpayConfig();
  if (!cfg) throw new RazorpayError("Online payments are not configured.", 503);
  return cfg;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const cfg = config();
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } } & T;
  if (!res.ok) throw new RazorpayError(json.error?.description ?? `Razorpay request failed (${res.status})`, res.status);
  return json;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export function createRazorpayOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
  return call<RazorpayOrder>("/orders", {
    amount: amountPaise,
    currency: "INR",
    receipt: receipt.slice(0, 40),
    notes,
  });
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
}

export function getPayment(paymentId: string) {
  return call<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`);
}

/** Only needed when auto-capture is off in the Razorpay dashboard. */
export function capturePayment(paymentId: string, amountPaise: number) {
  return call<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}/capture`, {
    amount: amountPaise,
    currency: "INR",
  });
}

export function refundPayment(paymentId: string, amountPaise: number, notes: Record<string, string>) {
  return call<{ id: string; status: string }>(`/payments/${encodeURIComponent(paymentId)}/refund`, {
    amount: amountPaise,
    speed: "normal",
    notes,
  });
}

function safeEqualHex(expected: string, actual: string) {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function paymentSignature(orderId: string, paymentId: string, secret: string) {
  return createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
}

/** Checks the signature Checkout hands back after a successful payment. */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, secret = config().keySecret) {
  return safeEqualHex(paymentSignature(orderId, paymentId, secret), signature);
}

export function webhookSignature(rawBody: string, secret: string) {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyWebhookSignature(rawBody: string, signature: string, secret: string) {
  return safeEqualHex(webhookSignature(rawBody, secret), signature);
}
