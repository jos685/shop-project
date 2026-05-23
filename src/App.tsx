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
import ShopOnboardingTour  from "./components/ShopOnboardingTour";
import ErrorBoundary       from "./components/ErrorBoundary";
import { PwaUpdatePrompt, PwaInstallBanner } from "./components/PwaPrompts";


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
  const [showTour, setShowTour] = useState(false);

  // Auto-show tour on first login for this shop
  useEffect(() => {
    if (!shop) return;
    const seen = localStorage.getItem(`pos_tour_shown_${shop.id}`);
    if (!seen) setShowTour(true);
  }, [shop?.id]);

  // Allow any page to trigger the tour via a custom event
  useEffect(() => {
    const handler = () => setShowTour(true);
    window.addEventListener("shop:start-tour", handler);
    return () => window.removeEventListener("shop:start-tour", handler);
  }, []);

  return (
    <>
      <TopNav />
      {/* Push all page content below the fixed TopNav (58 px) */}
      <div style={{ paddingTop: shop ? 58 : 0 }}>
        <Routes>
          <Route path="/pos/login" element={shop ? <Navigate to="/pos" replace /> : <PosLogin />} />
          <Route path="/pos"      element={<Protected><PosDashboard /></Protected>} />
          <Route path="/pos/scan" element={<Protected><PosScan /></Protected>} />
          <Route path="/pos/transactions" element={<Protected><PosTransactionsPage /></Protected>} />
          <Route path="/pos/info"         element={<Protected><PosShopInfo /></Protected>} />
          <Route path="/pos/requests"     element={<Protected><PosRequests /></Protected>} />
          <Route path="*"         element={<Navigate to="/pos" replace />} />
        </Routes>
      </div>
      <BottomNav />

      {/* Shop onboarding tour */}
      {showTour && shop && (
        <ShopOnboardingTour
          shopId={shop.id}
          shopName={shop.name}
          onDone={() => setShowTour(false)}
        />
      )}
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
          </NetworkProvider>
        </ShopAuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
