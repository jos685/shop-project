// components/TopNav.tsx — global top navigation bar (all authenticated pages)

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../lib/supabase";

function useWindowWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export const TOP_NAV_HEIGHT = 58;

export default function TopNav() {
  const { shop, logout }     = useShopAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate             = useNavigate();
  const width                = useWindowWidth();
  const isMobile             = width < 640;

  const [time,        setTime]        = useState(new Date());
  const [showLogout,  setShowLogout]  = useState(false);
  const [alertCount,  setAlertCount]  = useState(0);

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Lightweight alert fetch — low stock + pending requests
  const fetchAlerts = useCallback(async () => {
    if (!shop?.id || !navigator.onLine) return;
    const [allocRes, reqRes] = await Promise.all([
      supabase.from("shop_allocations")
        .select("remaining, allocated", { count: "exact", head: false })
        .eq("shop_id", shop.id),
      supabase.from("shop_requests")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shop.id)
        .eq("status", "pending"),
    ]);
    const lowStock = (allocRes.data ?? []).filter(
      (a: { remaining: number; allocated: number }) =>
        a.allocated > 0 && a.remaining / a.allocated < 0.2
    ).length;
    setAlertCount(lowStock + (reqRes.count ?? 0));
  }, [shop?.id]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  if (!shop) return null;

  // ── last agent who sold (shown in greeting) ─────────────────────────────
  const lastAgent = (() => {
    try { return JSON.parse(localStorage.getItem(`pos_last_agent_${shop.id}`) ?? "null"); } catch { return null; }
  })();
  const agentFirst = lastAgent?.name?.split(" ")[0];

  return (
    <>
      <style>{`
        @keyframes slideIn { from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        .tnav-btn { transition: opacity 0.15s, transform 0.12s; }
        .tnav-btn:active { transform: scale(0.93); opacity: 0.8; }
      `}</style>

      {/* ── Fixed top bar ─────────────────────────────────────── */}
      <div style={{
        position:      "fixed",
        top:           0,
        left:          0,
        right:         0,
        height:        TOP_NAV_HEIGHT,
        zIndex:        100,
        background:    theme.isDark
          ? "rgba(8,12,18,0.96)"
          : "rgba(255,255,255,0.96)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom:  `1px solid ${theme.border.default}`,
        display:       "flex",
        alignItems:    "center",
        justifyContent:"space-between",
        padding:       isMobile ? "0 12px" : "0 28px",
        gap:           12,
        boxShadow:     theme.isDark
          ? "0 2px 24px rgba(0,0,0,0.5)"
          : "0 2px 16px rgba(0,0,0,0.06)",
      }}>

        {/* ── LEFT: logo · divider · avatar · greeting+name ─── */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, minWidth: 0 }}>

          {/* Logo — click → home */}
          <img
            src="/Qash.png"
            alt="Qash"
            onClick={() => navigate("/pos")}
            title="Go to dashboard"
            style={{
              height:       isMobile ? 28 : 70,
              width:        "auto",
              objectFit:    "contain",
              flexShrink:   0,
              borderRadius: 4,
              cursor:       "pointer",
              transition:   "opacity 0.15s, transform 0.12s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLImageElement).style.opacity = "0.8"; (e.currentTarget as HTMLImageElement).style.transform = "scale(0.96)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLImageElement).style.opacity = "1"; (e.currentTarget as HTMLImageElement).style.transform = "scale(1)"; }}
          />

          {/* Divider */}
          <div style={{ width: 1, height: 32, background: theme.border.default, flexShrink: 0 }} />

          {/* Avatar circle (moved from right) */}
          <div style={{
            width:          isMobile ? 34 : 42,
            height:         isMobile ? 34 : 42,
            borderRadius:   "50%",
            background:     "linear-gradient(135deg,#06b6d4,#0891b2)",
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            fontFamily:     theme.font.display,
            fontWeight:     800,
            fontSize:       isMobile ? 12 : 15,
            color:          "#fff",
            flexShrink:     0,
            letterSpacing:  "-0.02em",
            boxShadow:      "0 2px 10px rgba(6,182,212,0.35)",
          }}>
            {shop.name?.slice(0, 2).toUpperCase() ?? "SH"}
          </div>

          {/* Stacked greeting + shop name */}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize:      isMobile ? 9 : 10,
              fontFamily:    theme.font.mono,
              color:         theme.text.muted,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              lineHeight:    1.2,
              whiteSpace:    "nowrap",
            }}>
              {greeting()}{agentFirst ? `, ${agentFirst}` : ""} 👋
            </div>
            <div style={{
              fontFamily:    theme.font.display,
              fontWeight:    800,
              fontSize:      isMobile ? 16 : 20,
              color:         theme.text.primary,
              letterSpacing: "-0.02em",
              lineHeight:    1.2,
              whiteSpace:    "nowrap",
              overflow:      "hidden",
              textOverflow:  "ellipsis",
              maxWidth:      isMobile ? 100 : 220,
            }}>
              {shop.name}
            </div>
          </div>
        </div>

        {/* ── RIGHT: clock · alerts · toggle · avatar · tour · logout ── */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 10, flexShrink: 0 }}>

          {/* Clock */}
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{
              fontFamily:    theme.font.mono,
              fontSize:      isMobile ? 12 : 15,
              fontWeight:    700,
              color:         theme.accent.cyan,
              letterSpacing: "0.04em",
              lineHeight:    1.2,
            }}>
              {time.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
            {!isMobile && (
              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, lineHeight: 1.2 }}>
                {time.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })}
              </div>
            )}
          </div>

          {/* Alert pill */}
          {alertCount > 0 && (
            <button className="tnav-btn"
              onClick={() => navigate(alertCount > 0 ? "/pos/info" : "/pos/requests")}
              style={{
                display:    "flex", alignItems: "center", gap: 5,
                padding:    "5px 11px",
                background: "rgba(251,191,36,0.1)",
                border:     "1px solid rgba(251,191,36,0.3)",
                borderRadius: 50,
                color:      "#fbbf24",
                fontFamily: theme.font.mono,
                fontSize:   10,
                fontWeight: 600,
                cursor:     "pointer",
                whiteSpace: "nowrap",
              }}>
              ⚠ {alertCount}
            </button>
          )}

          {/* Theme toggle */}
          <button className="tnav-btn"
            onClick={toggleTheme}
            title={theme.isDark ? "Light mode" : "Dark mode"}
            style={{
              width:          isMobile ? 30 : 34,
              height:         isMobile ? 30 : 34,
              borderRadius:   "50%",
              background:     theme.bg.card,
              border:         `1px solid ${theme.border.default}`,
              cursor:         "pointer",
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              fontSize:       isMobile ? 14 : 16,
              flexShrink:     0,
            }}>
            {theme.isDark ? "☀️" : "🌙"}
          </button>

          {/* Tour */}
          <button className="tnav-btn"
            onClick={() => window.dispatchEvent(new Event("shop:start-tour"))}
            style={{
              display:        "flex",
              alignItems:     "center",
              gap:            5,
              padding:        isMobile ? "0" : "5px 12px",
              width:          isMobile ? 30 : "auto",
              height:         isMobile ? 30 : "auto",
              justifyContent: "center",
              background:     "rgba(192,132,252,0.1)",
              border:         "1px solid rgba(192,132,252,0.28)",
              borderRadius:   isMobile ? "50%" : 50,
              color:          "#c084fc",
              fontFamily:     theme.font.mono,
              fontSize:       isMobile ? 14 : 11,
              fontWeight:     600,
              cursor:         "pointer",
              whiteSpace:     "nowrap",
              flexShrink:     0,
              WebkitTapHighlightColor: "transparent",
            }}>
            {isMobile ? "🧭" : "🧭 Tour"}
          </button>

          {/* Logout */}
          <button className="tnav-btn"
            onClick={() => setShowLogout(true)}
            style={{
              display:        "flex",
              alignItems:     "center",
              gap:            5,
              padding:        isMobile ? "0" : "5px 12px",
              width:          isMobile ? 30 : "auto",
              height:         isMobile ? 30 : "auto",
              justifyContent: "center",
              background:     "rgba(248,113,113,0.1)",
              border:         "1px solid rgba(248,113,113,0.25)",
              borderRadius:   isMobile ? "50%" : 50,
              color:          "#f87171",
              fontFamily:     theme.font.mono,
              fontSize:       isMobile ? 14 : 11,
              fontWeight:     600,
              cursor:         "pointer",
              whiteSpace:     "nowrap",
              flexShrink:     0,
            }}>
            {isMobile ? "🚪" : "🚪 Logout"}
          </button>
        </div>
      </div>

      {/* ── Logout confirmation modal ──────────────────────── */}
      {showLogout && (
        <div
          style={{ position: "fixed", inset: 0, background: theme.bg.overlay, backdropFilter: "blur(8px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setShowLogout(false)}
        >
          <div
            style={{ background: theme.bg.modal, border: `1px solid ${theme.border.default}`, borderRadius: 20, padding: "32px 28px", maxWidth: 360, width: "100%", animation: "slideIn 0.2s ease", textAlign: "center" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 38, marginBottom: 14 }}>🔒</div>
            <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 20, marginBottom: 8 }}>
              Close Terminal?
            </div>
            <div style={{ color: theme.text.muted, fontSize: 13, fontFamily: theme.font.mono, lineHeight: 1.6, marginBottom: 24 }}>
              This will log out the shop and<br />require credentials to reopen.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setShowLogout(false)}
                style={{ flex: 1, background: "none", border: `1px solid ${theme.border.default}`, borderRadius: 12, padding: 14, color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 13, cursor: "pointer" }}>
                Cancel
              </button>
              <button
                onClick={logout}
                style={{ flex: 2, background: "linear-gradient(135deg,#ef4444,#dc2626)", border: "none", borderRadius: 12, padding: 14, color: "#fff", fontFamily: theme.font.display, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
                ⏻ Close Terminal
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
