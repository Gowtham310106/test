// Row shapes of the tables in supabase/migrations. Kept by hand; update both together.

export type UserRole = "student" | "staff" | "admin";
export type OrderStatus = "awaiting_payment" | "placed" | "taken" | "ready" | "collected" | "cancelled";
export type PaymentMethod = "online" | "cash";
export type PaymentStatus = "unpaid" | "paid" | "refund_pending" | "refunded";
export type ColorMode = "bw" | "color";
export type RangeType = "all" | "from" | "to" | "range";
export type FileKind = "pdf" | "docx" | "doc" | "image";
export type FileStatus = "pending" | "ready" | "rejected" | "deleted";
export type PageDetection = "pending" | "exact" | "estimate" | "none";
export type CancelCode = "student" | "shop" | "payment_timeout" | "not_collected" | "file_problem";
export type PagesSource = "exact" | "estimate" | "manual";

export interface AppSettings {
  id: 1;
  shop_name: string;
  accepting_orders: boolean;
  closed_message: string;
  allowed_email_domains: string[];
  departments: string[];
  timezone: string;
  max_file_mb: number;
  max_files_per_order: number;
  max_pages_per_order: number;
  max_copies: number;
  max_active_orders: number;
  max_unpaid_orders: number;
  cash_block_after_no_shows: number;
  file_retention_days: number;
  payment_window_minutes: number;
  round_to_rupee: boolean;
  online_payments_enabled: boolean;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string;
  role: UserRole;
  full_name: string | null;
  roll_number: string | null;
  department: string | null;
  section: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface PriceTier {
  id?: number;
  color_mode: ColorMode;
  min_pages: number;
  rate_cash_paise: number;
  rate_online_paise: number;
}

export interface FileRow {
  id: string;
  owner_id: string;
  object_key: string;
  original_name: string;
  mime_type: string;
  kind: FileKind;
  size_bytes: number;
  status: FileStatus;
  page_detection: PageDetection;
  detected_pages: number | null;
  is_encrypted: boolean;
  error: string | null;
  created_at: string;
  uploaded_at: string | null;
  deleted_at: string | null;
}

export interface Order {
  id: string;
  token: number;
  student_id: string;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  subtotal_paise: number;
  amount_paise: number;
  total_printed_pages: number;
  alt_contact_name: string | null;
  alt_contact_phone: string | null;
  note: string | null;
  created_at: string;
  queued_at: string | null;
  taken_at: string | null;
  taken_by: string | null;
  ready_at: string | null;
  collected_at: string | null;
  collected_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_code: CancelCode | null;
  cancel_reason: string | null;
  paid_at: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  refund_id: string | null;
  refund_error: string | null;
  rating: number | null;
  feedback: string | null;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  position: number;
  file_id: string;
  file_name: string;
  file_kind: FileKind;
  color_mode: ColorMode;
  range_type: RangeType;
  page_from: number;
  page_to: number;
  file_pages: number;
  pages_source: PagesSource;
  copies: number;
  printed_pages: number;
  rate_paise: number;
  amount_paise: number;
  downloaded_at: string | null;
}

export interface OrderEvent {
  id: number;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

/** What the browser needs to open Razorpay Checkout for an order. */
export interface CheckoutParams {
  keyId: string;
  razorpayOrderId: string;
  amountPaise: number;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
}

export const OPEN_STATUSES: OrderStatus[] = ["awaiting_payment", "placed", "taken", "ready"];

export function isProfileComplete(p: Pick<Profile, "role" | "full_name" | "roll_number" | "department" | "section" | "phone">) {
  if (!p.full_name) return false;
  if (p.role !== "student") return true;
  return Boolean(p.roll_number && p.department && p.section && p.phone);
}
