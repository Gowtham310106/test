import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError, readJson, requireUser } from "@/lib/api";
import { notifyStatusChange, processRefund } from "@/lib/orders-server";
import type { Order } from "@/lib/types";

const Status = z.enum(["awaiting_payment", "placed", "taken", "ready", "collected", "cancelled"]);

const Body = z.object({
  to: Status,
  expectedFrom: Status,
  cashReceived: z.boolean().optional(),
  cancelCode: z.enum(["shop", "not_collected", "file_problem"]).optional(),
  reason: z.string().max(200).optional(),
});

/** Staff moves an order along: take, release, ready, collect, cancel, undo. */
export async function POST(request: Request, ctx: RouteContext<"/api/shop/orders/[id]">) {
  const { id } = await ctx.params;
  const auth = await requireUser({ staff: true });
  if (!auth.ok) return auth.response;
  const body = await readJson(request, Body);
  if (!body.ok) return body.response;
  const b = body.data;

  const { data: order, error } = await auth.supabase
    .rpc("staff_transition_order", {
      p_order_id: id,
      p_to: b.to,
      p_expected_from: b.expectedFrom,
      p_cash_received: b.cashReceived ?? false,
      p_cancel_code: b.to === "cancelled" ? (b.cancelCode ?? "shop") : null,
      p_reason: b.reason ?? null,
    })
    .single<Order>();
  if (error || !order) return dbError(error ?? { message: "UNKNOWN" });

  const final = await processRefund(order);
  // Tell the student when prints become ready or the order is cancelled (not on undo/reprint).
  if ((b.to === "ready" && b.expectedFrom === "taken") || b.to === "cancelled") await notifyStatusChange(final);
  return NextResponse.json({ order: final });
}
