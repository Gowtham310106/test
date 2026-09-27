import { NextResponse } from "next/server";
import { cronSecret } from "@/lib/env";
import { deleteObjects } from "@/lib/r2";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Scheduled housekeeping (see vercel.json / README):
 *   1. cancel online orders whose payment window ran out
 *   2. delete files past the retention period from R2
 * Protected by CRON_SECRET, sent as "Authorization: Bearer <secret>".
 */
async function handle(request: Request) {
  const secret = cronSecret();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: expired, error: expireError } = await admin.rpc("expire_stale_payments", { p_student_id: null });
  if (expireError) console.error("expire_stale_payments failed", expireError);

  let deleted = 0;
  let failed = 0;
  // A few rounds per run keeps each run short even after a long outage.
  for (let round = 0; round < 5; round++) {
    const { data: due, error } = await admin.rpc("files_due_for_deletion", { p_limit: 500 });
    if (error) {
      console.error("files_due_for_deletion failed", error);
      break;
    }
    const files = (due ?? []) as { id: string; object_key: string }[];
    if (files.length === 0) break;

    const failedKeys = new Set(await deleteObjects(files.map((f) => f.object_key)));
    const done = files.filter((f) => !failedKeys.has(f.object_key)).map((f) => f.id);
    failed += failedKeys.size;
    if (done.length) {
      const { data: count } = await admin.rpc("mark_files_deleted", { p_ids: done });
      deleted += (count as number) ?? 0;
    }
    if (done.length === 0) break;
  }

  return NextResponse.json({ expiredOrders: expired ?? 0, deletedFiles: deleted, failedFiles: failed });
}

export const GET = handle;
export const POST = handle;
