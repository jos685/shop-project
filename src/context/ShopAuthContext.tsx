import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { ShopSession } from "../lib/supabase";
import type { ReactNode } from "react";
import { cachePosOfflineAuth, verifyPosOfflineCredentialsDetailed } from "../lib/offlineAuth";

interface ShopAuthContextType {
  shop: ShopSession | null;
  loading: boolean;
  isOfflineMode: boolean;
  
  /** True when a local shop session exists (user is "logged in").
 *  Does NOT guarantee the JWT is currently valid — RLS-protected
 *  inserts may still fail if the token has expired. Use refreshAuthSession()
 *  to check JWT health, or just let the offline queue catch failed writes. */
hasAuthSession: boolean;
  login: (businessCode: string, shopCode: string, password: string) => Promise<string | null>;
  logout: () => void;
  /** Tries to refresh the Supabase JWT; returns true if session is now valid. */
  refreshAuthSession: () => Promise<boolean>;
}

const ShopAuthContext = createContext<ShopAuthContextType | null>(null);

const SESSION_KEY    = "pos_shop_session";
// const TIMEOUT_MS     = 30 * 60 * 1000; // 30 minutes of inactivity
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
  // const lastActivityRef   = useRef<number>(Date.now());
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
          setShop(prev => prev ? { ...prev, authProvisioned: true } : prev);
        }
      } catch {}
    };

    supabase.auth.getSession().then(({ data }) => {
      const has = !!data?.session;
      
      if (has) {
        setHasAuthSession(true);
        sessionTokenRef.current = data.session.access_token;
        markProvisioned();
      } else {
        // If we have a stored shop session, NEVER log them out just because the JWT is missing.
        // They can keep using the POS offline, and we will try to re-auth when they go online.
        const hasStored = !!localStorage.getItem(SESSION_KEY);
        if (hasStored) {
          console.warn("No JWT session found, but keeping local shop session active.");
          setHasAuthSession(true); 
        } else {
          setHasAuthSession(false);
        }
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      sessionTokenRef.current = session?.access_token ?? null;
      
      if (session) {
        setHasAuthSession(true);
        markProvisioned();
      } else {
        // IGNORE SIGNED_OUT events if we have a local session!
        // The SDK emits this when the network drops mid-refresh. 
        // We only want to log them out if they explicitly click "Logout".
        const hasStored = !!localStorage.getItem(SESSION_KEY);
        if (event === "SIGNED_OUT" && hasStored) {
          console.warn("Ignored SIGNED_OUT event. Local shop session is still valid.");
        } else {
          setHasAuthSession(false);
        }
      }
    });
    return () => subscription.unsubscribe();
  }, []);

    /** Re-checks with the Supabase server that the JWT is still valid.
   *  Returns true if a usable session is active after the attempt. */
    const refreshAuthSession = useCallback(async (): Promise<boolean> => {
    const { data, error } = await supabase.auth.refreshSession();
    const ok = !error && !!data?.session;
    
    if (ok) {
      setHasAuthSession(true);
    } else {
      // Only set to false if we don't have a local session at all
      const hasStored = !!localStorage.getItem(SESSION_KEY);
      if (!hasStored) {
        setHasAuthSession(false);
      }
    }
    return ok;
  }, []);

  // Attempt to refresh the token when network is restored
  useEffect(() => {
    const handleOnline = async () => {
      console.log("Network restored. Refreshing auth session...");
      const ok = await refreshAuthSession();
      if (!ok) {
        console.warn("Could not refresh auth session after coming online.");
      }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [refreshAuthSession]);

    // Attempt to refresh the token when the tab becomes visible (e.g. phone unlocked)
  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        console.log("Tab visible. Refreshing auth session...");
        refreshAuthSession();
      }
    };
    document.addEventListener("visibilitychange", handleVisible);
    return () => document.removeEventListener("visibilitychange", handleVisible);
  }, [refreshAuthSession]);

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
  // useEffect(() => {
  //   const touch = () => { lastActivityRef.current = Date.now(); };
  //   const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
  //   events.forEach(e => document.addEventListener(e, touch, { passive: true }));
  //   return () => events.forEach(e => document.removeEventListener(e, touch));
  // }, []);

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
// Keep the shop presence updated every minute.
// This does NOT log the user out for inactivity.
useEffect(() => {
  const timer = setInterval(() => {
    setShop(current => {
      if (!current) return current;

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
// If the auth user doesn't exist yet OR was provisioned with the wrong UUID,
// repair it now (delete + recreate with id = shop_id).
const shopEmail = `${shopCode.trim().toLowerCase()}@${businessCode.trim().toLowerCase()}.pos`;

/** Ensure we have a valid Supabase Auth session whose auth.uid() === shop.id.
 *  Returns null on success, or { message } on unrecoverable failure. */
const ensureShopAuth = async (): Promise<{ message: string } | null> => {
  // ── Attempt 1: sign in ──
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email:    shopEmail,
    password: password.trim(),
  });

  if (!signInErr) {
    // Sign-in worked — but is the UUID right?
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id === session.id) return null;   // ✅ perfect, done

    // ❌ Wrong UUID — this is the provisioning bug. Sign out so
    //    pos-provision-auth can rebuild the user with the correct id.
    console.warn(
      "[ShopAuth] UUID mismatch — self-healing. Got:",
      user?.id, "Expected:", session.id,
    );
    await supabase.auth.signOut();
  } else {
    console.warn("[ShopAuth] Sign-in failed, will provision:", signInErr.message);
  }

  // ── Provision (or repair) the auth user ──
  // pos-provision-auth already handles the "delete wrong-email user, create
  // new user with id = shop_id" case internally.
  const { data: provData } = await supabase.functions.invoke("pos-provision-auth", {
    body: {
      business_code: businessCode.trim(),
      shop_code:     shopCode.trim(),
      password:      password.trim(),
    },
  });

  if (!provData?.success) {
    return { message: provData?.error ?? "Auth provisioning failed" };
  }

  // ── Attempt 2: sign in again ──
  const { error: retryErr } = await supabase.auth.signInWithPassword({
    email:    shopEmail,
    password: password.trim(),
  });
  if (retryErr) return { message: retryErr.message };

  // ── Final verification — did the UUID stick? ──
  const { data: { user: finalUser } } = await supabase.auth.getUser();
  if (!finalUser || finalUser.id !== session.id) {
    return { message: "Auth user still has wrong UUID after provisioning" };
  }
  return null;
};

const authErr = await ensureShopAuth();

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
