import type { ColorMode, PaymentMethod, PriceTier, RangeType } from "./types";

// Mirrors the pricing in public.place_order() so students see the exact
// amount before submitting. The database stays the source of truth; the
// parity test in supabase/tests keeps the two in step.

export interface QuoteItemInput {
  filePages: number | null;
  colorMode: ColorMode;
  rangeType: RangeType;
  pageFrom?: number | null;
  pageTo?: number | null;
  copies: number;
}

export interface QuoteItem {
  pageFrom: number;
  pageTo: number;
  selectedPages: number;
  printedPages: number;
  ratePaise: number;
  amountPaise: number;
}

export interface Quote {
  items: (QuoteItem | null)[];
  errors: (string | null)[];
  pages: Record<ColorMode, number>;
  rates: Record<ColorMode, number | null>;
  subtotalPaise: number;
  totalPaise: number;
  roundingPaise: number;
  /** Problem with the order as a whole (e.g. too many pages). */
  orderError: string | null;
  valid: boolean;
}

export type RangeResult = { from: number; to: number } | { error: string };

export function resolveRange(
  filePages: number,
  rangeType: RangeType,
  pageFrom?: number | null,
  pageTo?: number | null,
): RangeResult {
  let from: number | null | undefined;
  let to: number | null | undefined;
  switch (rangeType) {
    case "all":
      from = 1;
      to = filePages;
      break;
    case "from":
      from = pageFrom;
      to = filePages;
      break;
    case "to":
      from = 1;
      to = pageTo;
      break;
    case "range":
      from = pageFrom;
      to = pageTo;
      break;
  }
  if (from == null || to == null || !Number.isInteger(from) || !Number.isInteger(to)) {
    return { error: "Enter the page numbers." };
  }
  if (from < 1) return { error: "Pages start at 1." };
  if (to > filePages) return { error: `This file has only ${filePages} page${filePages === 1 ? "" : "s"}.` };
  if (from > to) return { error: "The start page is after the end page." };
  return { from, to };
}

/** The tier with the highest threshold the page count reaches. */
export function selectTier(tiers: PriceTier[], mode: ColorMode, printedPages: number): PriceTier | null {
  let best: PriceTier | null = null;
  for (const t of tiers) {
    if (t.color_mode !== mode || t.min_pages > printedPages) continue;
    if (!best || t.min_pages > best.min_pages) best = t;
  }
  return best;
}

export function rateFor(tier: PriceTier, method: PaymentMethod) {
  return method === "online" ? tier.rate_online_paise : tier.rate_cash_paise;
}

export function computeQuote(
  inputs: QuoteItemInput[],
  tiers: PriceTier[],
  method: PaymentMethod,
  opts: { roundToRupee: boolean; maxCopies?: number; maxPagesPerOrder?: number },
): Quote {
  const pages: Record<ColorMode, number> = { bw: 0, color: 0 };
  const errors: (string | null)[] = [];
  const resolved: ({ from: number; to: number; printed: number; mode: ColorMode } | null)[] = [];

  for (const input of inputs) {
    if (!input.filePages || input.filePages < 1) {
      errors.push("Enter the number of pages in this file.");
      resolved.push(null);
      continue;
    }
    if (!Number.isInteger(input.copies) || input.copies < 1 || (opts.maxCopies && input.copies > opts.maxCopies)) {
      errors.push(opts.maxCopies ? `Copies must be between 1 and ${opts.maxCopies}.` : "At least 1 copy.");
      resolved.push(null);
      continue;
    }
    const range = resolveRange(input.filePages, input.rangeType, input.pageFrom, input.pageTo);
    if ("error" in range) {
      errors.push(range.error);
      resolved.push(null);
      continue;
    }
    const printed = (range.to - range.from + 1) * input.copies;
    pages[input.colorMode] += printed;
    errors.push(null);
    resolved.push({ ...range, printed, mode: input.colorMode });
  }

  const rates: Record<ColorMode, number | null> = { bw: null, color: null };
  for (const mode of ["bw", "color"] as const) {
    if (pages[mode] > 0) {
      const tier = selectTier(tiers, mode, pages[mode]);
      rates[mode] = tier ? rateFor(tier, method) : null;
    }
  }

  let subtotal = 0;
  const items = resolved.map((r) => {
    if (!r) return null;
    const rate = rates[r.mode];
    if (rate == null) return null;
    const amount = r.printed * rate;
    subtotal += amount;
    return {
      pageFrom: r.from,
      pageTo: r.to,
      selectedPages: r.to - r.from + 1,
      printedPages: r.printed,
      ratePaise: rate,
      amountPaise: amount,
    };
  });

  const total = opts.roundToRupee ? Math.ceil(subtotal / 100) * 100 : subtotal;
  const pricingMissing = (["bw", "color"] as const).some((m) => pages[m] > 0 && rates[m] == null);
  let orderError: string | null = null;
  if (pricingMissing) orderError = "Prices are not set up yet. Please ask the shop.";
  else if (opts.maxPagesPerOrder && pages.bw + pages.color > opts.maxPagesPerOrder) {
    orderError = `One order can have at most ${opts.maxPagesPerOrder} printed pages. Split it into two orders.`;
  }

  return {
    items,
    errors,
    pages,
    rates,
    subtotalPaise: subtotal,
    totalPaise: total,
    roundingPaise: total - subtotal,
    orderError,
    valid: inputs.length > 0 && errors.every((e) => e === null) && !orderError && subtotal > 0,
  };
}
