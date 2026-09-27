import { NextResponse } from "next/server";
import { dbError, requireUser } from "@/lib/api";
import { processRefund } from "@/lib/orders-server";
import type { Order } from "@/lib/types";

export async function POST(_request: Request, ctx: RouteContext<"/api/orders/[id]/cancel">) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data: order, error } = await auth.supabase.rpc("cancel_my_order", { p_order_id: id }).single<Order>();
  if (error || !order) return dbError(error ?? { message: "UNKNOWN" });

  return NextResponse.json({ order: await processRefund(order) });
}
