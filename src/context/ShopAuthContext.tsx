import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { supabase, supabaseAdmin } from "../lib/supabase";
import type { ShopSession } from "../lib/supabase";
import type { ReactNode } from "react";
import { cachePosOfflineAuth, verifyPosOfflineCredentialsDetailed } from "../lib/offlineAuth";

interface ShopAuthContextType {
  shop: ShopSession | null;
  loading: boolean;
  isOfflineMode: boolean;
  /** True only when a real Supabase Auth JWT is active for this shop.
   *  False means RLS-protected inserts will fail — user must log out and back in. */
  hasAuthSession: boolean;
  login: (businessCode: string, shopCode: string, password: string) => Promise<string | null>;
  logout: () => void;
  /** Tries to refresh the Supabase JWT; returns true if session is now valid. */
  refreshAuthSession: () => Promise<boolean>;
}

const ShopAuthContext = createContext<ShopAuthContextType | null>(null);

const SESSION_KEY    = "pos_shop_session";
const TIMEOUT_MS     = 30 * 60 * 1000; // 30 minutes of inactivity
const CHECK_INTERVAL = 60 * 1000;       // check every minute

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export function ShopAuthProvider({ children }: { children: ReactNode }) {
  const [shop, setShop] = useState<ShopSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  // Seed from the stored session flag (fast, synchronous) then keep live with onAuthStateChange
  const storedSession = (() => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null"); } catch { return null; }
  })();
  const [hasAuthSession, setHasAuthSession] = useState<boolean>(
    storedSession?.authProvisioned === true
  );
  const lastActivityRef   = useRef<number>(Date.now());
  const sessionTokenRef   = useRef<string | null>(null);  // kept in sync for use in beforeunload

  // Keep sessionTokenRef + hasAuthSession in sync with Supabase auth state.
  // Also write authProvisioned=true into localStorage whenever a real session appears,
  // so the setup banner never re-surfaces after a successful auth fix.
  useEffect(() => {
    const markProvisioned = () => {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        if (!s?.authProvisioned) {
          localStorage.setItem(SESSION_KEY, JSON.stringify({ ...s, authProvisioned: true }));
          // Also update React state so the banner condition re-evaluates immediately.
          setShop(prev => prev ? { ...prev, authProvisioned: true } : prev);
        }
      } catch { /* ignore */ }
    };

    // Seed initial value from whatever Supabase already has in storage
    supabase.auth.getSession().then(({ data }) => {
      const has = !!data?.session;
      setHasAuthSession(has);
      sessionTokenRef.current = data?.session?.access_token ?? null;
      if (has) markProvisioned();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      sessionTokenRef.current = session?.access_token ?? null;
      setHasAuthSession(!!session);
      if (session) markProvisioned();
    });
    return () => subscription.unsubscribe();
  }, []);

  /** Re-checks with the Supabase server that the JWT is still valid.
   *  Returns true if a usable session is active after the attempt. */
  const refreshAuthSession = useCallback(async (): Promise<boolean> => {
    const { data, error } = await supabase.auth.refreshSession();
    const ok = !error && !!data?.session;
    setHasAuthSession(ok);
    return ok;
  }, []);

  // Fire-and-forget: set shops.last_seen = null via keepalive fetch
  // Works both during normal operation and during tab close (beforeunload)
  const clearLastSeen = useCallback((shopId: string) => {
    const token = sessionTokenRef.current ?? SUPABASE_ANON_KEY;
    fetch(`${SUPABASE_URL}/rest/v1/shops?id=eq.${shopId}`, {
      method: "PATCH",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${token}`,
        "Prefer":        "return=minimal",
      },
      body:      JSON.stringify({ last_seen: null }),
      keepalive: true, // completes even if the page is closing
    }).catch(() => {});
  }, []);

  const logout = useCallback(() => {
    // Clear presence immediately so the owner dashboard stops showing this shop as online
    setShop(current => {
      if (current) clearLastSeen(current.id);
      return null;
    });
    localStorage.removeItem(SESSION_KEY);
    setIsOfflineMode(false);
    // Sign out from Supabase Auth so the JWT is revoked server-side.
    // The POS gained a real Auth session via signInWithPassword on login;
    // without this call the token stays valid until expiry (~1 h).
    supabase.auth.signOut().catch(() => {});
  }, [clearLastSeen]);

  // Reset the inactivity clock on any user interaction
  useEffect(() => {
    const touch = () => { lastActivityRef.current = Date.now(); };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    events.forEach(e => document.addEventListener(e, touch, { passive: true }));
    return () => events.forEach(e => document.removeEventListener(e, touch));
  }, []);

  // Clear last_seen when the tab/browser closes — prevents ghost "ONLINE" status
  useEffect(() => {
    if (!shop) return;
    const handleBeforeUnload = () => clearLastSeen(shop.id);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [shop, clearLastSeen]);

  // Update shops.last_seen so the owner dashboard can detect this shop as online
  const pingLastSeen = useCallback(async (shopId: string) => {
    await supabase.rpc("ping_shop_presence", { p_shop_id: shopId });
  }, []);

  // Check for inactivity every minute — auto-logout when session exists, also heartbeat last_seen
  useEffect(() => {
    const timer = setInterval(() => {
      setShop(current => {
        if (!current) return current;
        if (Date.now() - lastActivityRef.current > TIMEOUT_MS) {
          localStorage.removeItem(SESSION_KEY);
          supabase.auth.signOut().catch(() => {}); // revoke JWT on inactivity timeout
          return null;
        }
        pingLastSeen(current.id);
        return current;
      });
    }, CHECK_INTERVAL);
    return () => clearInterval(timer);
  }, [pingLastSeen]);

  useEffect(() => {
    // Restore session from localStorage on load
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      if (stored) {
        const session = JSON.parse(stored);
        // Discard old sessions that are missing owner_id — forces a fresh login
        if (session?.owner_id) { setShop(session); pingLastSeen(session.id); }
        else localStorage.removeItem(SESSION_KEY);
      }
    } catch (err) {
      console.warn("Failed to restore session from localStorage:", err);
      localStorage.removeItem(SESSION_KEY);
    }
    setLoading(false);
  }, []);

  const login = async (
    businessCode: string,
    shopCode: string,
    password: string
  ): Promise<string | null> => {
    const tryOffline = async (): Promise<string | null> => {
      const result = await verifyPosOfflineCredentialsDetailed(
        businessCode.trim(), shopCode.trim(), password.trim()
      );
      if (!result.ok) return result.reason === "wrong_password" ? "offline_wrong_password" : "offline_no_cache";
      localStorage.setItem(SESSION_KEY, JSON.stringify(result.session));
      setShop(result.session);
      setIsOfflineMode(true);
      return null;
    };

    // ── Offline path (definite) ──────────────────────────────────────────
    if (!navigator.onLine) return tryOffline();

    // ── Online path (with offline fallback on network failure) ───────────
    try {
      const { data, error } = await supabase.rpc("pos_login", {
        p_business_code: businessCode.trim().toUpperCase(),
        p_shop_code:     shopCode.trim().toUpperCase(),
        p_password:      password.trim(),
      });

      if (error) {
        // Supabase returned an error — if we're now offline (race condition
        // where connection dropped mid-request), fall back to cached auth.
        if (!navigator.onLine) return tryOffline();
        return error.message;
      }
      // RPC ran but auth logic rejected the credentials
      if (data?.error) return data.error;

      const session: ShopSession = {
        id:        data.id,
        shop_code: data.shop_code,
        name:      data.name,
        location:  data.location,
        owner_id:  data.owner_id,
      };

      // Establish a real Supabase Auth session so RLS policies using auth.uid() are satisfied.
      // If the auth user doesn't exist yet, auto-provision it right now using the
      // plain-text password we already have (before the DB trigger hashes it).
      const shopEmail = `${shopCode.trim().toLowerCase()}@${businessCode.trim().toLowerCase()}.pos`;
      let authErr: { message: string } | null = null;

      // First attempt — sign in with the existing auth user.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email:    shopEmail,
        password: password.trim(),
      });

      if (signInErr) {
        // Auth user doesn't exist (or password mismatch). Try to create/repair it now.
        console.warn("Shop auth sign-in failed — attempting auto-provision:", signInErr.message);

        // The shop auth user's UUID MUST equal the shop's UUID so that
        // auth.uid() = shop_id works in RLS policies (credit sales, etc.).
        // Check if a user already exists with this email or with this shop UUID.
        const { data: byId }    = await supabaseAdmin.auth.admin.getUserById(data.id);
        const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
        const byEmail = listData?.users?.find(u => u.email === shopEmail);

        if (byId?.user && byId.user.email === shopEmail) {
          // Correct user exists (UUID matches shop UUID) — just update password.
          await supabaseAdmin.auth.admin.updateUserById(data.id, { password: password.trim() });
        } else {
          // Delete any wrong-UUID user that has this email, then create correctly.
          if (byEmail && byEmail.id !== data.id) {
            await supabaseAdmin.auth.admin.deleteUser(byEmail.id);
          }
          await supabaseAdmin.auth.admin.createUser({
            id:            data.id,          // ← shop UUID = auth user UUID (auth.uid() = shop_id)
            email:         shopEmail,
            password:      password.trim(),
            email_confirm: true,
            user_metadata: { role: "shop", shop_id: data.id, shop_code: shopCode.trim(), owner_id: data.owner_id },
          });
        }

        // Second attempt — now the auth user exists with the correct password.
        const { error: retryErr } = await supabase.auth.signInWithPassword({
          email:    shopEmail,
          password: password.trim(),
        });
        authErr = retryErr ?? null;
        if (authErr) console.warn("Shop auth retry failed:", authErr.message);
      }

      // Persist whether the Supabase Auth sign-in succeeded so other pages can
      // show a targeted warning without having to re-attempt a network call.
      const fullSession = { ...session, authProvisioned: !authErr };
      localStorage.setItem(SESSION_KEY, JSON.stringify(fullSession));
      await cachePosOfflineAuth(businessCode.trim(), shopCode.trim(), password.trim(), fullSession);
      setShop(fullSession);
      setIsOfflineMode(false);
      pingLastSeen(session.id);
      return null;
    } catch {
      // Network request threw entirely (fetch failed, no response).
      // Always try offline auth — if the user has cached credentials it works,
      // otherwise they see the "no offline data" guidance.
      return tryOffline();
    }
  };

  return (
    <ShopAuthContext.Provider value={{ shop, loading, isOfflineMode, hasAuthSession, login, logout, refreshAuthSession }}>
      {children}
    </ShopAuthContext.Provider>
  );
}

export function useShopAuth() {
  const ctx = useContext(ShopAuthContext);
  if (!ctx) throw new Error("useShopAuth must be used within ShopAuthProvider");
  return ctx;
}
