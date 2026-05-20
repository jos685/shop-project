import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";

const tabs = [
  { path: "/pos",              icon: "🏠", label: "Dashboard", short: "Home", tour: "pos-home" },
  { path: "/pos/transactions", icon: "🧾", label: "Txns",      short: "Txns", tour: "pos-txns" },
  { path: "/pos/scan",         icon: "📷", label: "Scan&Sell", short: "Scan", tour: "pos-scan" },
  { path: "/pos/info",         icon: "📦", label: "Shop",      short: "Shop", tour: "pos-info" },
  { path: "/pos/requests",     icon: "📋", label: "Hub",       short: "Hub",  tour: "pos-hub"  },
];

function useWindowWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { shop } = useShopAuth();
  const { theme } = useTheme();
  const width = useWindowWidth();
  const compact = width < 400;

  if (!shop) return null;

  return (
    <>
      <style>{`
        .bnav-btn { transition: transform 0.12s ease, opacity 0.12s ease; }
        .bnav-btn:active { transform: scale(0.88); opacity: 0.8; }
        .bnav-scan-pill { transition: box-shadow 0.2s ease; }
        .bnav-scan-pill:hover { box-shadow: 0 0 24px rgba(6,182,212,0.55) !important; }
      `}</style>
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50,
        background: theme.bg.nav,
        backdropFilter: "blur(16px)",
        borderTop: `1px solid ${theme.border.nav}`,
        boxShadow: theme.isDark
          ? "0 -4px 32px rgba(0,0,0,0.6), 0 -1px 0 rgba(6,182,212,0.12)"
          : "0 -4px 24px rgba(0,0,0,0.08), 0 -1px 0 rgba(2,132,199,0.1)",
        display: "flex",
        alignItems: "center",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: 8,
        paddingRight: 8,
        gap: 4,
        height: 64,
      }}>
        {tabs.map(tab => {
          const isActive = location.pathname === tab.path;
          const isScan   = tab.path === "/pos/scan";

          if (isScan) {
            return (
              <button
                key={tab.path}
                data-tour={tab.tour}
                className="bnav-btn bnav-scan-pill"
                onClick={() => navigate(tab.path)}
                style={{
                  flex: 1,
                  margin: "0 2px",
                  height: 46,
                  borderRadius: 14,
                  background: isActive
                    ? "linear-gradient(135deg,#06b6d4,#0284c7)"
                    : "linear-gradient(135deg,rgba(6,182,212,0.28),rgba(2,132,199,0.18))",
                  boxShadow: isActive
                    ? "0 0 20px rgba(6,182,212,0.5), inset 0 1px 0 rgba(255,255,255,0.15)"
                    : "0 0 12px rgba(6,182,212,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
                  border: `1px solid ${isActive ? "rgba(6,182,212,0.6)" : "rgba(6,182,212,0.3)"}`,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                }}>
                <span style={{ fontSize: 20, lineHeight: 1 }}>{tab.icon}</span>
                <span style={{
                  fontSize: 9,
                  fontFamily: "DM Mono, monospace",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: isActive ? "#fff" : "#67e8f9",
                  textTransform: "uppercase",
                }}>
                  {compact ? tab.short : tab.label}
                </span>
              </button>
            );
          }

          return (
            <button
              key={tab.path}
              data-tour={tab.tour}
              className="bnav-btn"
              onClick={() => navigate(tab.path)}
              style={{
                flex: 1,
                height: 54,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                position: "relative",
                borderRadius: 12,
              }}>
              {/* Active glow pill behind icon */}
              {isActive && (
                <div style={{
                  position: "absolute",
                  top: 6,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 36,
                  height: 28,
                  borderRadius: 8,
                  background: theme.isDark ? "rgba(6,182,212,0.15)" : "rgba(2,132,199,0.1)",
                  boxShadow: theme.isDark ? "0 0 12px rgba(6,182,212,0.25)" : "0 0 8px rgba(2,132,199,0.15)",
                }} />
              )}
              <span style={{
                fontSize: 19,
                lineHeight: 1,
                position: "relative",
                filter: isActive ? "drop-shadow(0 0 6px rgba(6,182,212,0.7))" : "none",
              }}>
                {tab.icon}
              </span>
              <span style={{
                fontSize: 9,
                fontFamily: "DM Mono, monospace",
                fontWeight: isActive ? 700 : 400,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: isActive ? theme.accent.cyan : theme.text.muted,
                position: "relative",
              }}>
                {compact ? tab.short : tab.label}
              </span>
              {/* Active dot indicator */}
              {isActive && (
                <div style={{
                  position: "absolute",
                  bottom: 4,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "#06b6d4",
                  boxShadow: "0 0 6px #06b6d4",
                }} />
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
