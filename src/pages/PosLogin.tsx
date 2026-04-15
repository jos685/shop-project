import { useState } from "react";
import { useShopAuth } from "../context/ShopAuthContext";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: "Good morning!", icon: "☀️", sub: "Ready to open shop for the day?" };
  if (h < 17) return { text: "Good afternoon!", icon: "🌤️", sub: "Hope the sales are going well." };
  return { text: "Good evening!", icon: "🌙", sub: "Wrapping up a great day of sales?" };
}

export default function PosLogin() {
  const { login } = useShopAuth();

  const [businessCode, setBusinessCode] = useState("");
  const [shopCode,     setShopCode]     = useState("");
  const [password,     setPassword]     = useState("");
  const [showPw,       setShowPw]       = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");

  const greeting = getGreeting();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessCode.trim() || !shopCode.trim() || !password.trim()) {
      setError("Please fill in all fields before signing in.");
      return;
    }
    setLoading(true);
    setError("");
    const err = await login(businessCode, shopCode, password);
    if (err) { setError(err); setLoading(false); }
  };

  return (
    <div className="est-page">
    <div className="est-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Inter:wght@400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .est-page {
          min-height: 100vh;
          background: #fef3e2;
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
          font-size: 34px;
          margin-bottom: 28px;
          position: relative; z-index: 1;
        }

        .est-panel-title {
          font-family: 'Nunito', sans-serif;
          font-weight: 900;
          font-size: 34px;
          color: #fff;
          line-height: 1.1;
          letter-spacing: -0.02em;
          position: relative; z-index: 1;
          margin-bottom: 10px;
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
          background: #fffbf4;
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
          background: #fff;
          border: 1.5px solid #e7e5e4;
          border-radius: 12px;
          font-size: 15px;
          font-family: 'Inter', sans-serif;
          color: #1c1917;
          transition: border-color 0.18s, box-shadow 0.18s;
          outline: none;
        }
        .est-input:focus {
          border-color: #f97316;
          box-shadow: 0 0 0 3px rgba(249,115,22,0.12);
        }
        .est-input::placeholder { color: #a8a29e; }
        .est-input:disabled { opacity: 0.55; cursor: not-allowed; background: #fafaf9; }

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
      `}</style>

      {/* ── LEFT PANEL ── */}
      <div className="est-panel">
        <div className="est-blob1" />
        <div className="est-blob2" />
        <div className="est-blob3" />

        {/* Mobile: row layout wrapper */}
        <div className="est-panel-logo">🏪</div>

        <div className="est-panel-content-mobile">
          <div className="est-panel-title">Epic Shop<br />Tracker</div>
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

        <div className="est-panel-footer">Epic Shop Tracker · POS Terminal</div>
      </div>

      {/* ── FORM SIDE ── */}
      <div className="est-form-side">
        <div className="est-form-anim" style={{ maxWidth: 400, width: "100%", margin: "0 auto" }}>

          <span className="est-greeting-icon">{greeting.icon}</span>
          <div className="est-greeting-text">{greeting.text}</div>
          <div className="est-greeting-sub">{greeting.sub}<br />Sign in to get started.</div>

          <form onSubmit={handleLogin} noValidate>

            <div className="est-field">
              <label className="est-label" htmlFor="biz-code">Business Code</label>
              <input
                id="biz-code"
                className="est-input"
                value={businessCode}
                onChange={e => { setBusinessCode(e.target.value.toUpperCase()); setError(""); }}
                placeholder="e.g. ACME-001"
                autoComplete="off"
                autoCapitalize="characters"
                disabled={loading}
              />
            </div>

            <div className="est-field">
              <label className="est-label" htmlFor="shop-id">Shop ID</label>
              <input
                id="shop-id"
                className="est-input"
                value={shopCode}
                onChange={e => { setShopCode(e.target.value.toUpperCase()); setError(""); }}
                placeholder="e.g. SHP-0001"
                autoComplete="off"
                autoCapitalize="characters"
                disabled={loading}
              />
            </div>

            <div className="est-field">
              <label className="est-label" htmlFor="password">Password</label>
              <div className="est-pw-wrap">
                <input
                  id="password"
                  className="est-input"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(""); }}
                  placeholder="Enter your password"
                  autoComplete="off"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="est-pw-toggle"
                  onClick={() => setShowPw(p => !p)}
                  tabIndex={-1}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            {error && (
              <div className={`est-error est-shake`}>
                <span className="est-error-icon">⚠️</span>
                <span className="est-error-msg">{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="est-btn"
              disabled={loading}
              style={{
                background: loading
                  ? "#fed7aa"
                  : "linear-gradient(135deg, #f97316, #ea580c)",
                color: loading ? "#c2410c" : "#fff",
              }}
            >
              {loading ? (
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

          </form>

          <div className="est-form-footer">
            <div className="est-form-footer-dot" />
            <span className="est-form-footer-text">
              Secure terminal access · Epic Shop Tracker
            </span>
          </div>

        </div>
      </div>
    </div>
    </div>
  );
}
