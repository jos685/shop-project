import { useState } from "react";
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
        setError("Incorrect password. Your offline credentials don't match — check your password and try again.");
      } else {
        security.onFailure();
        setError(err);
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
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Inter:wght@400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .est-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px 20px;
          font-family: 'Inter', sans-serif;
        }

        .est-root {
          width: 100%;
          max-width: 920px;
          display: grid;
          grid-template-columns: 46% 54%;
          border-radius: 24px;
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
          padding: 52px 44px;
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
          width: 72px; height: 72px;
          background: rgba(255,255,255,0.2);
          backdrop-filter: blur(8px);
          border: 2px solid rgba(255,255,255,0.35);
          border-radius: 20px;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          margin-bottom: 28px;
          position: relative; z-index: 1;
        }
        .est-panel-logo img {
          width: 100%; height: 100%; object-fit: contain;
        }

        .est-panel-tagline {
          font-size: 15px;
          color: rgba(255,255,255,0.82);
          line-height: 1.6;
          position: relative; z-index: 1;
          margin-bottom: 40px;
          max-width: 280px;
        }

        .est-features {
          display: flex; flex-direction: column; gap: 16px;
          position: relative; z-index: 1;
        }

        .est-feature {
          display: flex; align-items: flex-start; gap: 12px;
        }

        .est-feature-icon {
          width: 34px; height: 34px; border-radius: 10px;
          background: rgba(255,255,255,0.18);
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; flex-shrink: 0;
        }

        .est-feature-text strong {
          display: block;
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          font-family: 'Nunito', sans-serif;
          margin-bottom: 2px;
        }

        .est-feature-text span {
          color: rgba(255,255,255,0.7);
          font-size: 12px;
          line-height: 1.4;
        }

        .est-panel-footer {
          margin-top: 40px;
          font-size: 11px;
          color: rgba(255,255,255,0.45);
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-family: 'Inter', sans-serif;
          position: relative; z-index: 1;
        }

        /* ── RIGHT FORM SIDE ── */
        .est-form-side {
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 48px 52px;
          overflow-y: auto;
        }

        .est-greeting-icon {
          font-size: 36px;
          margin-bottom: 8px;
          display: block;
        }

        .est-greeting-text {
          font-family: 'Nunito', sans-serif;
          font-weight: 900;
          font-size: 28px;
          color: #1c1917;
          letter-spacing: -0.02em;
          margin-bottom: 4px;
        }

        .est-greeting-sub {
          font-size: 14px;
          color: #78716c;
          margin-bottom: 36px;
          line-height: 1.5;
        }

        .est-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 18px;
        }

        .est-label {
          font-size: 13px;
          font-weight: 600;
          color: #44403c;
          font-family: 'Inter', sans-serif;
        }

        .est-input {
          width: 100%;
          padding: 13px 16px;
          border-radius: 12px;
          border-style: solid;
          border-width: 1.5px;
          font-size: 15px;
          font-family: 'Inter', sans-serif;
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
          padding: 13px 12px 13px 16px;
          font-size: 15px;
          font-family: 'Inter', sans-serif;
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
          padding: 13px 16px;
          border: none;
          outline: none;
          font-size: 15px;
          font-family: 'Inter', sans-serif;
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
          border-radius: 12px;
          padding: 13px 15px;
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
          padding: 15px;
          border: none;
          border-radius: 14px;
          font-family: 'Nunito', sans-serif;
          font-weight: 800;
          font-size: 16px;
          cursor: pointer;
          transition: transform 0.1s, box-shadow 0.15s, background 0.15s;
          display: flex; align-items: center; justify-content: center; gap: 10px;
          margin-top: 8px;
          letter-spacing: 0.01em;
        }
        .est-btn:not(:disabled):hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(249,115,22,0.32);
        }
        .est-btn:active { transform: scale(0.985); }
        .est-btn:disabled { cursor: not-allowed; opacity: 0.7; }

        .est-form-footer {
          margin-top: 32px;
          padding-top: 20px;
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
          font-family: 'Inter', sans-serif;
        }

        .est-form-anim {
          animation: est-fadeup 0.45s ease both;
        }

        /* ── MOBILE ── */
        @media (max-width: 760px) {
          .est-page {
            padding: 16px;
            align-items: flex-start;
          }

          .est-root {
            grid-template-columns: 1fr;
            border-radius: 20px;
          }

          .est-panel {
            padding: 28px 24px;
            flex-direction: row;
            align-items: center;
            gap: 16px;
          }

          .est-panel-logo {
            width: 56px; height: 56px;
            font-size: 26px;
            margin-bottom: 0;
            border-radius: 16px;
            flex-shrink: 0;
          }

          .est-panel-content-mobile {
            flex: 1;
          }

          .est-panel-title {
            font-size: 22px;
            margin-bottom: 4px;
          }

          .est-panel-tagline {
            font-size: 13px;
            margin-bottom: 0;
          }

          .est-features { display: none; }
          .est-panel-footer { display: none; }
          .est-blob1 { width: 180px; height: 180px; top: -40px; right: -40px; }
          .est-blob2 { display: none; }
          .est-blob3 { display: none; }

          .est-form-side {
            padding: 32px 24px 56px;
          }

          .est-greeting-text { font-size: 24px; }
          .est-greeting-icon { font-size: 30px; }
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
          top: 18px; right: 18px;
          width: 36px; height: 36px;
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
              borderRadius: 12, padding: "13px 15px", marginBottom: 20,
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
                  {showPw ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            {/* Attempt warning — shown after 2+ failures */}
            {security.failures >= 2 && !isLocked && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                background: dk ? "rgba(234,179,8,0.08)" : "#fffbeb",
                border: "1.5px solid rgba(234,179,8,0.35)",
                borderRadius: 12, padding: "11px 14px", marginBottom: 4,
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
