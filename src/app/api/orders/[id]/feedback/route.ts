import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError, readJson, requireUser } from "@/lib/api";
import type { Order } from "@/lib/types";

const Body = z.object({
  rating: z.number().int().min(1).max(5),
  feedback: z.string().max(500).nullish(),
});

export async function POST(request: Request, ctx: RouteContext<"/api/orders/[id]/feedback">) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await readJson(request, Body);
  if (!body.ok) return body.response;

  const { data: order, error } = await auth.supabase
    .rpc("rate_order", { p_order_id: id, p_rating: body.data.rating, p_feedback: body.data.feedback ?? null })
    .single<Order>();
  if (error || !order) return dbError(error ?? { message: "UNKNOWN" });
  return NextResponse.json({ order });
}
