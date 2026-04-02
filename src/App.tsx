import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { ShopAuthProvider, useShopAuth } from "./context/ShopAuthContext";
import PosLogin            from "./pages/PosLogin";
import PosDashboard        from "./pages/PosDashboard";
import PosScan             from "./pages/PosScan";
import PosShopInfo         from "./pages/PosShopInfo";
import PosTransactionsPage from "./pages/PosTransactionsPage";

// ── Bottom nav for the POS kiosk ─────────────────────────────
function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { shop }  = useShopAuth();
  if (!shop) return null;
  // Hide bottom nav on scan page — full screen experience
  if (location.pathname === "/pos/scan") return null;
  // Hide bottom nav on transactions page — has its own header nav
  if (location.pathname === "/pos/transactions") return null;

  const tabs = [
    { path: "/pos",              icon: "▦",  label: "Dashboard"    },
    { path: "/pos/scan",         icon: "📷", label: "Scan & Sell"  },
    { path: "/pos/transactions", icon: "🧾", label: "Transactions" },
    { path: "/pos/info",         icon: "📦", label: "Shop Info"    },
  ];

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50,
      background: "#0d1117",
      borderTop: "1px solid rgba(255,255,255,0.07)",
      display: "flex",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
    }}>
      {tabs.map(tab => {
        const isActive = location.pathname === tab.path;
        const isScan   = tab.path === "/pos/scan";
        return (
          <button key={tab.path}
            onClick={() => navigate(tab.path)}
            style={{
              flex: 1,
              padding: isScan ? "10px 0 12px" : "10px 0 12px",
              border: "none",
              background: isScan
                ? isActive ? "linear-gradient(135deg,#0891b2,#06b6d4)" : "linear-gradient(135deg,rgba(6,182,212,0.2),rgba(6,182,212,0.1))"
                : "transparent",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              borderTop: !isScan && isActive ? "2px solid #06b6d4" : "2px solid transparent",
              marginTop: -1,
            }}>
            <span style={{ fontSize: isScan ? 22 : 18, lineHeight: 1 }}>{tab.icon}</span>
            <span style={{
              fontSize: 10,
              fontFamily: "DM Mono, monospace",
              color: isScan ? "#fff" : isActive ? "#06b6d4" : "#4b5563",
              fontWeight: isActive ? 600 : 400,
              letterSpacing: "0.02em",
            }}>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Route guard ───────────────────────────────────────────────
function Protected({ children }: { children: React.ReactNode }) {
  const { shop, loading } = useShopAuth();
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#080c12", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 32, height: 32, border: "3px solid rgba(6,182,212,0.2)", borderTopColor: "#06b6d4", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
  return shop ? <>{children}</> : <Navigate to="/pos/login" replace />;
}

function PosApp() {
  const { shop } = useShopAuth();
  return (
    <>
      <Routes>
        <Route path="/pos/login" element={shop ? <Navigate to="/pos" replace /> : <PosLogin />} />
        <Route path="/pos"      element={<Protected><PosDashboard /></Protected>} />
        <Route path="/pos/scan" element={<Protected><PosScan /></Protected>} />
        <Route path="/pos/transactions" element={<Protected><PosTransactionsPage /></Protected>} />
        <Route path="/pos/info"         element={<Protected><PosShopInfo /></Protected>} />
        <Route path="*"         element={<Navigate to="/pos" replace />} />
      </Routes>
      <BottomNav />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ShopAuthProvider>
        <BrowserRouter>
          <PosApp />
        </BrowserRouter>
      </ShopAuthProvider>
    </ThemeProvider>
  );
}
