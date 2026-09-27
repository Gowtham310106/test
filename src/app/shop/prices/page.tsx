import type { Metadata } from "next";
import { getPriceTiers, requireProfile } from "@/lib/data";
import { PriceEditor } from "./price-editor";

export const metadata: Metadata = { title: "Prices" };

export default async function PricesPage() {
  await requireProfile({ staff: true });
  const tiers = await getPriceTiers();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Prices</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Students see the exact total before ordering. Online rates can be a little higher so the payment gateway fee doesn&apos;t
          come out of the shop&apos;s share. Orders already placed keep the price they were placed at.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <PriceEditor mode="bw" tiers={tiers.filter((t) => t.color_mode === "bw")} />
        <PriceEditor mode="color" tiers={tiers.filter((t) => t.color_mode === "color")} />
      </div>
    </div>
  );
}
