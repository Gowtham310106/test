import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson, requireUser } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";

const Subscribe = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** Saves this browser's push subscription for the signed-in user. */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await readJson(request, Subscribe);
  if (!body.ok) return body.response;

  // The same browser may have been used by someone else before; the endpoint
  // moves to whoever subscribed last.
  const { error } = await createAdminClient()
    .from("push_subscriptions")
    .upsert(
      {
        user_id: auth.userId,
        endpoint: body.data.endpoint,
        p256dh: body.data.keys.p256dh,
        auth: body.data.keys.auth,
        user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      },
      { onConflict: "endpoint" },
    );
  if (error) return jsonError("Couldn't turn on notifications.", 500);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await readJson(request, z.object({ endpoint: z.string().max(1000) }));
  if (!body.ok) return body.response;
  await auth.supabase.from("push_subscriptions").delete().eq("endpoint", body.data.endpoint);
  return NextResponse.json({ ok: true });
}
