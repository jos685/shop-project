import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL        = import.meta.env.VITE_SUPABASE_URL         as string;

/**
 * Normalise a product image_url to a public Supabase storage URL.
 *
 * The POS app has no Supabase auth session, so any signed (/sign/) URL will
 * return 403 in production.  This helper rewrites those to the public
 * (/object/public/) path so images load for unauthenticated shop terminals.
 *
 * Requires the storage bucket to be set to PUBLIC in the Supabase dashboard.
 */
export function productImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Already a full public URL — return as-is
  if (raw.includes("/object/public/")) return raw;
  // Signed URL → rewrite to public path
  if (raw.includes("/object/sign/")) {
    return raw.replace("/object/sign/", "/object/public/").split("?")[0];
  }
  // Relative path (e.g. "products/abc.jpg") → build full public URL
  if (raw.startsWith("http")) return raw;
  return `${SUPABASE_URL}/storage/v1/object/public/${raw}`;
}
const SUPABASE_ANON_KEY   = import.meta.env.VITE_SUPABASE_ANON_KEY    as string;
const SUPABASE_SERVICE_KEY = import.meta.env.VITE_SUPABASE_SERVICE_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Bare anon client — never holds any auth session.
// Used for shop_transactions inserts so they always go through as anon role,
// matching the "anon insert shop_txns: with_check: true" policy.
export const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Service-role client — used ONLY to auto-provision shop auth users on first login.
export const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Types ────────────────────────────────────────────────────
export interface Shop {
  id: string;
  owner_id: string;
  shop_code: string;
  name: string;
  location: string;
  active: boolean;
  created_at: string;
}

export interface ShopAgent {
  id: string;
  shop_id: string;
  agent_id: string;
  owner_id: string;
  pin: string;
  active: boolean;
  agent?: { id: string; name: string; agent_id: string; avatar: string };
}

export interface ShopAllocation {
  id: string;
  shop_id: string;
  product_id: string;
  owner_id: string;
  allocated: number;
  remaining: number;
  updated_at: string;
  product?: Product;
}

export interface ShopTransaction {
  id: string;
  shop_id: string;
  owner_id: string;
  seller_agent_id: string | null;
  product_id: string | null;
  quantity: number;
  amount: number;
  customer_phone: string | null;
  payment_method: "cash" | "mpesa" | "split";
  cash_amount: number;
  mpesa_amount: number;
  mpesa_ref: string | null;
  status: string;
  created_at: string;
  product?: Product;
  seller?: { name: string; agent_id: string };
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  total_stock: number;
  unit: string;
  owner_id: string;
  image_url?: string | null;
}

// Shop session stored in localStorage
export interface ShopSession {
  id: string;
  shop_code: string;
  name: string;
  location: string;
  owner_id: string;
  /** False when manage-shop-auth was never called for this shop (legacy or provisioning failed).
   *  RLS-protected inserts will be blocked until the owner presses "🔐 Fix Auth". */
  authProvisioned?: boolean;
}
