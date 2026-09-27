import { describe, expect, it } from "vitest";
import { computeQuote, resolveRange, selectTier } from "./pricing";
import type { PriceTier } from "./types";

const TIERS: PriceTier[] = [
  { color_mode: "bw", min_pages: 1, rate_cash_paise: 100, rate_online_paise: 105 },
  { color_mode: "bw", min_pages: 100, rate_cash_paise: 80, rate_online_paise: 85 },
  { color_mode: "color", min_pages: 1, rate_cash_paise: 1000, rate_online_paise: 1030 },
  { color_mode: "color", min_pages: 20, rate_cash_paise: 800, rate_online_paise: 825 },
];

const opts = { roundToRupee: true, maxCopies: 50, maxPagesPerOrder: 2000 };

describe("resolveRange", () => {
  it("handles the four page modes", () => {
    expect(resolveRange(42, "all")).toEqual({ from: 1, to: 42 });
    expect(resolveRange(42, "from", 20)).toEqual({ from: 20, to: 42 });
    expect(resolveRange(42, "to", null, 12)).toEqual({ from: 1, to: 12 });
    expect(resolveRange(42, "range", 1, 30)).toEqual({ from: 1, to: 30 });
    expect(resolveRange(42, "range", 7, 7)).toEqual({ from: 7, to: 7 });
  });

  it("rejects impossible ranges", () => {
    expect(resolveRange(42, "range", 30, 1)).toHaveProperty("error");
    expect(resolveRange(42, "range", 0, 5)).toHaveProperty("error");
    expect(resolveRange(42, "to", null, 43)).toHaveProperty("error");
    expect(resolveRange(42, "from", 43)).toHaveProperty("error");
    expect(resolveRange(42, "from", null)).toHaveProperty("error");
    expect(resolveRange(42, "range", 1.5, 3)).toHaveProperty("error");
  });
});

describe("selectTier", () => {
  it("picks the highest threshold reached", () => {
    expect(selectTier(TIERS, "bw", 1)?.min_pages).toBe(1);
    expect(selectTier(TIERS, "bw", 99)?.min_pages).toBe(1);
    expect(selectTier(TIERS, "bw", 100)?.min_pages).toBe(100);
    expect(selectTier(TIERS, "color", 19)?.min_pages).toBe(1);
    expect(selectTier(TIERS, "color", 20)?.min_pages).toBe(20);
  });

  it("returns null when no tier starts low enough", () => {
    expect(selectTier([{ color_mode: "bw", min_pages: 10, rate_cash_paise: 1, rate_online_paise: 1 }], "bw", 5)).toBeNull();
  });
});

describe("computeQuote", () => {
  it("prices the proposal's example order (pages 1–30, 2 copies)", () => {
    const q = computeQuote([{ filePages: 42, colorMode: "bw", rangeType: "range", pageFrom: 1, pageTo: 30, copies: 2 }], TIERS, "cash", opts);
    expect(q.valid).toBe(true);
    expect(q.pages.bw).toBe(60);
    expect(q.items[0]).toMatchObject({ selectedPages: 30, printedPages: 60, ratePaise: 100, amountPaise: 6000 });
    expect(q.totalPaise).toBe(6000);
  });

  it("uses the online rate for online payment and rounds up to the rupee", () => {
    const q = computeQuote([{ filePages: 42, colorMode: "bw", rangeType: "range", pageFrom: 1, pageTo: 30, copies: 2 }], TIERS, "online", opts);
    expect(q.subtotalPaise).toBe(6300);
    expect(q.totalPaise).toBe(6300);
    const odd = computeQuote([{ filePages: 3, colorMode: "bw", rangeType: "all", copies: 1 }], TIERS, "online", opts);
    expect(odd.subtotalPaise).toBe(315);
    expect(odd.totalPaise).toBe(400);
    expect(odd.roundingPaise).toBe(85);
  });

  it("keeps paise when rounding is off", () => {
    const q = computeQuote([{ filePages: 3, colorMode: "bw", rangeType: "all", copies: 1 }], TIERS, "online", { ...opts, roundToRupee: false });
    expect(q.totalPaise).toBe(315);
  });

  it("applies bulk tiers across the whole order, per colour mode", () => {
    const q = computeQuote(
      [
        { filePages: 60, colorMode: "bw", rangeType: "all", copies: 1 },
        { filePages: 40, colorMode: "bw", rangeType: "all", copies: 1 },
        { filePages: 5, colorMode: "color", rangeType: "all", copies: 1 },
      ],
      TIERS,
      "cash",
      opts,
    );
    expect(q.pages).toEqual({ bw: 100, color: 5 });
    expect(q.rates).toEqual({ bw: 80, color: 1000 });
    expect(q.totalPaise).toBe(100 * 80 + 5 * 1000);
  });

  it("reports per-item errors without breaking the others", () => {
    const q = computeQuote(
      [
        { filePages: 10, colorMode: "bw", rangeType: "all", copies: 1 },
        { filePages: 10, colorMode: "bw", rangeType: "range", pageFrom: 8, pageTo: 3, copies: 1 },
        { filePages: null, colorMode: "bw", rangeType: "all", copies: 1 },
        { filePages: 10, colorMode: "bw", rangeType: "all", copies: 0 },
        { filePages: 10, colorMode: "bw", rangeType: "all", copies: 51 },
      ],
      TIERS,
      "cash",
      opts,
    );
    expect(q.valid).toBe(false);
    expect(q.errors[0]).toBeNull();
    expect(q.errors.slice(1).every(Boolean)).toBe(true);
    expect(q.totalPaise).toBe(1000);
  });

  it("flags orders over the page limit and missing prices", () => {
    const big = computeQuote([{ filePages: 1500, colorMode: "bw", rangeType: "all", copies: 2 }], TIERS, "cash", opts);
    expect(big.valid).toBe(false);
    expect(big.orderError).toMatch(/at most 2000/);

    const noColour = computeQuote(
      [{ filePages: 1, colorMode: "color", rangeType: "all", copies: 1 }],
      TIERS.filter((t) => t.color_mode === "bw"),
      "cash",
      opts,
    );
    expect(noColour.valid).toBe(false);
    expect(noColour.orderError).toMatch(/not set up/);
  });

  it("is invalid for an empty order", () => {
    expect(computeQuote([], TIERS, "cash", opts).valid).toBe(false);
  });
});
