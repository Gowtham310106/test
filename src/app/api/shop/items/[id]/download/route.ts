import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";
import { presignDownload } from "@/lib/r2";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Staff download of one file on an order. Redirects to a short-lived R2 link
 * named "<token>-<n>-<original name>" so files on the shop PC match the queue.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/shop/items/[id]/download">) {
  const { id } = await ctx.params;
  const auth = await requireUser({ staff: true });
  if (!auth.ok) return auth.response;

  const { data: item } = await auth.supabase
    .from("order_items")
    .select("id, position, file_name, order:orders!inner(token), file:files!inner(object_key, status)")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      position: number;
      file_name: string;
      order: { token: number };
      file: { object_key: string; status: string };
    }>();
  if (!item) return jsonError("File not found.", 404);
  if (item.file.status !== "ready") {
    return jsonError("This file has been removed (files are deleted automatically after the retention period).", 410);
  }

  const url = await presignDownload(item.file.object_key, `${item.order.token}-${item.position}-${item.file_name}`);
  await createAdminClient().from("order_items").update({ downloaded_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.redirect(url, 303);
}
