import type { ShopSession } from "./supabase";

const OFFLINE_AUTH_KEY = "qashup_pos_offline_auth_v1";

interface PosAuthCache {
  identifier: string;  // "businessCode:shopCode" lower-cased
  hash: string;        // SHA-256 of password
  session: string;     // JSON-serialised ShopSession
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function cachePosOfflineAuth(
  businessCode: string,
  shopCode: string,
  password: string,
  session: ShopSession,
): Promise<void> {
  const identifier = `${businessCode.toLowerCase()}:${shopCode.toLowerCase()}`;
  const hash = await sha256(password);
  const entry: PosAuthCache = { identifier, hash, session: JSON.stringify(session) };
  localStorage.setItem(OFFLINE_AUTH_KEY, JSON.stringify(entry));
}

export type OfflineVerifyResult =
  | { ok: true;  session: ShopSession }
  | { ok: false; reason: "no_cache" | "wrong_shop" | "wrong_password" };

export async function verifyPosOfflineCredentials(
  businessCode: string,
  shopCode: string,
  password: string,
): Promise<ShopSession | null> {
  const r = await verifyPosOfflineCredentialsDetailed(businessCode, shopCode, password);
  return r.ok ? r.session : null;
}

export async function verifyPosOfflineCredentialsDetailed(
  businessCode: string,
  shopCode: string,
  password: string,
): Promise<OfflineVerifyResult> {
  try {
    const raw = localStorage.getItem(OFFLINE_AUTH_KEY);
    if (!raw) return { ok: false, reason: "no_cache" };
    const entry: PosAuthCache = JSON.parse(raw);
    const identifier = `${businessCode.toLowerCase()}:${shopCode.toLowerCase()}`;
    if (entry.identifier !== identifier) return { ok: false, reason: "wrong_shop" };
    const hash = await sha256(password);
    if (entry.hash !== hash) return { ok: false, reason: "wrong_password" };
    return { ok: true, session: JSON.parse(entry.session) as ShopSession };
  } catch {
    return { ok: false, reason: "no_cache" };
  }
}

export function clearPosOfflineAuth(): void {
  localStorage.removeItem(OFFLINE_AUTH_KEY);
}
