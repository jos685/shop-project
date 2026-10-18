import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
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
import TopNav             from "./components/TopNav";
import ShopSubscriptionGuard from "./components/ShopSubscriptionGuard";
import ShopOnboardingTour  from "./components/ShopOnboardingTour";
import ErrorBoundary       from "./components/ErrorBoundary";
import { PwaUpdatePrompt, PwaInstallBanner, PwaReinstallNudge } from "./components/PwaPrompts";


// ── Loading splash ────────────────────────────────────────────
function LoadingScreen() {
  const { theme } = useTheme();
  return (
    <div style={{
      minHeight: "100vh", background: theme.bg.base,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        width: 32, height: 32,
        border: `3px solid ${theme.border.default}`,
        borderTopColor: theme.accent.cyan,
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function PosApp() {
  const { shop, loading, hasAuthSession, logout } = useShopAuth();
  const [showTour, setShowTour] = useState(false);
  const [authTimeout, setAuthTimeout] = useState(false);

  useEffect(() => {
    const handler = () => setShowTour(true);
    window.addEventListener("shop:start-tour", handler);
    return () => window.removeEventListener("shop:start-tour", handler);
  }, []);

  // ── Safety net: If the session takes too long to hydrate, pause and show a Retry UI.
  //    Do NOT automatically log out, as a slow connection might just need a few more seconds.
  useEffect(() => {
    if (!shop || hasAuthSession || loading) {
      setAuthTimeout(false);
      return;
    }
    const t = setTimeout(() => {
      console.warn("Auth session taking too long to hydrate");
      setAuthTimeout(true);
    }, 15_000); // Increased to 15 seconds
    return () => clearTimeout(t);
  }, [shop, hasAuthSession, loading]);

  // 1. Auth still hydrating
  if (loading) return <LoadingScreen />;

  // 2. Not logged in — login only
  if (!shop) {
    return (
      <>
        <TopNav />
        <Routes>
          <Route path="/pos/login" element={<PosLogin />} />
          <Route path="*" element={<Navigate to="/pos/login" replace />} />
        </Routes>
        <BottomNav />
      </>
    );
  }

  // 3. Logged in but no Supabase JWT yet
  if (!hasAuthSession) {
    if (authTimeout) {
      // Show a friendly retry screen instead of force-logging out
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", padding: 20, textAlign: "center", background: "#0f172a", color: "#fff" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📡</div>
          <h2 style={{ fontFamily: "Syne, sans-serif", marginBottom: 12 }}>Connection Issue</h2>
          <p style={{ color: "#94a3b8", marginBottom: 24, maxWidth: 300, fontFamily: "monospace", fontSize: 13 }}>
            We're having trouble verifying your secure session. This usually happens due to a slow internet connection.
          </p>
          <button 
            onClick={() => window.location.reload()} 
            style={{ padding: "14px 28px", background: "#06b6d4", color: "#fff", border: "none", borderRadius: 12, fontWeight: "bold", cursor: "pointer", fontSize: 14 }}
          >
            🔄 Retry Connection
          </button>
          <button 
            onClick={logout} 
            style={{ marginTop: 20, background: "none", border: "none", color: "#64748b", textDecoration: "underline", cursor: "pointer", fontSize: 12 }}
          >
            Sign out and use another account
          </button>
        </div>
      );
    }
    return <LoadingScreen />;
  }

  // 4. Fully authed
  return (
    <>
      <TopNav />
      <div style={{ paddingTop: 58 }}>
        <ShopSubscriptionGuard>
          <Routes>
            <Route path="/pos"              element={<PosDashboard />}        />
            <Route path="/pos/scan"         element={<PosScan />}             />
            <Route path="/pos/transactions" element={<PosTransactionsPage />} />
            <Route path="/pos/info"         element={<PosShopInfo />}         />
            <Route path="/pos/requests"     element={<PosRequests />}         />
            <Route path="/pos/login"        element={<Navigate to="/pos" replace />} />
            <Route path="*"                 element={<Navigate to="/pos" replace />} />
          </Routes>

          {showTour && (
            <ShopOnboardingTour
              shopId={shop.id}
              shopName={shop.name}
              onDone={() => setShowTour(false)}
            />
          )}
        </ShopSubscriptionGuard>
      </div>
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
            <PwaUpdatePrompt />
            <PwaInstallBanner />
            <PwaReinstallNudge />
          </NetworkProvider>
        </ShopAuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
