"use client";

import type { CheckoutParams } from "@/lib/types";

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", handler: (resp: { error?: { description?: string } }) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadCheckoutScript() {
  if (window.Razorpay) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null;
        reject(new Error("Couldn't load the payment page. Check your internet connection."));
      };
      document.body.appendChild(s);
    });
  }
  return scriptPromise;
}

export type CheckoutOutcome = { status: "paid" } | { status: "dismissed" } | { status: "error"; message: string };

/** Opens Razorpay Checkout and, on success, confirms the payment with our server. */
export async function payWithRazorpay(orderId: string, params: CheckoutParams): Promise<CheckoutOutcome> {
  try {
    await loadCheckoutScript();
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }

  return new Promise<CheckoutOutcome>((resolve) => {
    let settled = false;
    const finish = (o: CheckoutOutcome) => {
      if (!settled) {
        settled = true;
        resolve(o);
      }
    };

    const rzp = new window.Razorpay!({
      key: params.keyId,
      order_id: params.razorpayOrderId,
      amount: params.amountPaise,
      currency: "INR",
      name: params.name,
      description: params.description,
      prefill: params.prefill,
      theme: { color: "#1f5eff" },
      retry: { enabled: true, max_count: 3 },
      modal: {
        confirm_close: true,
        ondismiss: () => finish({ status: "dismissed" }),
      },
      handler: async (resp: RazorpayResponse) => {
        try {
          const res = await fetch("/api/payments/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId, ...resp }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            finish({ status: "error", message: body.error ?? "Payment received but not confirmed yet. It will update shortly." });
            return;
          }
          finish({ status: "paid" });
        } catch {
          finish({ status: "error", message: "Payment received but not confirmed yet. It will update shortly." });
        }
      },
    });
    rzp.on("payment.failed", () => {
      // Checkout lets the student retry inside the popup; only closing it ends the attempt.
    });
    rzp.open();
  });
}
