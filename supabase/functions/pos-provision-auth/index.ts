// @ts-nocheck — Deno runtime, not Node.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * pos-provision-auth
 * ──────────────────
 * Ensures a Supabase Auth user exists for a POS shop so that
 * signInWithPassword() works and credit-sale RLS policies are satisfied.
 *
 * The auth user's UUID is set to the shop's UUID so that
 * auth.uid() = shop_id in every RLS policy.
 *
 * No supervisor token required — credentials are verified
 * via the pos_login SECURITY DEFINER RPC.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return ok({ ok: true });

  let body: { business_code: string; shop_code: string; password: string };
  try { body = await req.json(); } catch { return ok({ success: false, error: "Invalid JSON" }); }

  const { business_code, shop_code, password } = body ?? {};
  if (!business_code || !shop_code || !password) {
    return ok({ success: false, error: "Missing required fields: business_code, shop_code, password" });
  }

  // Verify credentials via pos_login (SECURITY DEFINER — no JWT needed)
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: loginData, error: loginErr } = await anon.rpc("pos_login", {
    p_business_code: business_code.trim().toUpperCase(),
    p_shop_code:     shop_code.trim().toUpperCase(),
    p_password:      password.trim(),
  });

  if (loginErr || loginData?.error) {
    return ok({ success: false, error: loginData?.error ?? loginErr?.message ?? "Invalid credentials" });
  }

  const shopId    = loginData.id as string;
  const ownerId   = loginData.owner_id as string;
  const shopEmail = `${shop_code.trim().toLowerCase()}@${business_code.trim().toLowerCase()}.pos`;

  const service = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Check if an auth user already exists with this exact UUID
  const { data: byIdData } = await service.auth.admin.getUserById(shopId);
  const existingById = byIdData?.user;

  if (existingById) {
    if (existingById.email === shopEmail) {
      // Perfect match — just sync the password
      await service.auth.admin.updateUserById(shopId, { password: password.trim() });
      return ok({ success: true, action: "password_synced" });
    }
    // UUID taken by a different email — delete it so we can recreate correctly
    await service.auth.admin.deleteUser(shopId);
  }

  // Check if a user with this email exists under a different UUID
  const { data: listData } = await service.auth.admin.listUsers({ perPage: 1000 });
  const byEmail = listData?.users?.find((u: { email?: string }) => u.email === shopEmail);
  if (byEmail && byEmail.id !== shopId) {
    await service.auth.admin.deleteUser(byEmail.id);
  }

  // Create auth user with id = shop_id so auth.uid() = shop_id in RLS
  const { error: createErr } = await service.auth.admin.createUser({
    id:            shopId,
    email:         shopEmail,
    password:      password.trim(),
    email_confirm: true,
    user_metadata: { role: "shop", shop_id: shopId, shop_code: shop_code.trim(), owner_id: ownerId },
  });

  if (createErr) return ok({ success: false, error: createErr.message });
  return ok({ success: true, action: "created" });
});

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
