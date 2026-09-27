import type { ColorMode, OrderStatus, PaymentMethod, PaymentStatus, RangeType } from "./types";

export function formatRupees(paise: number) {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Per-page rate, e.g. "₹1" or "₹0.85". */
export function formatRate(paise: number) {
  return formatRupees(paise);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const COLOR_LABEL: Record<ColorMode, string> = {
  bw: "B&W",
  color: "Colour",
};

export const STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: "Awaiting payment",
  placed: "Placed",
  taken: "Printing",
  ready: "Ready to collect",
  collected: "Collected",
  cancelled: "Cancelled",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  online: "Paid online",
  cash: "Pay at shop",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  paid: "Paid",
  refund_pending: "Refund pending",
  refunded: "Refunded",
};

/** "pages 1–30", "full file", "from page 20", "up to page 12". */
export function describeRange(rangeType: RangeType, from: number, to: number, filePages: number) {
  if (rangeType === "all" || (from === 1 && to === filePages)) {
    return filePages === 1 ? "1 page" : "full file";
  }
  if (rangeType === "from") return `from page ${from}`;
  if (rangeType === "to") return `up to page ${to}`;
  return from === to ? `page ${from}` : `pages ${from}–${to}`;
}

export function describeJob(item: {
  color_mode: ColorMode;
  range_type: RangeType;
  page_from: number;
  page_to: number;
  file_pages: number;
  copies: number;
}) {
  return `${COLOR_LABEL[item.color_mode]}, ${describeRange(item.range_type, item.page_from, item.page_to, item.file_pages)}, ${item.copies} ${item.copies === 1 ? "copy" : "copies"}`;
}

export function formatTime(iso: string, timeZone = "Asia/Kolkata") {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone });
}

export function formatDateTime(iso: string, timeZone = "Asia/Kolkata") {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

export function minutesSince(iso: string, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

export function formatAge(iso: string, now = Date.now()) {
  const m = minutesSince(iso, now);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min ago`;
  return `${Math.floor(h / 24)} d ago`;
}
