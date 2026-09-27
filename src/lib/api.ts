import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { errorCode, errorStatus, friendlyError, type DbError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export function jsonError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function dbError(err: DbError) {
  const status = errorStatus(err);
  if (status === 500) console.error("database error", err);
  return jsonError(friendlyError(err), status, { code: errorCode(err), detail: err.details ?? null });
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false as const, response: jsonError("Invalid request.", 400) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false as const, response: jsonError(first?.message ?? "Invalid request.", 400) };
  }
  return { ok: true as const, data: parsed.data as z.infer<T> };
}

/** The signed-in user's client and profile, or an error response. */
export async function requireUser(opts: { staff?: boolean } = {}) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { ok: false as const, response: jsonError("Please sign in again.", 401) };

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).single<Profile>();
  if (!profile) return { ok: false as const, response: jsonError("Please sign in again.", 401) };
  if (opts.staff && profile.role === "student") {
    return { ok: false as const, response: jsonError("Only shop staff can do this.", 403) };
  }
  return { ok: true as const, supabase, profile, userId };
}
