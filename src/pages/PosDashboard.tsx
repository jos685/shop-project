import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";

function useWindowWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

export default function PosDashboard() {
  const { shop, logout } = useShopAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const width = useWindowWidth();
  const isMobile = width < 640;

  const [showLogout, setShowLogout] = useState(false);
  const [time,       setTime]       = useState(new Date());

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: theme.bg.base, color: theme.text.primary, fontFamily: theme.font.body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes fadeUp  { from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin    { to{transform:rotate(360deg)} }
        @keyframes slideIn { from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)} }
        .section   { animation: fadeUp 0.35s ease both; }
        .action-btn { transition: transform 0.1s, box-shadow 0.15s, opacity 0.15s; }
        .action-btn:hover  { transform: translateY(-2px); opacity: 0.9; }
        .action-btn:active { transform: scale(0.97); }
      `}</style>

      {/* ── Header ── */}
      <div style={{
        borderBottom: `1px solid ${theme.border.default}`,
        padding: isMobile ? "14px 16px" : "16px 40px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, background: theme.bg.base, zIndex: 40,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, background: "linear-gradient(135deg,#eab308,#f59e0b)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: theme.font.display, fontWeight: 800, fontSize: 17, color: "#000", flexShrink: 0 }}>S</div>
          <div>
            <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 15 : 17, letterSpacing: "-0.02em" }}>{shop?.name}</div>
            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 1 }}>{shop?.shop_code} · {shop?.location}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: theme.font.mono, fontSize: isMobile ? 15 : 20, fontWeight: 700, color: theme.accent.cyan, letterSpacing: "0.04em" }}>
              {time.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
              {time.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })}
            </div>
          </div>
          <button onClick={() => setShowLogout(true)}
            style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 9, padding: "8px 12px", color: theme.accent.red, fontFamily: theme.font.mono, fontSize: 13, cursor: "pointer" }}>
            ⏻
          </button>
        </div>
      </div>

      <div style={{ padding: isMobile ? "18px 16px 100px" : "28px 40px 100px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── Scan & Sell hero button ── */}
        <div className="section" style={{ animationDelay: "0.05s" }}>
          <button className="action-btn" onClick={() => navigate("/pos/scan")}
            style={{
              width: "100%",
              minHeight: isMobile ? "42vh" : 260,
              background: "linear-gradient(145deg, rgba(6,182,212,0.2), rgba(6,182,212,0.07))",
              border: "1px solid rgba(6,182,212,0.35)", borderRadius: 24, cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: isMobile ? 18 : 20,
              boxShadow: "0 8px 40px rgba(6,182,212,0.15), inset 0 1px 0 rgba(255,255,255,0.05)",
              position: "relative", overflow: "hidden",
            }}>
            {/* subtle radial glow behind icon */}
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-60%)", width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(6,182,212,0.18) 0%, transparent 70%)", pointerEvents: "none" }} />
            <span style={{ fontSize: isMobile ? 64 : 72, lineHeight: 1, position: "relative" }}>📷</span>
            <div style={{ textAlign: "center", position: "relative" }}>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 28 : 34, color: theme.accent.cyan, letterSpacing: "-0.02em" }}>Scan & Sell</div>
              <div style={{ color: theme.text.muted, fontSize: isMobile ? 13 : 14, fontFamily: theme.font.mono, marginTop: 6 }}>Tap to start a new transaction</div>
            </div>
          </button>
        </div>

        {/* ── Quick actions ── */}
        <div className="section" style={{ animationDelay: "0.15s" }}>
          <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Quick Access</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button className="action-btn" onClick={() => navigate("/pos/transactions")}
              style={{ padding: "18px 16px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16, cursor: "pointer", display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🧾</div>
              <div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 13, color: theme.text.primary }}>Transactions</div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>View history</div>
              </div>
            </button>
            <button className="action-btn" onClick={() => navigate("/pos/info")}
              style={{ padding: "18px 16px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16, cursor: "pointer", display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>📦</div>
              <div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 13, color: theme.text.primary }}>Shop Info</div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>Stock & details</div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* ── Logout confirm ── */}
      {showLogout && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setShowLogout(false)}>
          <div style={{ background: "#0d1117", border: `1px solid ${theme.border.default}`, borderRadius: 20, padding: "32px 28px", maxWidth: 360, width: "100%", animation: "slideIn 0.2s ease", textAlign: "center" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 38, marginBottom: 14 }}>🔒</div>
            <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 20, marginBottom: 8 }}>Close Terminal?</div>
            <div style={{ color: theme.text.muted, fontSize: 13, fontFamily: theme.font.mono, lineHeight: 1.6, marginBottom: 24 }}>
              This will log out the shop and<br />require credentials to reopen.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowLogout(false)}
                style={{ flex: 1, background: "none", border: `1px solid ${theme.border.default}`, borderRadius: 12, padding: 14, color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 13, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={logout}
                style={{ flex: 2, background: "linear-gradient(135deg,#ef4444,#dc2626)", border: "none", borderRadius: 12, padding: 14, color: "#fff", fontFamily: theme.font.display, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
                ⏻ Close Terminal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
