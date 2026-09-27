"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Re-renders the page when matching orders change (Supabase Realtime, with
 * RLS). Also refreshes when the tab comes back into view and on a slow timer,
 * so a dropped realtime connection never leaves a stale status on screen.
 */
export function LiveRefresh({
  channel,
  filter,
  intervalMs = 60_000,
  onChange,
}: {
  channel: string;
  filter?: string;
  intervalMs?: number;
  onChange?: (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => void;
}) {
  const router = useRouter();
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };

    const supabase = createClient();
    const sub = supabase
      .channel(channel)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", ...(filter ? { filter } : {}) }, (payload) => {
        onChangeRef.current?.(payload as never);
        refresh();
      })
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, intervalMs);

    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(sub);
    };
  }, [channel, filter, intervalMs, router]);

  return null;
}
