// components/TopNav.tsx — global top navigation bar (all authenticated pages)

import { useState, useEffect, useCallback, useRef } from "react";
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

function fmtAmt(n: number) {
  return `KSh ${n.toLocaleString()}`;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return "just now";
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const TOP_NAV_HEIGHT = 58;

// ── Notification types ────────────────────────────────────────
type NotifType = "product_assigned" | "stock_updated" | "request_replied" | "tx_flagged";

interface ShopNotif {
  id:        string;
  type:      NotifType;
  title:     string;
  body:      string;
  timestamp: string;
}

const NOTIF_META: Record<NotifType, { icon: string; color: string; bg: string; border: string }> = {
  product_assigned: { icon: "📦", color: "#34d399", bg: "rgba(52,211,153,0.1)",  border: "rgba(52,211,153,0.25)"  },
  stock_updated:    { icon: "🔄", color: "#60a5fa", bg: "rgba(96,165,250,0.1)",  border: "rgba(96,165,250,0.25)"  },
  request_replied:  { icon: "💬", color: "#a78bfa", bg: "rgba(167,139,250,0.1)", border: "rgba(167,139,250,0.25)" },
  tx_flagged:       { icon: "⚠️", color: "#fbbf24", bg: "rgba(251,191,36,0.1)",  border: "rgba(251,191,36,0.25)"  },
};

export default function TopNav() {
  const { shop, logout }      = useShopAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate              = useNavigate();
  const width                 = useWindowWidth();
  const isMobile              = width < 640;

  const [time,        setTime]        = useState(new Date());
  const [showLogout,  setShowLogout]  = useState(false);
  const [alertCount,  setAlertCount]  = useState(0);
  // Guard against stray touch events propagating from the login screen.
  const [logoutReady, setLogoutReady] = useState(false);
  useEffect(() => {
    setShowLogout(false);
    setLogoutReady(false);
    const t = setTimeout(() => setLogoutReady(true), 700);
    return () => clearTimeout(t);
  }, [shop?.id]);

  // ── Notification bell state ───────────────────────────────────
  const [displayNotifs, setDisplayNotifs] = useState<ShopNotif[]>([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [panelOpen,     setPanelOpen]     = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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
      supabase.rpc("get_shop_requests", { p_shop_id: shop.id }),
    ]);
    const lowStock = (allocRes.data ?? []).filter(
      (a: { remaining: number; allocated: number }) =>
        a.allocated > 0 && a.remaining / a.allocated < 0.2
    ).length;
    const pendingRequests = (reqRes.data ?? []).filter(
      (r: { status: string }) => r.status === "pending"
    ).length;
    setAlertCount(lowStock + pendingRequests);
  }, [shop?.id]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  // ── Notification fetch ────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    if (!shop?.id || !navigator.onLine) return;
    const lastSeen = localStorage.getItem(`pos_notif_seen_${shop.id}`) ?? new Date(0).toISOString();

    const [allocRes, reqRes, txRes] = await Promise.all([
      supabase
        .from("shop_allocations")
        .select("id, allocated, remaining, updated_at, created_at, product_id")
        .eq("shop_id", shop.id)
        .gt("updated_at", lastSeen),
      supabase.rpc("get_shop_requests", { p_shop_id: shop.id }),
      supabase
        .from("shop_transactions")
        .select("id, product_name, amount, updated_at, status")
        .eq("shop_id", shop.id)
        .eq("status", "review")
        .gt("updated_at", lastSeen),
    ]);

    // Resolve product names for allocations
    const productIds = [...new Set((allocRes.data ?? []).map((a: any) => a.product_id))].filter(Boolean);
    let productMap: Record<string, string> = {};
    if (productIds.length > 0) {
      const { data: prods } = await supabase
        .from("products")
        .select("id, name")
        .in("id", productIds as string[]);
      productMap = Object.fromEntries((prods ?? []).map((p: any) => [p.id, p.name]));
    }

    const notifs: ShopNotif[] = [];

    // New / updated allocations
    (allocRes.data ?? []).forEach((a: any) => {
      const productName = productMap[a.product_id] ?? "product";
      const isNew = a.created_at > lastSeen;
      notifs.push({
        id:        `alloc-${a.id}`,
        type:      isNew ? "product_assigned" : "stock_updated",
        title:     isNew ? "Stock Assigned" : "Stock Updated",
        body:      isNew
          ? `Owner assigned ${a.allocated} units of ${productName} to your shop`
          : `Owner updated ${productName} allocation — ${a.remaining} units remaining`,
        timestamp: isNew ? a.created_at : a.updated_at,
      });
    });

    // Request replies (approved / rejected since lastSeen)
    (reqRes.data ?? [])
      .filter((r: any) =>
        (r.status === "approved" || r.status === "rejected") &&
        r.updated_at > lastSeen
      )
      .forEach((r: any) => {
        const label = r.type?.replace(/_/g, " ") ?? "request";
        notifs.push({
          id:        `req-${r.id}`,
          type:      "request_replied",
          title:     r.status === "approved" ? "Request Approved ✓" : "Request Rejected",
          body:      r.owner_reply
            ? `Owner: "${r.owner_reply}"`
            : `Your ${label} was ${r.status}`,
          timestamp: r.updated_at,
        });
      });

    // Flagged transactions
    (txRes.data ?? []).forEach((t: any) => {
      notifs.push({
        id:        `flag-${t.id}`,
        type:      "tx_flagged",
        title:     "Transaction Flagged",
        body:      `${t.product_name ?? "A transaction"} (${fmtAmt(t.amount)}) was flagged for review`,
        timestamp: t.updated_at,
      });
    });

    notifs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setDisplayNotifs(notifs);
    setUnreadCount(notifs.length);
  }, [shop?.id]);

  // Fetch on mount + poll every 60 s
  useEffect(() => {
    fetchNotifications();
    const t = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(t);
  }, [fetchNotifications]);

  // Close panel on outside click
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
        setDisplayNotifs([]);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [panelOpen]);

  const handleBellClick = () => {
    if (!panelOpen) {
      setPanelOpen(true);
      setUnreadCount(0);
      if (shop?.id) {
        localStorage.setItem(`pos_notif_seen_${shop.id}`, new Date().toISOString());
      }
    } else {
      setPanelOpen(false);
      setDisplayNotifs([]);
    }
  };

  if (!shop) return null;

  return (
    <>
      <style>{`
        @keyframes slideIn  { from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)} }
        @keyframes slideDown{ from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin     { to{transform:rotate(360deg)} }
        @keyframes bellRing { 0%,100%{transform:rotate(0)} 20%{transform:rotate(-18deg)} 40%{transform:rotate(18deg)} 60%{transform:rotate(-12deg)} 80%{transform:rotate(12deg)} }
        .tnav-btn { transition: opacity 0.15s, transform 0.12s; }
        .tnav-btn:active { transform: scale(0.93); opacity: 0.8; }
        .notif-item { transition: background 0.12s; }
        .notif-item:hover { background: rgba(255,255,255,0.04) !important; }
        .bell-ring { animation: bellRing 0.5s ease; }
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

          {/* Avatar circle */}
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
            {!isMobile && (
              <div style={{
                fontSize:      10,
                fontFamily:    theme.font.mono,
                color:         theme.text.muted,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                lineHeight:    1.2,
                whiteSpace:    "nowrap",
              }}>
                {greeting()} 👋
              </div>
            )}
            <div style={{
              fontFamily:    theme.font.display,
              fontWeight:    800,
              fontSize:      isMobile ? 15 : 20,
              color:         theme.text.primary,
              letterSpacing: "-0.02em",
              lineHeight:    1.2,
              whiteSpace:    "nowrap",
              overflow:      "hidden",
              textOverflow:  "ellipsis",
              maxWidth:      isMobile ? 120 : 220,
            }}>
              {shop.name}
            </div>
          </div>
        </div>

        {/* ── RIGHT: clock · alerts · bell · toggle · tour · logout ── */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 10, flexShrink: 0 }}>

          {/* Clock — desktop only */}
          {!isMobile && (
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{
                fontFamily:    theme.font.mono,
                fontSize:      15,
                fontWeight:    700,
                color:         theme.accent.cyan,
                letterSpacing: "0.04em",
                lineHeight:    1.2,
              }}>
                {time.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </div>
              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, lineHeight: 1.2 }}>
                {time.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })}
              </div>
            </div>
          )}

          {/* Alert pill — low stock / pending requests */}
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

          {/* ── Notification Bell ─────────────────────────────── */}
          <div style={{ position: "relative", flexShrink: 0 }} ref={panelRef}>
            <button
              className={`tnav-btn${unreadCount > 0 ? " bell-ring" : ""}`}
              onClick={handleBellClick}
              title="Notifications from owner"
              style={{
                position:       "relative",
                width:          isMobile ? 34 : 38,
                height:         isMobile ? 34 : 38,
                borderRadius:   "50%",
                background:     panelOpen
                  ? "rgba(6,182,212,0.15)"
                  : unreadCount > 0
                    ? "rgba(251,191,36,0.12)"
                    : theme.bg.card,
                border:         panelOpen
                  ? "1px solid rgba(6,182,212,0.4)"
                  : unreadCount > 0
                    ? "1px solid rgba(251,191,36,0.4)"
                    : `1px solid ${theme.border.default}`,
                cursor:         "pointer",
                display:        "flex",
                alignItems:     "center",
                justifyContent: "center",
                flexShrink:     0,
                WebkitTapHighlightColor: "transparent",
                transition:     "background 0.2s, border-color 0.2s",
              }}
            >
              {/* Bell SVG */}
              <svg width={isMobile ? 15 : 17} height={isMobile ? 15 : 17} viewBox="0 0 24 24" fill="none">
                <path
                  d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
                  stroke={unreadCount > 0 ? "#fbbf24" : panelOpen ? "#06b6d4" : theme.text.muted}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M13.73 21a2 2 0 0 1-3.46 0"
                  stroke={unreadCount > 0 ? "#fbbf24" : panelOpen ? "#06b6d4" : theme.text.muted}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>

              {/* Badge */}
              {unreadCount > 0 && (
                <div style={{
                  position:       "absolute",
                  top:            -4,
                  right:          -4,
                  minWidth:       18,
                  height:         18,
                  borderRadius:   9,
                  background:     "#ef4444",
                  color:          "#fff",
                  fontSize:       10,
                  fontFamily:     theme.font.mono,
                  fontWeight:     700,
                  display:        "flex",
                  alignItems:     "center",
                  justifyContent: "center",
                  padding:        "0 4px",
                  border:         "2px solid " + (theme.isDark ? "#080c12" : "#ffffff"),
                  pointerEvents:  "none",
                }}>
                  {unreadCount > 99 ? "99+" : unreadCount}
                </div>
              )}
            </button>

            {/* ── Notification Panel ─────────────────────────── */}
            {panelOpen && (
              <div style={{
                position:    "fixed",
                top:         TOP_NAV_HEIGHT + 8,
                right:       isMobile ? 8 : 16,
                width:       isMobile ? "calc(100vw - 16px)" : 340,
                maxWidth:    400,
                maxHeight:   420,
                overflowY:   "auto",
                background:  theme.isDark ? "#0d1117" : "#ffffff",
                border:      `1px solid ${theme.border.default}`,
                borderRadius: 14,
                boxShadow:   theme.isDark
                  ? "0 8px 32px rgba(0,0,0,0.6)"
                  : "0 8px 32px rgba(0,0,0,0.12)",
                zIndex:      200,
                animation:   "slideDown 0.18s ease",
              }}>

                {/* Panel header */}
                <div style={{
                  display:       "flex",
                  alignItems:    "center",
                  justifyContent:"space-between",
                  padding:       "14px 16px 12px",
                  borderBottom:  `1px solid ${theme.border.default}`,
                  position:      "sticky",
                  top:           0,
                  background:    theme.isDark ? "#0d1117" : "#ffffff",
                  zIndex:        1,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 14, color: theme.text.primary }}>
                      Owner Updates
                    </span>
                  </div>
                  <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                    {displayNotifs.length === 0 ? "all caught up" : `${displayNotifs.length} new`}
                  </span>
                </div>

                {/* Notification list */}
                {displayNotifs.length === 0 ? (
                  <div style={{ padding: "40px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>🔔</div>
                    <div style={{ fontFamily: theme.font.mono, fontSize: 12, color: theme.text.muted, lineHeight: 1.6 }}>
                      No new updates from owner.<br />You're all caught up!
                    </div>
                  </div>
                ) : (
                  <div>
                    {displayNotifs.map((n, idx) => {
                      const meta = NOTIF_META[n.type];
                      return (
                        <div
                          key={n.id}
                          className="notif-item"
                          style={{
                            display:       "flex",
                            gap:           12,
                            padding:       "12px 16px",
                            borderBottom:  idx < displayNotifs.length - 1
                              ? `1px solid ${theme.border.default}`
                              : "none",
                            cursor:        "default",
                          }}
                        >
                          {/* Type icon */}
                          <div style={{
                            width:          36,
                            height:         36,
                            borderRadius:   10,
                            background:     meta.bg,
                            border:         `1px solid ${meta.border}`,
                            display:        "flex",
                            alignItems:     "center",
                            justifyContent: "center",
                            fontSize:       16,
                            flexShrink:     0,
                          }}>
                            {meta.icon}
                          </div>

                          {/* Content */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              display:        "flex",
                              justifyContent: "space-between",
                              alignItems:     "flex-start",
                              gap:            8,
                              marginBottom:   3,
                            }}>
                              <span style={{
                                fontFamily: theme.font.display,
                                fontWeight: 700,
                                fontSize:   13,
                                color:      meta.color,
                              }}>
                                {n.title}
                              </span>
                              <span style={{
                                fontSize:   9,
                                fontFamily: theme.font.mono,
                                color:      theme.text.muted,
                                flexShrink: 0,
                                whiteSpace: "nowrap",
                              }}>
                                {timeAgo(n.timestamp)}
                              </span>
                            </div>
                            <div style={{
                              fontSize:   12,
                              fontFamily: theme.font.mono,
                              color:      theme.text.secondary,
                              lineHeight: 1.5,
                              overflow:   "hidden",
                              display:    "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical" as any,
                            }}>
                              {n.body}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Panel footer */}
                <div style={{
                  padding:        "10px 16px",
                  borderTop:      `1px solid ${theme.border.default}`,
                  display:        "flex",
                  gap:            8,
                  position:       "sticky",
                  bottom:         0,
                  background:     theme.isDark ? "#0d1117" : "#ffffff",
                }}>
                  <button
                    onClick={() => { navigate("/pos/info"); setPanelOpen(false); setDisplayNotifs([]); }}
                    style={{
                      flex:       1,
                      padding:    "8px 0",
                      borderRadius: 8,
                      border:     "1px solid rgba(6,182,212,0.3)",
                      background: "rgba(6,182,212,0.08)",
                      color:      theme.accent.cyan,
                      fontFamily: theme.font.mono,
                      fontSize:   11,
                      fontWeight: 600,
                      cursor:     "pointer",
                    }}
                  >
                    View Stock
                  </button>
                  <button
                    onClick={() => { navigate("/pos/requests"); setPanelOpen(false); setDisplayNotifs([]); }}
                    style={{
                      flex:       1,
                      padding:    "8px 0",
                      borderRadius: 8,
                      border:     "1px solid rgba(167,139,250,0.3)",
                      background: "rgba(167,139,250,0.08)",
                      color:      "#a78bfa",
                      fontFamily: theme.font.mono,
                      fontSize:   11,
                      fontWeight: 600,
                      cursor:     "pointer",
                    }}
                  >
                    View Requests
                  </button>
                </div>
              </div>
            )}
          </div>

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

          {/* Refresh */}
          <button className="tnav-btn"
            onClick={() => window.location.reload()}
            title="Refresh"
            style={{
              width:          isMobile ? 30 : 34,
              height:         isMobile ? 30 : 34,
              borderRadius:   "50%",
              background:     "rgba(6,182,212,0.08)",
              border:         "1px solid rgba(6,182,212,0.25)",
              cursor:         "pointer",
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              flexShrink:     0,
              WebkitTapHighlightColor: "transparent",
            }}>
            <svg width={isMobile ? 14 : 16} height={isMobile ? 14 : 16} viewBox="0 0 24 24" fill="none">
              <path d="M23 4v6h-6" stroke="#06b6d4" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" stroke="#06b6d4" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Sign Out */}
          <button className="tnav-btn"
            onClick={() => setShowLogout(true)}
            title="Sign out"
            disabled={!logoutReady}
            style={{
              display:        "flex",
              alignItems:     "center",
              gap:            6,
              padding:        isMobile ? "0" : "6px 14px",
              width:          isMobile ? 30 : "auto",
              height:         isMobile ? 30 : "auto",
              justifyContent: "center",
              background:     "rgba(248,113,113,0.08)",
              border:         "1px solid rgba(248,113,113,0.22)",
              borderRadius:   isMobile ? "50%" : 50,
              color:          "#f87171",
              fontFamily:     theme.font.mono,
              fontSize:       11,
              fontWeight:     600,
              cursor:         "pointer",
              whiteSpace:     "nowrap",
              flexShrink:     0,
              WebkitTapHighlightColor: "transparent",
              pointerEvents:  logoutReady ? "auto" : "none",
            }}>
            <svg width={isMobile ? 15 : 14} height={isMobile ? 15 : 14} viewBox="0 0 24 24" fill="none">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
                stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="16 17 21 12 16 7"
                stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="21" y1="12" x2="9" y2="12"
                stroke="#f87171" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            {!isMobile && "Sign Out"}
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
