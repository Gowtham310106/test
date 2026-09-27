import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { paymentSignature, verifyPaymentSignature, verifyWebhookSignature } from "./razorpay";

describe("Razorpay signatures", () => {
  it("verifies the Checkout success signature (order_id|payment_id)", () => {
    const secret = "test_secret";
    const expected = createHmac("sha256", secret).update("order_ABC|pay_XYZ").digest("hex");
    expect(paymentSignature("order_ABC", "pay_XYZ", secret)).toBe(expected);
    expect(verifyPaymentSignature("order_ABC", "pay_XYZ", expected, secret)).toBe(true);
  });

  it("rejects tampered or swapped values", () => {
    const secret = "test_secret";
    const sig = paymentSignature("order_ABC", "pay_XYZ", secret);
    expect(verifyPaymentSignature("order_ABC", "pay_OTHER", sig, secret)).toBe(false);
    expect(verifyPaymentSignature("order_OTHER", "pay_XYZ", sig, secret)).toBe(false);
    expect(verifyPaymentSignature("order_ABC", "pay_XYZ", sig, "wrong_secret")).toBe(false);
    expect(verifyPaymentSignature("order_ABC", "pay_XYZ", "short", secret)).toBe(false);
  });

  it("verifies webhook bodies byte for byte", () => {
    const body = JSON.stringify({ event: "payment.captured", payload: {} });
    const sig = createHmac("sha256", "whsec").update(body).digest("hex");
    expect(verifyWebhookSignature(body, sig, "whsec")).toBe(true);
    expect(verifyWebhookSignature(body + " ", sig, "whsec")).toBe(false);
  });
});
