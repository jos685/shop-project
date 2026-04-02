import { useState } from "react";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";

export default function PosLogin() {
  const { login } = useShopAuth();
  const { theme } = useTheme();

  const [businessCode, setBusinessCode] = useState("");
  const [shopCode,     setShopCode]     = useState("");
  const [password,     setPassword]     = useState("");
  const [showPw,       setShowPw]       = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessCode.trim() || !shopCode.trim() || !password.trim()) {
      setError("All fields are required.");
      return;
    }
    setLoading(true);
    setError("");
    const err = await login(businessCode, shopCode, password);
    if (err) { setError(err); setLoading(false); }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: theme.bg.base,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: theme.font.body,
      padding: 20,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Background grid pattern */}
      <div style={{
        position: "absolute", inset: 0, opacity: 0.03,
        backgroundImage: "linear-gradient(rgba(6,182,212,1) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,1) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
        pointerEvents: "none",
      }} />

      {/* Glow */}
      <div style={{
        position: "absolute", top: "30%", left: "50%", transform: "translate(-50%,-50%)",
        width: 600, height: 600, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes fadeUp   { from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin     { to{transform:rotate(360deg)} }
        @keyframes shake    { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-6px)} 40%,80%{transform:translateX(6px)} }
        @keyframes pulse    { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.6;transform:scale(0.97)} }
        .kiosk-card { animation: fadeUp 0.5s ease both; }
        .shake { animation: shake 0.4s ease; }
        .kiosk-input { 
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 16px 18px;
          color: #f9fafb;
          font-size: 16px;
          font-family: 'DM Mono', monospace;
          width: 100%;
          box-sizing: border-box;
          letter-spacing: 0.08em;
          transition: border-color 0.2s;
        }
        .kiosk-input:focus { outline: none; border-color: rgba(6,182,212,0.5); background: rgba(6,182,212,0.04); }
        .kiosk-input::placeholder { color: #374151; letter-spacing: 0.04em; }
        .kiosk-btn {
          width: 100%;
          padding: 18px;
          border: none;
          border-radius: 14px;
          font-family: 'Syne', sans-serif;
          font-weight: 800;
          font-size: 16px;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
          letter-spacing: 0.02em;
        }
        .kiosk-btn:active { transform: scale(0.98); }
        .kiosk-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>

      <div className="kiosk-card" style={{ width: "100%", maxWidth: 440 }}>

        {/* Logo mark */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            width: 72, height: 72,
            background: "linear-gradient(135deg, #eab308, #f59e0b)",
            borderRadius: 20,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 32, color: "#000",
            margin: "0 auto 18px",
            boxShadow: "0 0 40px rgba(234,179,8,0.25)",
          }}>S</div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 28, color: "#f9fafb", letterSpacing: "-0.03em" }}>
            SalesTrack
          </div>
          <div style={{ color: "#4b5563", fontSize: 13, fontFamily: "'DM Mono', monospace", marginTop: 6, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Point of Sale Terminal
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: "#0d1117",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 22,
          padding: "36px 32px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Shop Sign In</div>
          <div style={{ color: "#4b5563", fontSize: 12, fontFamily: "'DM Mono', monospace", marginBottom: 28, lineHeight: 1.6 }}>
            Enter your credentials to access the terminal
          </div>

          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ color: "#6b7280", fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                Business Code
              </label>
              <input
                className="kiosk-input"
                value={businessCode}
                onChange={e => { setBusinessCode(e.target.value.toUpperCase()); setError(""); }}
                placeholder="e.g. ACME-001"
                autoComplete="off"
                autoCapitalize="characters"
                disabled={loading}
              />
            </div>

            <div>
              <label style={{ color: "#6b7280", fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                Shop ID
              </label>
              <input
                className="kiosk-input"
                value={shopCode}
                onChange={e => { setShopCode(e.target.value.toUpperCase()); setError(""); }}
                placeholder="e.g. SHP-0001"
                autoComplete="off"
                autoCapitalize="characters"
                disabled={loading}
              />
            </div>

            <div>
              <label style={{ color: "#6b7280", fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                Password
              </label>
              <div style={{ position: "relative" }}>
                <input
                  className="kiosk-input"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(""); }}
                  placeholder="••••••••"
                  autoComplete="off"
                  disabled={loading}
                  style={{ paddingRight: 52 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(p => !p)}
                  style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#4b5563", fontSize: 18, padding: 0 }}
                >
                  {showPw ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            {error && (
              <div className="shake" style={{
                background: "rgba(248,113,113,0.08)",
                border: "1px solid rgba(248,113,113,0.2)",
                borderRadius: 10, padding: "12px 16px",
                color: "#f87171", fontSize: 13,
                fontFamily: "'DM Mono', monospace",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>⚠</span> {error}
              </div>
            )}

            <button
              className="kiosk-btn"
              type="submit"
              disabled={loading}
              style={{
                marginTop: 8,
                background: loading
                  ? "rgba(234,179,8,0.3)"
                  : "linear-gradient(135deg, #eab308, #f59e0b)",
                color: "#000",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
              }}
            >
              {loading ? (
                <>
                  <span style={{ width: 18, height: 18, border: "2px solid rgba(0,0,0,0.2)", borderTopColor: "#000", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                  Signing in...
                </>
              ) : "Sign In to Terminal →"}
            </button>
          </form>
        </div>

        {/* Bottom badge */}
        <div style={{ textAlign: "center", marginTop: 24, color: "#1f2937", fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: "0.08em" }}>
          SALESTRACK POS · KIOSK MODE
        </div>
      </div>
    </div>
  );
}
