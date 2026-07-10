import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";

const tabs = [
  { path: "/pos",              icon: "🏠", label: "Dashboard", short: "Home", tour: "pos-home" },
  { path: "/pos/transactions", icon: "🧾", label: "Txns",      short: "Txns", tour: "pos-txns" },
  { path: "/pos/scan",         icon: "cart", label: "Sell",    short: "Sell", tour: "pos-scan"},
  { path: "/pos/info",         icon: "📦", label: "Shop",      short: "Shop", tour: "pos-info" },
  { path: "/pos/requests",     icon: "📋", label: "Hub",       short: "Hub",  tour: "pos-hub"  },
];

function CartIcon({ color = "#fff", size = 22 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* handle */}
      <path d="M2 2h2.5l1.72 8.6" stroke={color} strokeWidth="1.7" strokeLinecap="round"/>
      {/* basket body */}
      <rect x="6.5" y="9" width="13" height="8.5" rx="1.5" stroke={color} strokeWidth="1.7"/>
      {/* vertical grid lines inside basket */}
      <line x1="10.5" y1="9" x2="10.5" y2="17.5" stroke={color} strokeWidth="1.1" strokeOpacity="0.6"/>
      <line x1="14"   y1="9" x2="14"   y2="17.5" stroke={color} strokeWidth="1.1" strokeOpacity="0.6"/>
      {/* horizontal grid line inside basket */}
      <line x1="6.5" y1="13.2" x2="19.5" y2="13.2" stroke={color} strokeWidth="1.1" strokeOpacity="0.6"/>
      {/* wheels */}
      <circle cx="9.5"  cy="21" r="1.2" fill={color}/>
      <circle cx="16.5" cy="21" r="1.2" fill={color}/>
    </svg>
  );
}

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
              <div
                key={tab.path}
                style={{
                  flex: 1,
                  position: "relative",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "flex-end",
                }}>
                <button
                  data-tour={tab.tour}
                  className="bnav-btn bnav-scan-pill"
                  onClick={() => navigate(tab.path)}
                  style={{
                    position: "absolute",
                    top: -22,
                    width: 58,
                    height: 58,
                    borderRadius: "50%",
                    background: isActive
                      ? "linear-gradient(135deg,#06b6d4,#0284c7)"
                      : "linear-gradient(135deg,rgba(6,182,212,0.28),rgba(2,132,199,0.18))",
                    boxShadow: isActive
                      ? "0 0 20px rgba(6,182,212,0.55), 0 4px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.15)"
                      : "0 0 12px rgba(6,182,212,0.2), 0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)",
                    border: `3px solid ${theme.bg.nav}`, // creates the "cutout" ring effect from the ref image
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}>
                  <CartIcon color={isActive ? "#fff" : "#67e8f9"} size={24} />
                </button>
                <span style={{
                  fontSize: 9,
                  fontFamily: "DM Mono, monospace",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: isActive ? theme.accent.cyan : theme.text.muted,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}>
                  {compact ? tab.short : tab.label}
                </span>
              </div>
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
