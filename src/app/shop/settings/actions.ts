"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export interface SettingsState {
  ok?: boolean;
  error?: string;
}

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const Settings = z.object({
  shop_name: z.string().trim().min(2).max(60),
  closed_message: z.string().trim().min(1).max(200),
  allowed_email_domains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Enter domains like college.edu.in")).max(10),
  departments: z.array(z.string().min(2).max(40)).min(1).max(40),
  max_file_mb: z.coerce.number().int().min(1).max(100),
  max_files_per_order: z.coerce.number().int().min(1).max(30),
  max_pages_per_order: z.coerce.number().int().min(10).max(20000),
  max_copies: z.coerce.number().int().min(1).max(500),
  max_active_orders: z.coerce.number().int().min(1).max(50),
  max_unpaid_orders: z.coerce.number().int().min(0).max(20),
  cash_block_after_no_shows: z.coerce.number().int().min(0).max(50),
  file_retention_days: z.coerce.number().int().min(1).max(90),
  payment_window_minutes: z.coerce.number().int().min(5).max(1440),
  round_to_rupee: z.boolean(),
  online_payments_enabled: z.boolean(),
});

export async function saveSettings(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  const parsed = Settings.safeParse({
    shop_name: formData.get("shop_name"),
    closed_message: formData.get("closed_message"),
    allowed_email_domains: list(formData.get("allowed_email_domains")).map((d) => d.toLowerCase().replace(/^@/, "")),
    departments: list(formData.get("departments")).map((d) => d.toUpperCase()),
    max_file_mb: formData.get("max_file_mb"),
    max_files_per_order: formData.get("max_files_per_order"),
    max_pages_per_order: formData.get("max_pages_per_order"),
    max_copies: formData.get("max_copies"),
    max_active_orders: formData.get("max_active_orders"),
    max_unpaid_orders: formData.get("max_unpaid_orders"),
    cash_block_after_no_shows: formData.get("cash_block_after_no_shows"),
    file_retention_days: formData.get("file_retention_days"),
    payment_window_minutes: formData.get("payment_window_minutes"),
    round_to_rupee: formData.get("round_to_rupee") === "on",
    online_payments_enabled: formData.get("online_payments_enabled") === "on",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `${issue.path.join(".")}: ${issue.message}` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("app_settings").update(parsed.data).eq("id", 1).select("id");
  if (error || !data?.length) return { error: "Couldn't save settings. Only admins can change them." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addStaff(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = formData.get("role") === "admin" ? "admin" : "staff";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email." };

  const supabase = await createClient();
  const { error } = await supabase.from("staff_allowlist").upsert({ email, role }, { onConflict: "email" });
  if (error) return { error: "Couldn't add. Only admins can manage staff." };
  revalidatePath("/shop/settings");
  return { ok: true };
}

export async function removeStaff(email: string, selfEmail: string): Promise<SettingsState> {
  if (email === selfEmail) return { error: "You can't remove yourself." };
  const supabase = await createClient();
  const { error } = await supabase.from("staff_allowlist").delete().eq("email", email);
  if (error) return { error: "Couldn't remove." };
  revalidatePath("/shop/settings");
  return { ok: true };
}
