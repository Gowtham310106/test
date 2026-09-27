import { describe, expect, it } from "vitest";
import { friendlyError, errorStatus } from "./errors";
import { describeJob, describeRange, formatRupees } from "./format";

describe("formatRupees", () => {
  it("drops paise on whole rupees and uses Indian grouping", () => {
    expect(formatRupees(6200)).toBe("₹62");
    expect(formatRupees(85)).toBe("₹0.85");
    expect(formatRupees(12345600)).toBe("₹1,23,456");
  });
});

describe("describeJob", () => {
  it("matches how the shop reads instructions", () => {
    expect(describeRange("all", 1, 42, 42)).toBe("full file");
    expect(describeRange("from", 20, 42, 42)).toBe("from page 20");
    expect(describeRange("to", 1, 12, 42)).toBe("up to page 12");
    expect(describeRange("range", 5, 5, 42)).toBe("page 5");
    expect(
      describeJob({ color_mode: "bw", range_type: "range", page_from: 1, page_to: 30, file_pages: 42, copies: 2 }),
    ).toBe("B&W, pages 1–30, 2 copies");
    expect(describeJob({ color_mode: "color", range_type: "all", page_from: 1, page_to: 1, file_pages: 1, copies: 1 })).toBe(
      "Colour, 1 page, 1 copy",
    );
  });
});

describe("friendlyError", () => {
  it("maps database codes to messages and statuses", () => {
    expect(friendlyError({ message: "SHOP_CLOSED", details: "Closed for Pongal" })).toBe("Closed for Pongal");
    expect(friendlyError({ message: "TOO_MANY_ACTIVE_ORDERS", details: "5" })).toMatch(/5 open orders/);
    expect(errorStatus({ message: "STATUS_CHANGED" })).toBe(409);
    expect(errorStatus({ message: "FORBIDDEN" })).toBe(403);
    expect(errorStatus({ message: "duplicate key value violates unique constraint" })).toBe(500);
    expect(friendlyError({ message: "some internal error" })).toMatch(/Something went wrong/);
  });
});
