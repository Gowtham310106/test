import "server-only";
import webpush from "web-push";
import { vapidConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/**
 * Sends a Web Push notification to every device the user enabled.
 * Never throws: a failed notification must not fail the order update.
 */
export async function notifyUser(userId: string, message: PushMessage) {
  const vapid = vapidConfig();
  if (!vapid) return;

  try {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    const admin = createAdminClient();
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

    const expired: string[] = [];
    await Promise.all(
      (subs ?? []).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(message),
            { TTL: 60 * 60 * 6, urgency: "high", topic: message.tag?.slice(0, 32) },
          );
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) expired.push(s.id);
        }
      }),
    );
    if (expired.length) await admin.from("push_subscriptions").delete().in("id", expired);
  } catch (e) {
    console.error("push notification failed", e);
  }
}
