"use server";

import { redirect } from "next/navigation";
import { siteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export interface LoginState {
  step: "email" | "code";
  email: string;
  error?: string;
  info?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeNext(next: FormDataEntryValue | null) {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

/** Two steps on one form: send a code to the email, then check the code. */
export async function loginAction(state: LoginState, formData: FormData): Promise<LoginState> {
  const intent = formData.get("intent");
  const supabase = await createClient();

  if (intent === "restart") return { step: "email", email: state.email };

  if (intent === "send" || intent === "resend") {
    const email = String(formData.get("email") ?? state.email)
      .trim()
      .toLowerCase();
    if (!EMAIL.test(email)) return { step: "email", email, error: "Enter a valid email address." };

    const { data: allowed, error: checkError } = await supabase.rpc("email_domain_allowed", { p_email: email });
    if (checkError) return { step: "email", email, error: "Sign-in is unavailable right now. Please try again." };
    if (!allowed) {
      return { step: "email", email, error: "Use your college email address. Outside emails can't place orders." };
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: `${siteUrl()}/auth/confirm` },
    });
    if (error) {
      const tooMany = error.status === 429 || /rate limit|security purposes/i.test(error.message);
      return {
        step: intent === "resend" ? "code" : "email",
        email,
        error: tooMany
          ? "Too many attempts. Please wait a minute before asking for another code."
          : "We couldn't send the email. Check the address and try again.",
      };
    }
    return {
      step: "code",
      email,
      info: intent === "resend" ? "A new code is on its way." : undefined,
    };
  }

  if (intent === "verify") {
    const token = String(formData.get("code") ?? "").replace(/\D/g, "");
    if (token.length < 6 || token.length > 10) {
      return { ...state, step: "code", error: "Enter the code from the email." };
    }
    const { error } = await supabase.auth.verifyOtp({ email: state.email, token, type: "email" });
    if (error) {
      return { ...state, step: "code", info: undefined, error: "That code is wrong or has expired. Try again or get a new code." };
    }
    redirect(safeNext(formData.get("next")));
  }

  return state;
}
