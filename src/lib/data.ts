import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isProfileComplete, type AppSettings, type PriceTier, type Profile } from "@/lib/types";

/** The signed-in user and profile for this request (null when signed out). */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = (data?.claims?.sub as string | undefined) ?? null;
  if (!userId) return { supabase, userId: null, profile: null };
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle<Profile>();
  return { supabase, userId, profile: profile ?? null };
});

/** For pages that need a signed-in user; redirects otherwise. */
export async function requireProfile(opts: { staff?: boolean; admin?: boolean; complete?: boolean } = {}) {
  const session = await getSession();
  if (!session.userId || !session.profile) redirect("/login");
  const profile = session.profile;
  if ((opts.complete ?? true) && !isProfileComplete(profile)) redirect("/onboarding");
  if ((opts.staff || opts.admin) && profile.role === "student") redirect("/orders");
  if (opts.admin && profile.role !== "admin") redirect("/shop");
  return { supabase: session.supabase, userId: session.userId, profile };
}

export const getSettings = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle<AppSettings>();
  return data;
});

export const getPriceTiers = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("price_tiers")
    .select("color_mode, min_pages, rate_cash_paise, rate_online_paise")
    .order("color_mode")
    .order("min_pages");
  return (data ?? []) as PriceTier[];
});

export function homePathFor(profile: Profile | null) {
  if (!profile) return "/login";
  if (!isProfileComplete(profile)) return "/onboarding";
  return profile.role === "student" ? "/orders" : "/shop";
}
