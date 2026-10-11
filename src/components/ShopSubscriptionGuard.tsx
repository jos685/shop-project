// components/ShopSubscriptionGuard.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../lib/supabase";
import ShopPaywallScreen, { type ShopLockInfo } from "./ShopPaywallScreen";

const RECHECK_INTERVAL_MS = 60_000;

function useWindowWidth() {
  const [w, setW] = useState(
    typeof window === "undefined" ? 1024 : window.innerWidth
  );
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

export default function ShopSubscriptionGuard({ children }: { children: React.ReactNode }) {
  // ── All hooks up top, unconditionally ─────────────────────────────
  const { shop, logout } = useShopAuth();     // ← logout, not signOut
  const { theme, isDark } = useTheme();
  const width            = useWindowWidth();
  const isMobile         = width < 480;

  const [info,     setInfo]     = useState<ShopLockInfo | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [retrying, setRetrying] = useState(false);
  const mountedRef = useRef(true);

  const check = useCallback(async (isManual = false) => {
    if (!shop?.id) { setLoading(false); return; }
    if (isManual) setRetrying(true);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (isManual) setRetrying(false);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc("shop_lock_info", { p_shop_id: shop.id });
      if (!mountedRef.current) return;
      if (error) {
        console.warn("shop_lock_info error:", error.message);
        setInfo(null);
        return;
      }
      setInfo(data as ShopLockInfo);
    } catch (err) {
      console.warn("shop_lock_info threw:", err);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        if (isManual) setRetrying(false);
      }
    }
  }, [shop?.id]);

  useEffect(() => {
    mountedRef.current = true;
    check();
    return () => { mountedRef.current = false; };
  }, [check]);

  useEffect(() => {
    const onVis   = () => { if (document.visibilityState === "visible") check(); };
    const onFocus = () => check();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, [check]);

  useEffect(() => {
    if (!info?.locked) return;
    const t = setInterval(() => check(), RECHECK_INTERVAL_MS);
    return () => clearInterval(t);
  }, [info?.locked, check]);

  if (loading && !info) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", background: theme.bg.base,
      }}>
        <div style={{
          width: 26, height: 26,
          border: "3px solid rgba(6,182,212,0.2)",
          borderTopColor: "#06b6d4",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (info?.locked) {
    return createPortal(
      <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
        <style>{`
          @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
          @keyframes fadeUp  { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
          @keyframes spin    { to{transform:rotate(360deg)} }
          @keyframes successPop { 0%{transform:scale(0.5);opacity:0} 70%{transform:scale(1.18)} 100%{transform:scale(1);opacity:1} }
        `}</style>

        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: isDark
              ? "rgba(9, 14, 20, 0.78)"     // deep navy-black, dark theme
              : "rgba(240, 244, 249, 0.72)", // cool off-white, light theme
            backdropFilter:        isDark ? "blur(12px)" : "blur(14px)",
            WebkitBackdropFilter:  isDark ? "blur(12px)" : "blur(14px)",
            animation: "fadeIn 0.2s ease both",
          }}
        />

        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: isMobile ? "16px 12px" : "32px 20px",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <ShopPaywallScreen
            info={info}
            onRetry={() => check(true)}
            retrying={retrying}
            onSignOut={logout}          // ← logout here too
          />
        </div>
      </div>,
      document.body
    );
  }

  return <>{children}</>;
}