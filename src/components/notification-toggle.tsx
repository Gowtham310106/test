"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button, Spinner } from "@/components/ui";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Lets a student get a phone notification when their prints are ready. */
export function NotificationToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: State;
      if (!vapidPublicKey || !("serviceWorker" in navigator) || !window.isSecureContext) {
        next = "unsupported";
      } else if (!("PushManager" in window)) {
        // iPhones only allow notifications for apps added to the home screen.
        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
        next = ios ? "ios-install" : "unsupported";
      } else if (Notification.permission === "denied") {
        next = "denied";
      } else {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        next = sub ? "on" : "off";
      }
      if (!cancelled) setState(next);
    })().catch(() => {
      if (!cancelled) setState("unsupported");
    });
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function enable() {
    if (!vapidPublicKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setState(res.ok ? "on" : "off");
    } catch {
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  switch (state) {
    case "loading":
      return null;
    case "unsupported":
      return <p className="text-xs text-muted">Keep this page open — it updates by itself when your order is ready.</p>;
    case "ios-install":
      return (
        <p className="text-xs text-muted">
          To get a notification on iPhone, tap Share → &ldquo;Add to Home Screen&rdquo;, open the app from there and turn
          notifications on. Otherwise keep this page open — it updates by itself.
        </p>
      );
    case "denied":
      return <p className="text-xs text-muted">Notifications are blocked in your browser settings. This page still updates by itself.</p>;
    case "on":
      return (
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm text-success">
            <Bell className="size-4" aria-hidden /> You&apos;ll get a notification when it&apos;s ready.
          </p>
          <Button variant="ghost" size="sm" onClick={disable} disabled={busy}>
            Turn off
          </Button>
        </div>
      );
    case "off":
      return (
        <Button variant="secondary" className="w-full" onClick={enable} disabled={busy}>
          {busy ? <Spinner /> : <BellOff className="size-4" aria-hidden />} Notify me when it&apos;s ready
        </Button>
      );
  }
}
