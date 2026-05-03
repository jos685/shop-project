import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { ShopAuthProvider, useShopAuth } from "./context/ShopAuthContext";
import { NetworkProvider } from "./context/NetworkContext";
import PosLogin            from "./pages/PosLogin";
import PosDashboard        from "./pages/PosDashboard";
import PosScan             from "./pages/PosScan";
import PosShopInfo         from "./pages/PosShopInfo";
import PosTransactionsPage from "./pages/PosTransactionsPage";
import PosRequests         from "./pages/PosRequests";
import BottomNav           from "./components/BottomNav";
import ErrorBoundary       from "./components/ErrorBoundary";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { shop } = useShopAuth();
  // When logged in, float above the bottom nav to avoid overlapping page headers
  const pos = shop
    ? { bottom: 76, right: 12, top: "auto" as const }
    : { top: 12,   right: 12, bottom: "auto" as const };
  return (
    <button
      onClick={toggleTheme}
      title={theme.isDark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        position: "fixed", ...pos, zIndex: 999,
        width: 38, height: 38, borderRadius: "50%",
        background: theme.bg.card,
        border: `1px solid ${theme.border.default}`,
        boxShadow: theme.isDark
          ? "0 2px 12px rgba(0,0,0,0.4)"
          : "0 2px 12px rgba(0,0,0,0.12)",
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 17,
        transition: "background 0.2s, border-color 0.2s, box-shadow 0.2s",
      }}>
      {theme.isDark ? "☀️" : "🌙"}
    </button>
  );
}

// ── Route guard ───────────────────────────────────────────────
function Protected({ children }: { children: React.ReactNode }) {
  const { shop, loading } = useShopAuth();
  const { theme } = useTheme();
  if (loading) return (
    <div style={{ minHeight: "100vh", background: theme.bg.base, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 32, height: 32, border: `3px solid ${theme.border.default}`, borderTopColor: theme.accent.cyan, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
  return shop ? <>{children}</> : <Navigate to="/pos/login" replace />;
}

function PosApp() {
  const { shop } = useShopAuth();
  return (
    <>
      <ThemeToggle />
      <Routes>
        <Route path="/pos/login" element={shop ? <Navigate to="/pos" replace /> : <PosLogin />} />
        <Route path="/pos"      element={<Protected><PosDashboard /></Protected>} />
        <Route path="/pos/scan" element={<Protected><PosScan /></Protected>} />
        <Route path="/pos/transactions" element={<Protected><PosTransactionsPage /></Protected>} />
        <Route path="/pos/info"         element={<Protected><PosShopInfo /></Protected>} />
        <Route path="/pos/requests"     element={<Protected><PosRequests /></Protected>} />
        <Route path="*"         element={<Navigate to="/pos" replace />} />
      </Routes>
      <BottomNav />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ShopAuthProvider>
          <NetworkProvider>
            <BrowserRouter>
              <PosApp />
            </BrowserRouter>
          </NetworkProvider>
        </ShopAuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
