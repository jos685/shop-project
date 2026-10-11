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

  useEffect(() => {
    const handler = () => setShowTour(true);
    window.addEventListener("shop:start-tour", handler);
    return () => window.removeEventListener("shop:start-tour", handler);
  }, []);

  // ── Safety net: if hasAuthSession stays false for 10s while we have a
  //    shop, we're stuck waiting on something that will never resolve.
  //    Log the shop out so they land on the login page and can retry.
  useEffect(() => {
    if (!shop || hasAuthSession || loading) return;
    const t = setTimeout(() => {
      console.warn("Auth session never established — logging out");
      logout();
    }, 10_000);
    return () => clearTimeout(t);
  }, [shop, hasAuthSession, loading, logout]);

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

  // 3. Logged in but no Supabase JWT yet — hold the splash.
  //    This is the key line: without it, page components mount, fire
  //    shop-scoped reads with the anon key, and get 0 rows back.
  if (!hasAuthSession) return <LoadingScreen />;

  // 4. Fully authed — subscription guard wraps every shop page
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
