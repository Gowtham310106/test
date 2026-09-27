"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export interface ProfileState {
  error?: string;
  saved?: boolean;
}

export async function saveProfileAction(_state: ProfileState, formData: FormData): Promise<ProfileState> {
  const supabase = await createClient();
  const field = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() ? v : null;
  };

  const { data, error } = await supabase
    .rpc("save_profile", {
      p_full_name: field("full_name"),
      p_roll_number: field("roll_number"),
      p_department: field("department"),
      p_section: field("section"),
      p_phone: field("phone"),
    })
    .single<Profile>();
  if (error || !data) return { error: friendlyError(error) };

  revalidatePath("/", "layout");
  if (formData.get("redirect") === "1") redirect(data.role === "student" ? "/orders/new" : "/shop");
  return { saved: true };
}
