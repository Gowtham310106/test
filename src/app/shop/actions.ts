"use server";

import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ColorMode } from "@/lib/types";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function setAcceptingOrders(accepting: boolean, message: string | null): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_accepting_orders", { p_accepting: accepting, p_message: message });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

export interface TierInput {
  min_pages: number;
  rate_cash_paise: number;
  rate_online_paise: number;
}

export async function savePriceTiers(mode: ColorMode, tiers: TierInput[]): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_price_tiers", { p_color_mode: mode, p_tiers: tiers });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}
