import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError, jsonError, readJson, requireUser } from "@/lib/api";
import { checkoutFor, onlinePaymentsAvailable } from "@/lib/orders-server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppSettings, Order } from "@/lib/types";

const Item = z.object({
  fileId: z.uuid(),
  colorMode: z.enum(["bw", "color"]),
  rangeType: z.enum(["all", "from", "to", "range"]),
  pageFrom: z.number().int().positive().nullish(),
  pageTo: z.number().int().positive().nullish(),
  copies: z.number().int().min(1).max(500),
  manualPages: z.number().int().min(1).max(2000).nullish(),
});

const Body = z.object({
  paymentMethod: z.enum(["online", "cash"]),
  items: z.array(Item).min(1, "Add at least one file.").max(30),
  expectedAmountPaise: z.number().int().positive(),
  altContactName: z.string().max(80).nullish(),
  altContactPhone: z.string().max(20).nullish(),
  note: z.string().max(300, "Keep the note under 300 characters.").nullish(),
});

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await readJson(request, Body);
  if (!body.ok) return body.response;
  const input = body.data;

  const admin = createAdminClient();
  const { data: settings } = await admin.from("app_settings").select("*").eq("id", 1).single<AppSettings>();
  if (!settings) return jsonError("The service is not set up yet.", 503);
  if (input.paymentMethod === "online" && !onlinePaymentsAvailable(settings)) {
    return jsonError("Online payment is not available right now. Choose pay at shop.", 400);
  }

  // Runs as the student: the database checks ownership, limits and prices.
  const { data: order, error } = await auth.supabase
    .rpc("place_order", {
      p_payment_method: input.paymentMethod,
      p_items: input.items.map((i) => ({
        file_id: i.fileId,
        color_mode: i.colorMode,
        range_type: i.rangeType,
        page_from: i.pageFrom ?? null,
        page_to: i.pageTo ?? null,
        copies: i.copies,
        manual_pages: i.manualPages ?? null,
      })),
      p_expected_amount_paise: input.expectedAmountPaise,
      p_alt_contact_name: input.altContactName ?? null,
      p_alt_contact_phone: input.altContactPhone ?? null,
      p_note: input.note ?? null,
    })
    .single<Order>();
  if (error || !order) return dbError(error ?? { message: "UNKNOWN" });

  if (order.payment_method === "cash") {
    return NextResponse.json({ order });
  }

  try {
    const checkout = await checkoutFor(order, auth.profile, settings.shop_name);
    return NextResponse.json({ order, checkout });
  } catch (e) {
    console.error("creating the payment failed", e);
    // The order exists and waits for payment; the student can retry from its page.
    return NextResponse.json({ order, checkoutError: "Couldn't start the payment. Try again from the order page." });
  }
}
