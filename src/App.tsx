import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { ShopAuthProvider, useShopAuth } from "./context/ShopAuthContext";
import PosLogin            from "./pages/PosLogin";
import PosDashboard        from "./pages/PosDashboard";
import PosScan             from "./pages/PosScan";
import PosShopInfo         from "./pages/PosShopInfo";
import PosTransactionsPage from "./pages/PosTransactionsPage";
import PosRequests         from "./pages/PosRequests";
import BottomNav           from "./components/BottomNav";

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
        <Route path="/pos/requests"     element={<Protected><PosRequests /></Protected>} />
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
