// Environment access in one place. Optional integrations (payments, push)
// switch themselves off when their keys are missing instead of crashing.

function required(name: string, value: string | undefined) {
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export function supabaseUrl() {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabasePublishableKey() {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function supabaseSecretKey() {
  return required("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function r2Config() {
  return {
    accountId: required("R2_ACCOUNT_ID", process.env.R2_ACCOUNT_ID),
    accessKeyId: required("R2_ACCESS_KEY_ID", process.env.R2_ACCESS_KEY_ID),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY", process.env.R2_SECRET_ACCESS_KEY),
    bucket: required("R2_BUCKET", process.env.R2_BUCKET),
  };
}

export function razorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? null };
}

export function vapidConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT ?? `${siteUrl()}` };
}

export function cronSecret() {
  return process.env.CRON_SECRET ?? null;
}
