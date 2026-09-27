import type { Metadata } from "next";
import { getSettings, requireProfile } from "@/lib/data";
import { razorpayConfig } from "@/lib/env";
import type { UserRole } from "@/lib/types";
import { SettingsForm, StaffManager } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { supabase, profile } = await requireProfile({ admin: true });
  const settings = await getSettings();
  const { data: staff } = await supabase.from("staff_allowlist").select("email, role").order("email");
  if (!settings) return null;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <SettingsForm settings={settings} gatewayConfigured={razorpayConfig() !== null} />
      <StaffManager staff={(staff ?? []) as { email: string; role: UserRole }[]} selfEmail={profile.email} />
    </div>
  );
}
