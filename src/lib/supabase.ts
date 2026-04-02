import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
}

// Shop session stored in localStorage
export interface ShopSession {
  id: string;
  shop_code: string;
  name: string;
  location: string;
  owner_id: string;
}
