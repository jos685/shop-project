import { useState, useEffect } from "react";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";
import { useNetwork } from "../context/NetworkContext";
import { useLoginSecurity } from "../lib/useLoginSecurity";
import { sanitizeCode, sanitizePassword } from "../lib/sanitize";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: "Good morning!", icon: "☀️", sub: "Ready to open shop for the day?" };
  if (h < 17) return { text: "Good afternoon!", icon: "🌤️", sub: "Hope the sales are going well." };
  return { text: "Good evening!", icon: "🌙", sub: "Wrapping up a great day of sales?" };
}

export default function PosLogin() {
  const { login } = useShopAuth();
  const { theme, toggleTheme } = useTheme();
  const { isOnline } = useNetwork();
  const dk = theme.isDark;
  const security = useLoginSecurity();

    const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isInstalled,   setIsInstalled]   = useState(() =>
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
  const [showIosHint,   setShowIosHint]   = useState(false);
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    const installed = () => { setIsInstalled(true); setInstallPrompt(null); };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  const handleInstall = async () => {
  if (isIos) { setShowIosHint(h => !h); return; }
  if (!installPrompt) {
    // Brave, Firefox, Safari desktop, or Chrome before prompt fires
    setShowIosHint(h => !h);  // reuse the same hint toggle
    return;
  }
  await installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  if (outcome === "accepted") { setIsInstalled(true); setInstallPrompt(null); }
};

  const [businessCode, setBusinessCode] = useState("");
  const [shopSuffix,   setShopSuffix]   = useState("");
  const [password,     setPassword]     = useState("");
  const [showPw,       setShowPw]       = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");
  const [shake,        setShake]        = useState(false);

  const greeting = getGreeting();

  const triggerShake = () => { setShake(true); setTimeout(() => setShake(false), 400); };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (security.isLocked) return;
    if (!security.canAttempt()) return;
    if (!businessCode.trim() || !shopSuffix.trim() || !password.trim()) {
      setError("Please fill in all fields before signing in.");
      triggerShake();
      return;
    }
    setLoading(true);
    setError("");
    const err = await login(businessCode, "SHP-" + shopSuffix.trim().toUpperCase(), password);
    if (err) {
      if (err === "offline_no_cache") {
        setError("No offline data found. Connect to the internet and sign in at least once before using offline mode on this device.");
      } else if (err === "offline_wrong_password") {
        security.onFailure();
        setError("Invalid credentials. Please check your details and try again.");
      } else {
        security.onFailure();
        setError("Invalid credentials. Please check your details and try again.");
      }
      setLoading(false);
      triggerShake();
    } else {
      security.onSuccess();
    }
  };

  const attemptsLeft = Math.max(0, 5 - security.failures);
  const isLocked     = security.isLocked;

  return (
    <div className="est-page">
    <div className="est-root">
      <style>{`
        

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .est-page {
          min-height: 100vh;
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          font-family: 'Inter', system-ui, sans-serif;
        }

           .est-root {
            width: 100%;
            max-width: 900px;
            max-height: calc(100vh - 32px);
            max-height: calc(100dvh - 32px);
            display: grid;
            grid-template-columns: 44% 56%;
            border-radius: 22px;
            overflow: hidden;
            box-shadow: 0 24px 80px rgba(194,65,12,0.14), 0 4px 20px rgba(0,0,0,0.08);
          }

        /* ── LEFT WARM PANEL ── */
        .est-panel {
          position: relative;
          background: linear-gradient(150deg, #f97316 0%, #ea580c 45%, #c2410c 100%);
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 32px 32px;
          overflow: hidden;
        }

        .est-blob1 {
          position: absolute; border-radius: 50%;
          width: 320px; height: 320px;
          background: rgba(255,255,255,0.07);
          top: -80px; right: -80px;
          pointer-events: none;
        }
        .est-blob2 {
          position: absolute; border-radius: 50%;
          width: 240px; height: 240px;
          background: rgba(255,255,255,0.06);
          bottom: 60px; left: -60px;
          pointer-events: none;
        }
        .est-blob3 {
          position: absolute; border-radius: 50%;
          width: 140px; height: 140px;
          background: rgba(255,255,255,0.05);
          bottom: 200px; right: 40px;
          pointer-events: none;
        }

        .est-panel-logo {
          width: 96px; height: 64px;
          background: rgba(255,255,255,0.2);
          backdrop-filter: blur(8px);
          border: 2px solid rgba(255,255,255,0.35);
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          margin-bottom: 20px;
          position: relative; z-index: 1;
        }

        .est-panel-logo img {
          width: 100%; height: 100%; object-fit: contain;
        }

        .est-panel-tagline {
          font-size: 13px;
          color: rgba(255,255,255,0.82);
          line-height: 1.5;
          position: relative; z-index: 1;
          margin-bottom: 24px;
          max-width: 260px;
        }

        .est-features {
          display: flex; flex-direction: column; gap: 10px;
          position: relative; z-index: 1;
        }

        .est-feature {
          display: flex; align-items: flex-start; gap: 12px;
        }

        .est-feature-icon {
          width: 30px; height: 30px; border-radius: 9px;
          background: rgba(255,255,255,0.18);
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; flex-shrink: 0;
        }

        .est-feature-text strong {
          display: block;
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          font-family: 'Plus Jakarta Sans', sans-serif;
          margin-bottom: 2px;
        }

        .est-feature-text span {
          color: rgba(255,255,255,0.7);
          font-size: 12px;
          line-height: 1.4;
        }

        .est-panel-footer {
          margin-top: 20px;
          font-size: 10px;
          color: rgba(255,255,255,0.45);
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-family: 'Inter', system-ui, sans-serif;
          position: relative; z-index: 1;
        }

        /* ── RIGHT FORM SIDE ── */
        .est-form-side {
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 28px 36px;
          overflow-y: auto;
          scrollbar-width: thin;
        }

        .est-greeting-icon {
          font-size: 26px;
          margin-bottom: 2px;
          display: block;
          line-height: 1;
        }

        .est-greeting-text {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-weight: 900;
          font-size: 22px;
          color: #1c1917;
          letter-spacing: -0.02em;
          margin-bottom: 2px;
          line-height: 1.15;
        }

        .est-greeting-sub {
          font-size: 13px;
          color: #78716c;
          margin-bottom: 20px;
          line-height: 1.45;
        }

        .est-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 10px;
        }

        .est-label {
          font-size: 12px;
          font-weight: 600;
          color: #44403c;
          font-family: 'Inter', system-ui, sans-serif;
        }

        .est-input {
          width: 100%;
          padding: 10px 14px;
          border-radius: 10px;
          border-style: solid;
          border-width: 1.5px;
          font-size: 15px;
          font-family: 'Inter', system-ui, sans-serif;
          transition: border-color 0.18s, box-shadow 0.18s;
          outline: none;
        }
        .est-input:disabled { opacity: 0.55; cursor: not-allowed; }

        .est-prefix-wrap {
          display: flex;
          align-items: stretch;
          border-radius: 12px;
          border: 1.5px solid ${dk ? "#2e2b3a" : "#e7e5e4"};
          overflow: hidden;
          transition: border-color 0.18s, box-shadow 0.18s;
          background: ${dk ? "#1e1c26" : "#ffffff"};
        }
        .est-prefix-wrap:focus-within {
          border-color: #f97316;
          box-shadow: 0 0 0 3px ${dk ? "rgba(249,115,22,0.22)" : "rgba(249,115,22,0.12)"};
        }
        .est-prefix-badge {
          padding: 10px 10px 10px 14px;
          font-size: 14px;
          font-family: 'Inter', system-ui, sans-serif;
          font-weight: 600;
          color: ${dk ? "#8b8699" : "#78716c"};
          background: ${dk ? "#161320" : "#f5f5f4"};
          border-right: 1.5px solid ${dk ? "#2e2b3a" : "#e7e5e4"};
          user-select: none;
          white-space: nowrap;
          display: flex;
          align-items: center;
        }
        .est-prefix-input {
          flex: 1;
          padding: 10px 14px;
          border: none;
          outline: none;
          font-size: 14px;
          font-family: 'Inter', system-ui, sans-serif;
          background: transparent;
          color: ${dk ? "#f1f0f5" : "#1c1917"};
          min-width: 0;
        }
        .est-prefix-input::placeholder { color: ${dk ? "#5a5669" : "#a8a29e"}; }
        .est-prefix-input:disabled { opacity: 0.55; cursor: not-allowed; }

        .est-pw-wrap {
          position: relative;
        }
        .est-pw-wrap .est-input {
          padding-right: 48px;
        }
        .est-pw-toggle {
          position: absolute; right: 14px; top: 50%;
          transform: translateY(-50%);
          background: none; border: none; cursor: pointer;
          color: #a8a29e; font-size: 18px; padding: 0;
          line-height: 1;
          transition: color 0.15s;
        }
        .est-pw-toggle:hover { color: #78716c; }

        .est-error {
          display: flex; align-items: flex-start; gap: 10px;
          background: #fff5f5;
          border: 1.5px solid #fecaca;
          border-radius: 10px;
          padding: 10px 12px;
          margin-bottom: 6px;
        }
        .est-error-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
        .est-error-msg { font-size: 13px; color: #ef4444; line-height: 1.5; }

        @keyframes est-shake {
          0%,100% { transform: translateX(0); }
          20%,60%  { transform: translateX(-5px); }
          40%,80%  { transform: translateX(5px); }
        }
        .est-shake { animation: est-shake 0.35s ease; }

        @keyframes est-spin { to { transform: rotate(360deg); } }
        @keyframes est-fadeup {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .est-btn {
          width: 100%;
          padding: 12px;
          border: none;
          border-radius: 12px;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-weight: 800;
          font-size: 15px;
          cursor: pointer;
          transition: transform 0.1s, box-shadow 0.15s, background 0.15s;
          display: flex; align-items: center; justify-content: center; gap: 10px;
          margin-top: 6px;
          letter-spacing: 0.01em;
        }
        .est-btn:not(:disabled):hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(249,115,22,0.32);
        }
        .est-btn:active { transform: scale(0.985); }
        .est-btn:disabled { cursor: not-allowed; opacity: 0.7; }

        .est-form-footer {
          margin-top: 18px;
          padding-top: 14px;
          border-top: 1px solid #f5f5f4;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .est-form-footer-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #4ade80;
          box-shadow: 0 0 0 3px rgba(74,222,128,0.18);
        }
        .est-form-footer-text {
          font-size: 12px;
          color: #a8a29e;
          font-family: 'Inter', system-ui, sans-serif;
        }

        .est-form-anim {
          animation: est-fadeup 0.45s ease both;
        }

        /* ── MOBILE ── */
        @media (max-width: 760px) {
        .est-page {
          padding: 10px;
          align-items: center;
        }

        .est-root {
          grid-template-columns: 1fr;
          border-radius: 18px;
          max-height: calc(100dvh - 20px);
        }

        .est-panel {
          padding: 18px 20px;
          flex-direction: row;
          align-items: center;
          gap: 14px;
        }

        .est-panel-logo {
          width: 72px; height: 48px;
          margin-bottom: 0;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .est-panel-content-mobile { flex: 1; }
        .est-panel-tagline        { font-size: 12px; margin-bottom: 0; line-height: 1.4; }
        .est-features,
        .est-panel-footer         { display: none; }

        .est-blob1 { width: 150px; height: 150px; top: -30px; right: -30px; }
        .est-blob2, .est-blob3 { display: none; }

        .est-form-side { padding: 22px 18px 22px; }

        .est-greeting-icon { font-size: 22px; }
        .est-greeting-text { font-size: 20px; }
        .est-greeting-sub  { font-size: 12px; margin-bottom: 14px; }

        .est-input,
        .est-prefix-input,
        .est-prefix-badge  { padding: 9px 12px; font-size: 14px; }

        .est-btn           { padding: 11px; font-size: 14px; margin-top: 4px; }

        .est-form-footer   { margin-top: 14px; padding-top: 10px; }
      }

      @media (max-width: 420px) {
        .est-panel      { padding: 14px 16px; }
        .est-form-side  { padding: 18px 16px 18px; }
      }

        @media (max-width: 420px) {
          .est-panel { padding: 28px 20px 24px; }
          .est-form-side { padding: 28px 20px 72px; }
        }

        /* ── DARK MODE ── */
        .est-page          { background: ${dk ? "#0c0a10" : "#fef3e2"}; }
        .est-form-side     { background: ${dk ? "#131118" : "#fffbf4"}; }
        .est-greeting-text { color: ${dk ? "#f1f0f5" : "#1c1917"}; }
        .est-greeting-sub  { color: ${dk ? "#8b8699" : "#78716c"}; }
        .est-label         { color: ${dk ? "#c2bdd1" : "#44403c"}; }
        .est-input {
          background: ${dk ? "#1e1c26" : "#ffffff"};
          border-color: ${dk ? "#2e2b3a" : "#e7e5e4"};
          color: ${dk ? "#f1f0f5" : "#1c1917"};
        }
        .est-input:focus {
          border-color: #f97316;
          box-shadow: 0 0 0 3px ${dk ? "rgba(249,115,22,0.22)" : "rgba(249,115,22,0.12)"};
        }
        .est-input::placeholder { color: ${dk ? "#5a5669" : "#a8a29e"}; }
        .est-input:disabled     { background: ${dk ? "#181520" : "#fafaf9"}; }
        .est-pw-toggle          { color: ${dk ? "#5a5669" : "#a8a29e"}; }
        .est-pw-toggle:hover    { color: ${dk ? "#8b8699" : "#78716c"}; }
        .est-form-footer        { border-top-color: ${dk ? "#2e2b3a" : "#f5f5f4"}; }
        .est-form-footer-text   { color: ${dk ? "#5a5669" : "#a8a29e"}; }
        .est-theme-btn {
          position: absolute;
          top: 14px; right: 14px;
          width: 32px; height: 32px;
          border-radius: 50%;
          border: 1.5px solid ${dk ? "#2e2b3a" : "#e7e5e4"};
          background: ${dk ? "#1e1c26" : "#fff"};
          color: ${dk ? "#c2bdd1" : "#78716c"};
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: 16px;
          transition: border-color 0.18s, background 0.18s, transform 0.1s;
          box-shadow: ${dk ? "0 2px 8px rgba(0,0,0,0.4)" : "0 2px 8px rgba(0,0,0,0.07)"};
          z-index: 10;
        }
        .est-theme-btn:hover {
          border-color: #f97316;
          transform: scale(1.08);
        }
      `}</style>

      {/* ── LEFT PANEL ── */}
      <div className="est-panel">
        <div className="est-blob1" />
        <div className="est-blob2" />
        <div className="est-blob3" />

        {/* Mobile: row layout wrapper */}
        <div className="est-panel-logo">
          <img src="/Qash.png" alt="Qash" />
        </div>

        <div className="est-panel-content-mobile">
          <div className="est-panel-tagline">
            Every sale counts.<br />Every agent matters.
          </div>
        </div>

        <div className="est-features">
          <div className="est-feature">
            <div className="est-feature-icon">📊</div>
            <div className="est-feature-text">
              <strong>Real-time sales tracking</strong>
              <span>See every transaction as it happens, live.</span>
            </div>
          </div>
          <div className="est-feature">
            <div className="est-feature-icon">👥</div>
            <div className="est-feature-text">
              <strong>Team management</strong>
              <span>Manage agents, assign PINs, track performance.</span>
            </div>
          </div>
          <div className="est-feature">
            <div className="est-feature-icon">📦</div>
            <div className="est-feature-text">
              <strong>Live stock visibility</strong>
              <span>Always know what's on the shelf.</span>
            </div>
          </div>
        </div>

        <div className="est-panel-footer">QASHUP · POS Terminal</div>
      </div>

      {/* ── FORM SIDE ── */}
      <div className="est-form-side" style={{ position: "relative" }}>

        {/* Theme toggle */}
        <button
          type="button"
          className="est-theme-btn"
          onClick={toggleTheme}
          title={dk ? "Switch to light mode" : "Switch to dark mode"}
          aria-label="Toggle theme"
        >
          {dk ? "☀️" : "🌙"}
        </button>

        <div className="est-form-anim" style={{ maxWidth: 400, width: "100%", margin: "0 auto" }}>

          <span className="est-greeting-icon">{greeting.icon}</span>
          <div className="est-greeting-text">{greeting.text}</div>
          <div className="est-greeting-sub">{greeting.sub}<br />Sign in to get started.</div>

          {!isOnline && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              background: dk ? "rgba(220,38,38,0.08)" : "#fff5f5",
              border: "1.5px solid rgba(220,38,38,0.25)",
              borderRadius: 10, padding: "10px 12px", marginBottom: 14,
            }}>
              <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>📵</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#ef4444", marginBottom: 3, fontFamily: "Inter, sans-serif" }}>
                  You're offline
                </div>
                <div style={{ fontSize: 12, color: dk ? "#f87171" : "#dc2626", lineHeight: 1.5, fontFamily: "Inter, sans-serif" }}>
                  Sign in with your cached credentials. Sales will queue and sync when connection is restored.
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleLogin} noValidate>

            <div className="est-field">
              <label className="est-label" htmlFor="biz-code">Business Code</label>
              <input
                id="biz-code"
                className="est-input"
                value={businessCode}
                onChange={e => { setBusinessCode(sanitizeCode(e.target.value, 24)); setError(""); }}
                placeholder="e.g. ACME-001"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={24}
                disabled={loading || isLocked}
              />
            </div>

            <div className="est-field">
              <label className="est-label" htmlFor="shop-id">Shop ID</label>
              <div className="est-prefix-wrap">
                <span className="est-prefix-badge">SHP-</span>
                <input
                  id="shop-id"
                  className="est-prefix-input"
                  value={shopSuffix}
                  onChange={e => { setShopSuffix(e.target.value.replace(/\D/g, "").slice(0, 4)); setError(""); }}
                  placeholder="0001"
                  autoComplete="off"
                  inputMode="numeric"
                  spellCheck={false}
                  maxLength={4}
                  disabled={loading || isLocked}
                />
              </div>
            </div>

            <div className="est-field">
              <label className="est-label" htmlFor="password">Password</label>
              <div className="est-pw-wrap">
                <input
                  id="password"
                  className="est-input"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(sanitizePassword(e.target.value)); setError(""); }}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  maxLength={128}
                  disabled={loading || isLocked}
                />
                <button
                  type="button"
                  className="est-pw-toggle"
                  onClick={() => setShowPw(p => !p)}
                  tabIndex={-1}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  disabled={isLocked}
                >
                  {showPw ? (
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Attempt warning — shown after 2+ failures */}
            {security.failures >= 2 && !isLocked && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                background: dk ? "rgba(234,179,8,0.08)" : "#fffbeb",
                border: "1.5px solid rgba(234,179,8,0.35)",
                borderRadius: 10, padding: "9px 12px", marginBottom: 4,
              }}>
                <span style={{ fontSize: 15, flexShrink: 0 }}>⚠️</span>
                <span style={{ fontSize: 12, color: "#d97706", lineHeight: 1.5 }}>
                  {attemptsLeft} attempt{attemptsLeft !== 1 ? "s" : ""} remaining before a 30-second lockout.
                </span>
              </div>
            )}

            {error && !isLocked && (
              <div className={`est-error${shake ? " est-shake" : ""}`}>
                <span className="est-error-icon">⚠️</span>
                <span className="est-error-msg">{error}</span>
              </div>
            )}

            {/* Lockout banner */}
            {isLocked && (
              <div style={{
                display: "flex", alignItems: "center", gap: 12,
                background: dk ? "rgba(239,68,68,0.08)" : "#fff5f5",
                border: "1.5px solid rgba(239,68,68,0.3)",
                borderRadius: 12, padding: "14px 16px", marginBottom: 4,
              }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>🔒</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#ef4444", fontFamily: "Inter, sans-serif" }}>
                    Too many failed attempts
                  </div>
                  <div style={{ fontSize: 12, color: "#f87171", marginTop: 2, fontFamily: "Inter, sans-serif" }}>
                    Access locked. Try again in {security.countdown}s
                  </div>
                </div>
              </div>
            )}

            {/* Login button — shows countdown ring when locked */}
            <div style={{ position: "relative", marginTop: 8 }}>
              <button
                type="submit"
                className="est-btn"
                disabled={loading || isLocked}
                aria-disabled={isLocked}
                style={{
                  background: isLocked
                    ? (dk ? "#2a1f1f" : "#fef2f2")
                    : loading
                      ? "#fed7aa"
                      : "linear-gradient(135deg, #f97316, #ea580c)",
                  color: isLocked ? "#ef4444" : loading ? "#c2410c" : "#fff",
                  border: isLocked ? "1.5px solid rgba(239,68,68,0.35)" : "none",
                  cursor: isLocked ? "not-allowed" : "pointer",
                }}
              >
                {isLocked ? (
                  <>
                    <span style={{
                      width: 18, height: 18, borderRadius: "50%",
                      border: "2.5px solid rgba(239,68,68,0.2)",
                      borderTopColor: "#ef4444",
                      display: "inline-block",
                      animation: "est-spin 1s linear infinite",
                    }} />
                    Locked — {security.countdown}s
                  </>
                ) : loading ? (
                  <>
                    <span style={{
                      width: 18, height: 18, borderRadius: "50%",
                      border: "2.5px solid rgba(194,65,12,0.25)",
                      borderTopColor: "#c2410c",
                      display: "inline-block",
                      animation: "est-spin 0.7s linear infinite",
                    }} />
                    Signing you in…
                  </>
                ) : (
                  <>Open My Terminal →</>
                )}
              </button>
            </div>

          </form>

                    {!isInstalled && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={handleInstall}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "transparent",
                  border: `1.5px solid ${dk ? "#2e2b3a" : "#e7e5e4"}`,
                  color: dk ? "#c2bdd1" : "#44403c",
                  fontFamily: "'Inter', system-ui, sans-serif",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Install
              </button>
              {showIosHint && (
  <div style={{
    marginTop: 8,
    padding: "9px 12px",
    background: dk ? "rgba(249,115,22,0.08)" : "#fff7ed",
    border: "1px solid rgba(249,115,22,0.3)",
    borderRadius: 10,
    fontSize: 11,
    color: dk ? "#fdba74" : "#c2410c",
    lineHeight: 1.55,
    fontFamily: "'Inter', sans-serif",
  }}>
    {isIos ? (
      <>
        Tap <strong>Share</strong>{" "}
        <svg style={{ verticalAlign: "middle" }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
          <polyline points="16 6 12 2 8 6"/>
          <line x1="12" y1="2" x2="12" y2="15"/>
        </svg>
        {" "}in Safari → <strong>Add to Home Screen</strong>
      </>
    ) : (
      <>
        Tap the <strong>install icon</strong> in your browser's address bar,
        or open the browser menu (<strong>⋮</strong>) and choose
        {" "}<strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.
      </>
    )}
  </div>
)}
            </div>
          )}

          <div className="est-form-footer">
            <div className="est-form-footer-dot" style={{ background: isOnline ? "#4ade80" : "#ef4444", boxShadow: isOnline ? "0 0 0 3px rgba(74,222,128,0.18)" : "0 0 0 3px rgba(239,68,68,0.18)" }} />
            <span className="est-form-footer-text">
              {isOnline ? "Secure terminal access · QASHUP" : "Offline mode · cached login available"}
            </span>
          </div>

        </div>
      </div>
    </div>
    </div>
  );
}
