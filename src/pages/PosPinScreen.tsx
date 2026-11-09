// src/pages/PosPinScreen.tsx
import { useState, useEffect } from "react";
import { useTheme } from "../context/ThemeContext";
import { useShopAuth } from "../context/ShopAuthContext";


export default function PosPinScreen({ shopName, onCancel }: { shopName: string; onCancel: () => void }) {
  const { theme } = useTheme();
  const dk = theme.isDark;
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const { signInWithPin } = useShopAuth();

  useEffect(() => {
    if (pin.length === 4 && !loading) submitPin();
  }, [pin]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") setPin(prev => prev.length < 4 && !loading ? prev + e.key : prev);
      else if (e.key === "Backspace") setPin(prev => !loading ? prev.slice(0, -1) : prev);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading]);

  const submitPin = async () => {
    setLoading(true);
    const authError = await signInWithPin(pin);
    if (authError) {
      setError(true);
      setErrorMessage(authError);
      setPin("");
      setLoading(false);
      setTimeout(() => { setError(false); setErrorMessage(""); }, 2000);
    }
  };

  return (
    <div style={{ background: dk ? "#0c0a10" : "#fef3e2", height: "100dvh", width: "100vw", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: dk ? "#f1f0f5" : "#1c1917", position: "relative", overflow: "hidden" }}>
      
      <img src="/Qash.png" alt="" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "100%", maxWidth: "350px", opacity: dk ? 0.25 : 0.15, pointerEvents: "none", zIndex: 0 }} />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 320, padding: "0 20px" }}>
        
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: dk ? "rgba(249,115,22,0.2)" : "#fff7ed", border: `1px solid ${dk ? "#f97316" : "#fdba74"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, marginBottom: 16, fontWeight: 700, color: dk ? "#fdba74" : "#c2410c" }}>
          {shopName ? shopName.substring(0, 2).toUpperCase() : "SH"}
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, fontFamily: "'Plus Jakarta Sans', sans-serif", textAlign: "center" }}>
          Welcome back
        </h2>
        <p style={{ fontSize: 15, fontWeight: 500, color: dk ? "#fdba74" : "#c2410c", marginBottom: 24, textAlign: "center" }}>
        {shopName || "Your Shop"}
        </p>

        <div style={{ minHeight: 24, marginBottom: 12 }}>
          {errorMessage && <div style={{ color: "#ef4444", fontSize: 13, fontWeight: 600, textAlign: "center" }}>{errorMessage}</div>}
        </div>

        <div style={{ height: 60, marginBottom: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <div style={{ width: 36, height: 36, border: "3px solid rgba(249,115,22,0.2)", borderTopColor: "#f97316", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ fontSize: 13, color: dk ? "#8b8699" : "#78716c", fontWeight: 500 }}>Opening terminal...</span>
            </div>
          ) : (
            <div className={error ? "shaking" : ""} style={{ display: "flex", gap: 14 }}>
              {[...Array(4)].map((_, i) => (
                <div key={i} style={{ width: 60, height: 60, borderRadius: 16, border: `2px solid ${pin.length === i ? "#f97316" : (dk ? "#2e2b3a" : "#e7e5e4")}`, background: dk ? "#1e1c26" : "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, transition: "all 0.2s" }}>
                  {pin[i] ? "•" : ""}
                </div>
              ))}
            </div>
          )}
        </div>

        <button disabled={loading} onClick={onCancel} style={{ background: "none", border: "none", color: dk ? "#8b8699" : "#78716c", fontSize: 14, marginBottom: 30, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.5 : 1 }}>
          Can't remember? <span style={{ color: "#f97316", fontWeight: 500, textDecoration: "underline" }}>Sign in with password</span>
        </button>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px 32px", width: "100%", opacity: loading ? 0.3 : 1, pointerEvents: loading ? "none" : "auto" }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "<"].map((btn, i) => (
            <button
              key={i}
              onClick={() => btn === "<" ? setPin(prev => prev.slice(0, -1)) : btn !== "" && setPin(prev => prev.length < 4 ? prev + btn : prev)}
              style={{ background: "none", border: "none", color: dk ? "#f1f0f5" : "#1c1917", fontSize: 28, padding: 10, cursor: "pointer", opacity: btn === "" ? 0 : 1, fontWeight: 500 }}
              disabled={btn === "" || loading}
            >
              {btn}
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-6px)} 40%,80%{transform:translateX(6px)} }
        .shaking { animation: shake 0.42s ease !important; }
      `}</style>
    </div>
  );
}