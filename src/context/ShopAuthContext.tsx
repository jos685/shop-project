import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { ShopSession } from "../lib/supabase";
import type { ReactNode } from "react";

interface ShopAuthContextType {
  shop: ShopSession | null;
  loading: boolean;
  login: (businessCode: string, shopCode: string, password: string) => Promise<string | null>;
  logout: () => void;
}

const ShopAuthContext = createContext<ShopAuthContextType | null>(null);

const SESSION_KEY    = "pos_shop_session";
const TIMEOUT_MS     = 30 * 60 * 1000; // 30 minutes of inactivity
const CHECK_INTERVAL = 60 * 1000;       // check every minute

export function ShopAuthProvider({ children }: { children: ReactNode }) {
  const [shop, setShop] = useState<ShopSession | null>(null);
  const [loading, setLoading] = useState(true);
  const lastActivityRef = useRef<number>(Date.now());

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setShop(null);
  }, []);

  // Reset the inactivity clock on any user interaction
  useEffect(() => {
    const touch = () => { lastActivityRef.current = Date.now(); };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    events.forEach(e => document.addEventListener(e, touch, { passive: true }));
    return () => events.forEach(e => document.removeEventListener(e, touch));
  }, []);

  // Update shops.last_seen so the owner dashboard can detect this shop as online
  const pingLastSeen = useCallback(async (shopId: string) => {
    await supabase.from("shops").update({ last_seen: new Date().toISOString() }).eq("id", shopId);
  }, []);

  // Check for inactivity every minute — auto-logout when session exists, also heartbeat last_seen
  useEffect(() => {
    const timer = setInterval(() => {
      setShop(current => {
        if (!current) return current;
        if (Date.now() - lastActivityRef.current > TIMEOUT_MS) {
          localStorage.removeItem(SESSION_KEY);
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
    const { data, error } = await supabase.rpc("pos_login", {
      p_business_code: businessCode.trim().toUpperCase(),
      p_shop_code:     shopCode.trim().toUpperCase(),
      p_password:      password.trim(),
    });

    if (error) return error.message;
    if (data?.error) return data.error;

    const session: ShopSession = {
      id:        data.id,
      shop_code: data.shop_code,
      name:      data.name,
      location:  data.location,
      owner_id:  data.owner_id,
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    setShop(session);
    pingLastSeen(session.id);
    return null;
  };

  return (
    <ShopAuthContext.Provider value={{ shop, loading, login, logout }}>
      {children}
    </ShopAuthContext.Provider>
  );
}

export function useShopAuth() {
  const ctx = useContext(ShopAuthContext);
  if (!ctx) throw new Error("useShopAuth must be used within ShopAuthProvider");
  return ctx;
}
