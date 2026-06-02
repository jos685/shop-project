// @ts-nocheck — Deno runtime, not Node.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * insert-credit-sale
 * ──────────────────
 * Inserts a Pay Later / credit sale into shop_credit_sales using the
 * service role key so RLS is bypassed — identical pattern to the
 * insert_shop_transaction SECURITY DEFINER RPC used for regular sales.
 *
 * Also records the initial payment into shop_credit_payments (if any)
 * and calls insert_shop_transaction for the upfront portion.
 *
 * No auth token required from the POS — the shop_id + owner_id are
 * validated against the shops table before any insert is attempted.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS });
  }

  let body: {
    shop_id:         string;
    owner_id:        string;
    items:           unknown[];
    amount:          number;
    amount_paid:     number;
    customer_name:   string;
    customer_phone:  string;
    seller_agent_id: string;
    seller_name:     string;
    status:          string;
    // optional — only when amount_paid > 0
    initial_payment_method?: string;
    tx_row?: Record<string, unknown>;
  };

  try { body = await req.json(); } catch {
    return respond({ success: false, error: "Invalid JSON" });
  }

  const { shop_id, owner_id, items, amount, amount_paid,
          customer_name, customer_phone, seller_agent_id,
          seller_name, status } = body;

  if (!shop_id || !owner_id || !items || amount == null) {
    return respond({ success: false, error: "Missing required fields" });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify the shop exists and belongs to the stated owner (lightweight security check)
  const { data: shop, error: shopErr } = await db
    .from("shops")
    .select("id")
    .eq("id", shop_id)
    .eq("owner_id", owner_id)
    .single();

  if (shopErr || !shop) {
    return respond({ success: false, error: "Shop not found or owner mismatch" });
  }

  // Insert the credit sale
  const { data: creditData, error: creditErr } = await db
    .from("shop_credit_sales")
    .insert({
      shop_id, owner_id, items, amount, amount_paid,
      customer_name, customer_phone,
      seller_agent_id, seller_name, status,
    })
    .select()
    .single();

  if (creditErr) {
    return respond({ success: false, error: creditErr.message });
  }

  // Record initial payment if any
  if (amount_paid > 0 && creditData?.id && body.initial_payment_method) {
    await db.from("shop_credit_payments").insert({
      credit_sale_id: creditData.id,
      shop_id, owner_id,
      amount:         amount_paid,
      payment_method: body.initial_payment_method,
      mpesa_ref:      null,
    });
  }

  // Record shop_transaction for the upfront portion (so owner dashboard shows it).
  // p_rows must be an ARRAY — same as regular sales in PosScan.tsx.
  if (amount_paid > 0 && body.tx_row) {
    const { error: txErr } = await db.rpc("insert_shop_transaction", {
      p_rows: [{ ...body.tx_row, credit_sale_id: creditData.id }],
    });
    if (txErr) console.error("insert_shop_transaction error (credit partial):", txErr.message);
  }

  return respond({ success: true, data: creditData });
});

function respond(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
