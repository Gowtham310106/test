"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Button, Spinner } from "@/components/ui";
import { payWithRazorpay } from "@/lib/checkout-client";
import type { CheckoutParams } from "@/lib/types";

function useCountdown(deadline: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, deadline - now);
}

export function PayNow({ orderId, deadline, initialError }: { orderId: string; deadline: number; initialError: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? "The payment didn't complete. If money was deducted, this page updates on its own within a minute." : null,
  );
  const left = useCountdown(deadline);
  const minutes = Math.floor(left / 60000);
  const seconds = Math.floor((left % 60000) / 1000);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/pay`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Couldn't start the payment.");
        router.refresh();
        return;
      }
      const outcome = await payWithRazorpay(orderId, json.checkout as CheckoutParams);
      if (outcome.status === "error") setError(outcome.message);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button size="lg" className="w-full" onClick={pay} disabled={busy || left === 0}>
        {busy ? <Spinner /> : null} Pay now
      </Button>
      <p className="text-center text-xs text-muted tabular">
        {left > 0
          ? `Pay within ${minutes}:${String(seconds).padStart(2, "0")} to keep this order.`
          : "Time to pay has run out. Place the order again."}
      </p>
      {error ? <Alert tone="warning">{error}</Alert> : null}
    </div>
  );
}

export function CancelOrder({ orderId, paid }: { orderId: string; paid: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Couldn't cancel the order.");
      setConfirming(false);
    }
    router.refresh();
  }

  if (!confirming) {
    return (
      <div className="space-y-2">
        <Button variant="ghost" className="w-full" onClick={() => setConfirming(true)}>
          Cancel order
        </Button>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm">
        Cancel this order?{paid ? " Your payment will be refunded to the same account in 5–7 working days." : ""}
      </p>
      <div className="flex gap-2">
        <Button variant="danger" size="sm" onClick={cancel} disabled={busy}>
          {busy ? <Spinner /> : null} Yes, cancel
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

export function Feedback({ orderId, rating, feedback }: { orderId: string; rating: number | null; feedback: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(rating ?? 0);
  const [text, setText] = useState(feedback ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(rating ? "saved" : "idle");

  async function save(nextRating = value) {
    if (!nextRating) return;
    setState("saving");
    const res = await fetch(`/api/orders/${orderId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: nextRating, feedback: text || null }),
    });
    setState(res.ok ? "saved" : "error");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">How was it?</p>
      <div className="flex gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} of 5`}
            onClick={() => {
              setValue(n);
              void save(n);
            }}
            className={`size-10 rounded-lg text-xl ${n <= value ? "text-warning" : "text-border"} hover:bg-surface-muted`}
          >
            ★
          </button>
        ))}
      </div>
      {value ? (
        <div className="space-y-2">
          <textarea
            className="block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            rows={2}
            maxLength={500}
            placeholder="Anything the shop could do better? (optional)"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (state === "saved") setState("idle");
            }}
          />
          <div className="flex items-center gap-3">
            <Button size="sm" variant="secondary" onClick={() => save()} disabled={state === "saving" || state === "saved"}>
              {state === "saving" ? <Spinner /> : null} {state === "saved" ? "Thanks!" : "Send"}
            </Button>
            {state === "error" ? <span className="text-sm text-danger">Couldn&apos;t save. Try again.</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
