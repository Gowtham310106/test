"use client";

import { useEffect } from "react";

/** Registers /sw.js, which shows push notifications and makes the app installable. */
export function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
  }, []);
  return null;
}
