import { createContext, useContext, useState, useEffect } from "react";
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

const SESSION_KEY = "pos_shop_session";

export function ShopAuthProvider({ children }: { children: ReactNode }) {
  const [shop, setShop] = useState<ShopSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore session from localStorage on load
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      if (stored) setShop(JSON.parse(stored));
    } catch {}
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
    return null;
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setShop(null);
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
