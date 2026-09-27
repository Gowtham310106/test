// Database functions raise short codes (see supabase/migrations). This turns
// them into messages students and staff can act on.

const MESSAGES: Record<string, string | ((detail: string | null) => string)> = {
  NOT_AUTHENTICATED: "Please sign in again.",
  FORBIDDEN: "You don't have access to this.",
  EMAIL_NOT_ALLOWED: "Only college email addresses can use this service.",
  PROFILE_NOT_FOUND: "We couldn't find your profile. Please sign in again.",
  PROFILE_INCOMPLETE: "Please complete your profile first.",
  INVALID_NAME: "Enter your full name (2–80 characters).",
  INVALID_PHONE: "Enter a valid 10-digit mobile number.",
  INVALID_ROLL_NUMBER: "Enter your roll number using letters and numbers only.",
  INVALID_DEPARTMENT: "Choose your department.",
  INVALID_SECTION: "Enter your section.",
  ROLL_NUMBER_LOCKED: "Your roll number can't be changed. Ask the shop if it is wrong.",
  ROLL_NUMBER_TAKEN: "This roll number is already registered to another account. Please contact the shop.",
  SHOP_CLOSED: (d) => d || "The shop is not taking orders right now.",
  ONLINE_PAYMENT_DISABLED: "Online payment is not available right now. Choose pay at shop.",
  CASH_DISABLED: "Pay at shop is not available right now. Please pay online.",
  CASH_BLOCKED: "Pay at shop is turned off for your account because earlier orders were not collected. Please pay online.",
  TOO_MANY_ACTIVE_ORDERS: (d) => `You already have ${d ?? "the maximum number of"} open orders. Collect or cancel one first.`,
  TOO_MANY_UNPAID_ORDERS: (d) =>
    `You already have ${d ?? "the maximum number of"} unpaid orders. Pay online, or collect those first.`,
  INVALID_ALT_CONTACT: "Check the alternate contact's name and 10-digit mobile number.",
  NOTE_TOO_LONG: "Keep the note under 300 characters.",
  NO_ITEMS: "Add at least one file.",
  TOO_MANY_FILES: (d) => `One order can have at most ${d ?? "10"} files.`,
  FILE_NOT_READY: (d) => `File ${d ?? ""} is not ready yet. Wait for the upload to finish or upload it again.`.replace("  ", " "),
  INVALID_COPIES: (d) => `Copies must be between 1 and ${d ?? "50"}.`,
  INVALID_PAGE_COUNT: "Enter a page count between 1 and 2000.",
  PAGES_REQUIRED: (d) => `Enter the number of pages for file ${d ?? ""}.`,
  INVALID_PAGE_RANGE: (d) => `Check the page range for file ${d ?? ""}.`,
  ORDER_TOO_LARGE: (d) => `One order can have at most ${d ?? "2000"} printed pages. Split it into two orders.`,
  PRICING_NOT_CONFIGURED: "Prices are not set up yet. Please ask the shop.",
  PRICE_CHANGED: "The shop just updated its prices. Check the new total and place the order again.",
  NO_TOKENS_AVAILABLE: "The shop has too many open orders right now. Please try again later.",
  ORDER_NOT_FOUND: "Order not found.",
  CANNOT_CANCEL: "The shop has already started on this order, so it can't be cancelled here. Please talk to the shop.",
  STATUS_CHANGED: (d) => `Someone else already updated this order${d ? ` (now: ${d})` : ""}. The list has been refreshed.`,
  INVALID_TRANSITION: "That action isn't possible for this order any more.",
  UNDO_WINDOW_PASSED: "It's too late to undo this hand-over.",
  PAYMENT_PENDING: "Collect the payment before handing over.",
  INVALID_CANCEL_CODE: "Choose a reason for cancelling.",
  REASON_TOO_LONG: "Keep the reason under 200 characters.",
  AMOUNT_MISMATCH: "The payment amount did not match the order.",
  INVALID_RATING: "Choose a rating from 1 to 5.",
  FEEDBACK_TOO_LONG: "Keep feedback under 500 characters.",
  INVALID_PRICE_TIERS: (d) => d || "Check the prices.",
};

export interface DbError {
  message?: string;
  details?: string | null;
  hint?: string | null;
  code?: string;
}

export function errorCode(err: DbError | null | undefined) {
  const code = err?.message ?? "";
  return /^[A-Z_]+$/.test(code) ? code : null;
}

export function friendlyError(err: DbError | null | undefined, fallback = "Something went wrong. Please try again.") {
  const code = errorCode(err);
  if (code && MESSAGES[code]) {
    const m = MESSAGES[code];
    return typeof m === "function" ? m(err?.details ?? null) : m;
  }
  if (err?.hint) return err.hint;
  return fallback;
}

/** HTTP status for a database error code. */
export function errorStatus(err: DbError | null | undefined) {
  const code = errorCode(err);
  switch (code) {
    case "NOT_AUTHENTICATED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "ORDER_NOT_FOUND":
    case "PROFILE_NOT_FOUND":
      return 404;
    case "STATUS_CHANGED":
    case "PRICE_CHANGED":
      return 409;
    case null:
      return 500;
    default:
      return 400;
  }
}
