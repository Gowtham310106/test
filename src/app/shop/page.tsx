import type { Metadata } from "next";
import { getSettings, requireProfile } from "@/lib/data";
import type { Profile } from "@/lib/types";
import { ShopDashboard, type DashboardOrder } from "./shop-dashboard";

export const metadata: Metadata = { title: "Shop queue" };

const SELECT = `*,
  student:profiles!orders_student_id_fkey(full_name, roll_number, department, section, phone, no_show_count),
  items:order_items(*, file:files(status, is_encrypted, page_detection))`;

function startOfToday(timeZone: string) {
  // Midnight in the shop's time zone, as an ISO instant.
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone }));
  const offsetMs = local.getTime() - now.getTime();
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime() - offsetMs).toISOString();
}

export default async function ShopPage() {
  const { supabase, profile } = await requireProfile({ staff: true });
  const settings = await getSettings();
  const tz = settings?.timezone ?? "Asia/Kolkata";

  const [open, done, refunds, awaiting, staff] = await Promise.all([
    supabase.from("orders").select(SELECT).in("status", ["placed", "taken", "ready"]).order("queued_at").limit(500),
    supabase
      .from("orders")
      .select(SELECT)
      .in("status", ["collected", "cancelled"])
      .gte("updated_at", startOfToday(tz))
      .or("cancel_code.is.null,cancel_code.neq.payment_timeout")
      .order("updated_at", { ascending: false })
      .limit(300),
    supabase.from("orders").select(SELECT).eq("payment_status", "refund_pending").limit(50),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "awaiting_payment"),
    supabase.from("profiles").select("id, full_name").neq("role", "student"),
  ]);

  const byId = new Map<string, DashboardOrder>();
  for (const o of [...(open.data ?? []), ...(done.data ?? []), ...(refunds.data ?? [])] as DashboardOrder[]) {
    o.items.sort((a, b) => a.position - b.position);
    byId.set(o.id, o);
  }

  const staffNames = Object.fromEntries(
    ((staff.data ?? []) as Pick<Profile, "id" | "full_name">[]).map((s) => [s.id, s.full_name ?? "Staff"]),
  );

  return (
    <ShopDashboard
      orders={[...byId.values()]}
      staffNames={staffNames}
      me={profile.id}
      awaitingPayment={awaiting.count ?? 0}
      accepting={settings?.accepting_orders ?? false}
      closedMessage={settings?.closed_message ?? ""}
      timeZone={tz}
    />
  );
}

